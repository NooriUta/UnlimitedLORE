package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-20 — серверные хвосты UC-4 «отключить человека».
 * Keycloak в CI нет: HTTP KC подменён заглушкой {@link KcOps.KcCall}, решения —
 * чистые функции.
 * <ul>
 *   <li>/lore/kc/users отдаёт ВСЕ учётки: постраничная выборка без потерь;</li>
 *   <li>учётку человека выключают и включают обратно: дифф, «последний админ»,
 *       «это вы», обратный вызов в окне;</li>
 *   <li>учётку агента включают обратно (обратное к disable).</li>
 * </ul>
 */
class KcOffboardTest {

    /** Заглушка KC: realm из n пользователей, страницы по first/max. */
    private static final class FakeKc implements KcOps.KcCall {
        final int total;
        final List<String> paths = new ArrayList<>();
        Integer failAtFirst = null;
        FakeKc(int total) { this.total = total; }

        @Override
        public KcOps.Resp call(String method, String path, String json) {
            paths.add(method + " " + path);
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("^/users\\?first=(\\d+)&max=(\\d+)").matcher(path);
            if (!m.find()) return new KcOps.Resp(404, "");
            int first = Integer.parseInt(m.group(1));
            int max = Integer.parseInt(m.group(2));
            if (failAtFirst != null && failAtFirst == first) return new KcOps.Resp(502, "<html>bad gateway</html>");
            JsonArray a = new JsonArray();
            for (int i = first; i < Math.min(total, first + max); i++)
                a.add(JsonObject.of("id", "u" + i, "username", "user" + i, "enabled", true));
            return new KcOps.Resp(200, a.encode());
        }
    }

    // ── /lore/kc/users: больше 100 учёток ─────────────────────────────────

    @Test
    void listAllUsersReadsEveryPage() throws Exception {
        FakeKc kc = new FakeKc(237);
        JsonArray all = KcOps.listAllUsers(kc, 100);
        assertEquals(237, all.size());
        assertEquals("u236", all.getJsonObject(236).getString("id"));
        assertEquals(List.of("GET /users?first=0&max=100", "GET /users?first=100&max=100", "GET /users?first=200&max=100"),
            kc.paths.stream().map(p -> p.replaceAll("&briefRepresentation=\\w+", "")).toList());
    }

    @Test
    void exactlyFullLastPageAsksOneMoreAndStopsOnEmpty() throws Exception {
        FakeKc kc = new FakeKc(200);
        assertEquals(200, KcOps.listAllUsers(kc, 100).size());
        assertEquals(3, kc.paths.size());
    }

    @Test
    void brokenPageIsAFailureNotATruncatedList() {
        FakeKc kc = new FakeKc(250);
        kc.failAtFirst = 100;
        KcOps.KcFailed e = assertThrows(KcOps.KcFailed.class, () -> KcOps.listAllUsers(kc, 100));
        assertEquals(502, e.status);
    }

    @Test
    void rolesOfUnreadMappingsAreMarkedUnchecked() {
        JsonObject u = JsonObject.of("id", "u1", "username", "anna", "email", "a@x", "enabled", true);
        JsonObject ok = KcOps.userRow(u, new KcOps.Resp(200, "[{\"name\":\"admin\"}]"));
        assertEquals(new JsonArray().add("admin"), ok.getJsonArray("roles"));
        assertEquals(true, ok.getBoolean("roles_checked"));
        JsonObject bad = KcOps.userRow(u, new KcOps.Resp(403, "forbidden"));
        assertEquals(new JsonArray(), bad.getJsonArray("roles"));
        assertEquals(false, bad.getBoolean("roles_checked"));
    }

    // ── учётка человека: выключить / включить ─────────────────────────────

    private static final String ANNA_ON = JsonObject.of("id", "u-anna", "username", "anna", "enabled", true).encode();
    private static final String ANNA_OFF = JsonObject.of("id", "u-anna", "username", "anna", "enabled", false).encode();

    @Test
    void disablingEnabledAccountIsMinusAndChecked() {
        Map<String, Object> p = KcOps.userEnabledPlan("u-anna", ANNA_ON, false, Set.of("u-boss"), "u-boss");
        assertEquals("disable", p.get("kind"));
        assertEquals("−", p.get("sign"));
        assertEquals(true, p.get("before"));
        assertEquals(false, p.get("after"));
        assertEquals("anna", p.get("username"));
        assertEquals("checked", ((Map<?, ?>) p.get("check")).get("state"));
    }

