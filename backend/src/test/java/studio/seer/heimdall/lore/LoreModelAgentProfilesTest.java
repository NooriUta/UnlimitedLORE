package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * SPRINT_LORE_OWN_HOST/OH-MCP-HOSTED-SWITCH (решения владелицы 21.11.2026): порядок ролей агента —
 * в модели, а не константой. full &gt; architect &gt; pm &gt; (product-analyst | analyst | developer |
 * marketer) &gt; tester; «marketer под pm»; у harness одна главная роль, младшие — допом.
 */
class LoreModelAgentProfilesTest {

    static LoreModelAgentProfiles.AgentProfiles model() {
        return LoreModelFile.content().agentProfiles();
    }

    @Test
    void orderComesFromTheModelFile() {
        LoreModelAgentProfiles.AgentProfiles m = model();
        assertEquals(List.of("full", "architect", "pm", "product-analyst", "analyst", "developer", "marketer", "tester"),
            m.codes(), "все восемь профилей, по рангу");
        assertTrue(LoreModelAgentProfiles.notAbove(m, "tester", "full"));
        assertTrue(LoreModelAgentProfiles.notAbove(m, "marketer", "pm"), "marketer под pm");
        assertTrue(LoreModelAgentProfiles.notAbove(m, "tester", "developer"), "tester ниже каждого из четырёх");
        assertTrue(LoreModelAgentProfiles.notAbove(m, "tester", "marketer"));
        assertTrue(LoreModelAgentProfiles.notAbove(m, "pm", "pm"), "роль не выше самой себя");
        assertFalse(LoreModelAgentProfiles.notAbove(m, "full", "architect"));
        assertFalse(LoreModelAgentProfiles.notAbove(m, "analyst", "developer"), "соседи — не младшие друг другу");
        assertFalse(LoreModelAgentProfiles.notAbove(m, "nobody", "full"), "неизвестная роль — не допускается");
    }

    @Test
    void rolesAtOrBelowMainAreListedByRank() {
        assertEquals(List.of("pm", "product-analyst", "analyst", "developer", "marketer", "tester"),
            LoreModelAgentProfiles.atOrBelow(model(), "pm"));
        assertEquals(List.of("developer", "tester"), LoreModelAgentProfiles.atOrBelow(model(), "developer"));
        assertEquals(8, LoreModelAgentProfiles.atOrBelow(model(), "full").size());
    }

    @Test
    void clientNameIsByHarnessNotMachine() {
        LoreModelAgentProfiles.AgentProfiles m = model();
        assertEquals("lore-mcp-full", LoreModelAgentProfiles.clientId(m, "full", "claude-code"), "главная Claude Code — без суффикса");
        assertEquals("lore-mcp-tester", LoreModelAgentProfiles.clientId(m, "tester", "claude-code"));
        assertEquals("lore-mcp-full_kimi", LoreModelAgentProfiles.clientId(m, "full", "kimi-code"), "существующее имя не меняется");
        assertEquals("lore-mcp-developer_kimi", LoreModelAgentProfiles.clientId(m, "developer", "kimi-code"));
    }

    @Test
    void secretKeyIsRoleThenHarnessUppercase() {
        LoreModelAgentProfiles.AgentProfiles m = model();
        assertEquals("LORE_MCP_CLIENT_SECRET_FULL", LoreModelAgentProfiles.secretKey(m, "full", "claude-code"));
        assertEquals("LORE_MCP_CLIENT_SECRET_FULL_KIMI", LoreModelAgentProfiles.secretKey(m, "full", "kimi-code"));
        assertEquals("LORE_MCP_CLIENT_SECRET_PRODUCT_ANALYST", LoreModelAgentProfiles.secretKey(m, "product-analyst", "claude-code"));
    }

    @Test
    void secretKeyOfAnExistingClientName() {
        LoreModelAgentProfiles.AgentProfiles m = model();
        assertEquals("LORE_MCP_CLIENT_SECRET_TESTER", LoreModelAgentProfiles.secretKeyOfClient(m, "lore-mcp-tester"));
        assertEquals("LORE_MCP_CLIENT_SECRET_FULL_KIMI", LoreModelAgentProfiles.secretKeyOfClient(m, "lore-mcp-full_kimi"));
        assertNull(LoreModelAgentProfiles.secretKeyOfClient(m, "lore-mcp-full_arharaga"), "машинное имя — не по схеме harness");
        assertNull(LoreModelAgentProfiles.secretKeyOfClient(m, "lore-reader-minilore"));
    }

    @Test
    void issueAboveTheHarnessMainIsRefusedInWords() {
        LoreModelAgentProfiles.AgentProfiles m = LoreModelAgentProfiles.parse(Map.of(
            "profiles", List.of(
                Map.of("code", "full", "rank", 1),
                Map.of("code", "pm", "rank", 2, "parents", List.of("full")),
                Map.of("code", "tester", "rank", 3, "parents", List.of("pm"))),
            "harness", Map.of("junior", Map.of("main", "pm", "suffix", "junior"))));
        assertNull(LoreModelAgentProfiles.issueRefusal(m, "tester", "junior"));
        assertNull(LoreModelAgentProfiles.issueRefusal(m, "pm", "junior"));
        String r = LoreModelAgentProfiles.issueRefusal(m, "full", "junior");
        assertNotNull(r);
        assertTrue(r.contains("pm") && r.contains("full") && r.contains("junior"), r);
        assertNotNull(LoreModelAgentProfiles.issueRefusal(m, "tester", "dsh"), "harness без главной роли — отказ, не догадка");
    }

    @Test
    void inconsistentSectionIsCaught() {
        LoreModelAgentProfiles.AgentProfiles m = LoreModelAgentProfiles.parse(Map.of(
            "profiles", List.of(
                Map.of("code", "a", "rank", 1, "parents", List.of("b")),
                Map.of("code", "b", "rank", 2, "parents", List.of("a", "ghost"))),
            "harness", Map.of("h", Map.of("main", "zzz", "suffix", "bad suffix"))));
        List<String> bad = LoreModelAgentProfiles.problems(m);
        assertTrue(bad.stream().anyMatch(s -> s.contains("ghost")), bad.toString());
        assertTrue(bad.stream().anyMatch(s -> s.contains("цикл")), bad.toString());
        assertTrue(bad.stream().anyMatch(s -> s.contains("zzz")), bad.toString());
        assertTrue(bad.stream().anyMatch(s -> s.contains("bad suffix")), bad.toString());
    }

    @Test
    void sectionIsOnTheModelSurface() {
        Map<String, Object> doc = LoreModel.build(List.of());
        assertNotNull(doc.get("agent_profiles"), "/lore/model отдаёт порядок ролей клиентам (админка, MCP)");
    }
}
