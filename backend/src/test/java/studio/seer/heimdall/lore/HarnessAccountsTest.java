package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_OWN_HOST/OH-MCP-HOSTED-SWITCH (1.18.2) — «гирлянда»: срез «учётки harness» для вкладки админки.
 * Дерево ролей по порядку модели, у каждого узла — выпущена ли учётка и можно ли её выпустить (отказ — словами
 * сервера). Честные состояния: KC недоступен ≠ учётки нет. Секретов в срезе нет.
 */
class HarnessAccountsTest {

    private static final Instant NOW = Instant.parse("2026-11-21T12:00:00Z");

    private static LoreModelAgentProfiles.AgentProfiles model() {
        return LoreModelAgentProfiles.parse(Map.of(
            "profiles", List.of(
                Map.of("code", "full", "rank", 10, "parents", List.of()),
                Map.of("code", "pm", "rank", 30, "parents", List.of("full")),
                Map.of("code", "analyst", "rank", 41, "parents", List.of("pm")),
                Map.of("code", "developer", "rank", 42, "parents", List.of("pm")),
                Map.of("code", "tester", "rank", 50, "parents", List.of("analyst", "developer"))),
            "harness", Map.of(
                "claude-code", Map.of("main", "full", "suffix", ""),
                "kimi-code", Map.of("main", "pm", "suffix", "kimi"))));
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> nodes(Map<String, Object> out) {
        return (List<Map<String, Object>>) out.get("nodes");
    }

    private static Map<String, Object> node(Map<String, Object> out, String role) {
        return nodes(out).stream().filter(n -> role.equals(n.get("role"))).findFirst().orElseThrow();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> account(Map<String, Object> n) {
        return (Map<String, Object>) n.get("account");
    }

    private static final String CLIENT = "{\"id\":\"u-1\",\"clientId\":\"lore-mcp-tester_kimi\",\"enabled\":false,"
        + "\"secret\":\"MUST-NOT-LEAK\",\"attributes\":{\"client.secret.creation.time\":\"1763700000\","
        + "\"client.secret.rotated.creation.time\":\"1763712000\"}}";

    @Test
    void treeFollowsModelOrderWithLevelsAndMainFirst() {
        Map<String, Object> out = HarnessAccounts.build(model(), "kimi-code",
            HarnessAccounts.KcView.notConfigured("KC_ADMIN_CLIENT_SECRET не задан"), (c, r) -> Map.of(), NOW);
        assertEquals("pm", out.get("main"));
        assertEquals(List.of("full", "pm", "analyst", "developer", "tester"),
            nodes(out).stream().map(n -> n.get("role")).toList());
        assertEquals(0, node(out, "full").get("level"));
        assertEquals(1, node(out, "pm").get("level"));
        assertEquals(3, node(out, "tester").get("level"));
        assertEquals(true, node(out, "pm").get("is_main"));
        assertEquals("lore-mcp-tester_kimi", node(out, "tester").get("client_id"));
        assertEquals("LORE_MCP_CLIENT_SECRET_TESTER_KIMI", node(out, "tester").get("secret_key"));
    }

    @Test
    void roleAboveMainIsNotIssuableAndSaysWhyInServerWords() {
        Map<String, Object> out = HarnessAccounts.build(model(), "kimi-code",
            HarnessAccounts.KcView.notConfigured("x"), (c, r) -> Map.of(), NOW);
        Map<String, Object> full = node(out, "full");
        assertEquals(false, full.get("issuable"));
        assertEquals(LoreModelAgentProfiles.issueRefusal(model(), "full", "kimi-code"), full.get("refusal"));
        assertEquals(true, node(out, "tester").get("issuable"));
        assertNull(node(out, "tester").get("refusal"));
    }

    @Test
    void kcNotConfiguredIsUnknownNotAbsent() {
        Map<String, Object> out = HarnessAccounts.build(model(), "kimi-code",
            HarnessAccounts.KcView.notConfigured("KC_ADMIN_CLIENT_SECRET не задан"), (c, r) -> Map.of(), NOW);
        assertEquals("not_configured", ((Map<?, ?>) out.get("kc")).get("state"));
        Map<String, Object> a = account(node(out, "tester"));
        assertEquals("unknown", a.get("state"));
        assertTrue(String.valueOf(a.get("reason")).contains("KC_ADMIN_CLIENT_SECRET"));
    }

    @Test
    void absentIssuedAndFailedAreDistinct() {
        HarnessAccounts.KcView kc = HarnessAccounts.KcView.checked(cid -> switch (cid) {
            case "lore-mcp-tester_kimi" -> HarnessAccounts.Lookup.found(CLIENT);
            case "lore-mcp-developer_kimi" -> HarnessAccounts.Lookup.failed("KC ответил 500");
            default -> HarnessAccounts.Lookup.absent();
        });
        Map<String, Object> out = HarnessAccounts.build(model(), "kimi-code", kc,
            (cid, rotatedAt) -> Map.of("seen", true, "at", "2026-11-21T08:00:00Z"), NOW);
        assertEquals("absent", account(node(out, "analyst")).get("state"));
        Map<String, Object> dev = account(node(out, "developer"));
        assertEquals("unknown", dev.get("state"));
        assertEquals("KC ответил 500", dev.get("reason"));
        Map<String, Object> t = account(node(out, "tester"));
        assertEquals("issued", t.get("state"));
        assertEquals(false, t.get("enabled"));
        assertEquals("2025-11-21T04:40:00Z", t.get("secret_created_at"));
        assertEquals("2025-11-21T08:00:00Z", t.get("rotated_at"));
        assertNotNull(t.get("switched"));
        assertFalse(out.toString().contains("MUST-NOT-LEAK"), "секрет в срез не попадает");
    }

    @Test
    void unknownHarnessIsNull() {
        assertNull(HarnessAccounts.build(model(), "ghost", HarnessAccounts.KcView.notConfigured("x"), (c, r) -> Map.of(), NOW));
    }
}