    @Test
    void enablingDisabledAccountIsPlusAndAlreadyOffIsUnchanged() {
        assertEquals("enable", KcOps.userEnabledPlan("u-anna", ANNA_OFF, true, Set.of(), null).get("kind"));
        assertEquals("unchanged", KcOps.userEnabledPlan("u-anna", ANNA_OFF, false, Set.of(), null).get("kind"));
    }

    @Test
    void lastEnabledAdminCannotBeDisabled() {
        Map<String, Object> p = KcOps.userEnabledPlan("u-anna", ANNA_ON, false, Set.of("u-anna"), "u-boss");
        Map<?, ?> check = (Map<?, ?>) p.get("check");
        assertEquals("forbidden", check.get("state"));
        assertTrue(String.valueOf(check.get("source")).contains("AL-35"));
        assertNotNull(KcOps.refusal(p));
    }

    @Test
    void notTheLastAdminCanBeDisabled() {
        Map<String, Object> p = KcOps.userEnabledPlan("u-anna", ANNA_ON, false, Set.of("u-anna", "u-boss"), "u-boss");
        assertNull(KcOps.refusal(p));
    }

    @Test
    void youCannotDisableYourself() {
        Map<String, Object> p = KcOps.userEnabledPlan("u-anna", ANNA_ON, false, Set.of("u-anna", "u-boss"), "u-anna");
        assertEquals("forbidden", ((Map<?, ?>) p.get("check")).get("state"));
        assertNotNull(KcOps.refusal(p));
    }

    @Test
    void unreadAccountIsUnverifiedAndRefused() {
        Map<String, Object> p = KcOps.userEnabledPlan("u-anna", null, false, Set.of(), null);
        assertEquals("unavailable", ((Map<?, ?>) p.get("check")).get("state"));
        assertNotNull(KcOps.refusal(p));
    }

    @Test
    void putBodyKeepsTheWholeRepresentationAndFlipsOnlyEnabled() {
        JsonObject rep = JsonObject.of("id", "u-anna", "username", "anna", "email", "a@x", "enabled", true,
            "attributes", JsonObject.of("dept", new JsonArray().add("ops")));
        JsonObject put = KcOps.withEnabled(rep.encode(), false);
        assertEquals(false, put.getBoolean("enabled"));
        assertEquals("a@x", put.getString("email"));
        assertEquals("ops", put.getJsonObject("attributes").getJsonArray("dept").getString(0));
    }

    @Test
    void answerCarriesUserIdFirstAndTheReverseCallInTheWindow() {
        Map<String, Object> p = KcOps.userEnabledPlan("u-anna", ANNA_ON, false, Set.of("u-boss"), "u-boss");
        String op = KcDanger.opId(Instant.parse("2026-11-11T20:00:00Z"));
        Map<String, Object> a = KcOps.userEnabledAnswer("u-anna", op, p, true);
        assertEquals("user_id", a.keySet().iterator().next());
        assertEquals(false, a.get("enabled"));
        assertEquals(Map.of("enabled", true), a.get("undo"));
        assertEquals("2026-11-11T20:15:00Z", a.get("undo_until"));
        assertEquals(true, a.get("sessions_logged_out"));
    }

    @Test
    void unchangedAnswerHasNoUndo() {
        Map<String, Object> p = KcOps.userEnabledPlan("u-anna", ANNA_OFF, false, Set.of(), null);
        Map<String, Object> a = KcOps.userEnabledAnswer("u-anna", KcDanger.opId(Instant.now()), p, false);
        assertNull(a.get("undo"));
    }

    // ── учётка агента: включить обратно ───────────────────────────────────

    @Test
    void agentClientEnablePlanAndReverse() {
        String off = JsonObject.of("id", "c-1", "clientId", "lore-mcp-full_nb", "enabled", false).encode();
        Map<String, Object> p = KcOps.clientEnabledPlan("lore-mcp-full_nb", off, true);
        assertEquals("enable", p.get("kind"));
        assertEquals("+", p.get("sign"));
        Map<String, Object> a = KcOps.clientEnabledAnswer("lore-mcp-full_nb", p);
        assertEquals("client_id", a.keySet().iterator().next());
        assertEquals(true, a.get("enabled"));
        assertEquals("disable", ((Map<?, ?>) a.get("undo")).get("action"));
    }

    @Test
    void agentClientDisableReverseIsEnable() {
        String on = JsonObject.of("id", "c-1", "clientId", "lore-mcp-full_nb", "enabled", true).encode();
        Map<String, Object> a = KcOps.clientEnabledAnswer("lore-mcp-full_nb", KcOps.clientEnabledPlan("lore-mcp-full_nb", on, false));
        assertEquals(false, a.get("enabled"));
        assertEquals("enable", ((Map<?, ?>) a.get("undo")).get("action"));
    }
}
