package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_ADMIN_POLISH/AP-01 — удаление ТЕСТОВЫХ учёток агента и человека
 * (D-2026-ONLY-TEST-PREFIXED-ACCOUNTS). Keycloak и граф подменены заглушками:
 * в CI нет ни KC, ни права звать настоящий.
 */
class TestAccountDeleteTest {

    // ── глоб тестовых имён — решение на сервере ───────────────────────────

    @Test
    void testAgentClientGlob() {
        assertTrue(TestAccountDelete.isTestAgentClient("lore-mcp-full_TestUat"));
        assertTrue(TestAccountDelete.isTestAgentClient("lore-mcp-full_TestU1"));
        assertTrue(TestAccountDelete.isTestAgentClient("lore-mcp-product-analyst_Test"));
        // реальные — отказ
        assertFalse(TestAccountDelete.isTestAgentClient("lore-mcp-full"));
        assertFalse(TestAccountDelete.isTestAgentClient("lore-mcp-full_LorCetus"));
        assertFalse(TestAccountDelete.isTestAgentClient("lore-mcp-full_testuat"));   // регистр как в решении
        assertFalse(TestAccountDelete.isTestAgentClient("lore-admin"));
        assertFalse(TestAccountDelete.isTestAgentClient("lore-mcp-full_LorCetus_Test/../x"));
        assertFalse(TestAccountDelete.isTestAgentClient("x-lore-mcp-full_TestUat"));
        assertFalse(TestAccountDelete.isTestAgentClient(null));
    }

    @Test
    void testPersonLoginGlob() {
        assertTrue(TestAccountDelete.isTestPersonLogin("test-user-1"));
        assertTrue(TestAccountDelete.isTestPersonLogin("TEST-broker-1"));
        assertFalse(TestAccountDelete.isTestPersonLogin("omiloreadmin"));
        assertFalse(TestAccountDelete.isTestPersonLogin("alice-test"));
        assertFalse(TestAccountDelete.isTestPersonLogin(""));
        assertFalse(TestAccountDelete.isTestPersonLogin(null));
    }

    // ── заглушки ──────────────────────────────────────────────────────────

    /** KC: один клиент с сервисной учёткой; DELETE клиента убирает и её (как KC). */
    static final class FakeKc implements KcOps.KcCall {
        final List<String> calls = new ArrayList<>();
        boolean clientExists = true;
        boolean saRemovedWithClient = true;
        int deleteStatus = 204;
        String username = "test-user-1";
        boolean userExists = true;

        @Override
        public KcOps.Resp call(String method, String path, String json) {
            calls.add(method + " " + path);
            if (method.equals("GET") && path.startsWith("/clients?clientId=")) {
                return new KcOps.Resp(200, clientExists
                    ? JsonArray.of(JsonObject.of("id", "uuid-1", "clientId", "lore-mcp-full_TestUat")).encode() : "[]");
            }
            if (method.equals("GET") && path.equals("/clients/uuid-1/service-account-user"))
                return new KcOps.Resp(200, JsonObject.of("id", "sa-1", "username", "service-account-lore-mcp-full_testuat").encode());
            if (method.equals("GET") && path.equals("/users/sa-1/role-mappings"))
                return new KcOps.Resp(200, JsonObject.of(
                    "realmMappings", JsonArray.of(JsonObject.of("name", "admin"), JsonObject.of("name", "default-roles-omilore")),
                    "clientMappings", JsonObject.of("lore-mcp", JsonObject.of("client", "lore-mcp",
                        "mappings", JsonArray.of(JsonObject.of("name", "agent-full"))))).encode());
            if (method.equals("DELETE") && path.equals("/clients/uuid-1")) {
                if (deleteStatus < 300) clientExists = false;
                return new KcOps.Resp(deleteStatus, "");
            }
            if (method.equals("GET") && path.equals("/users/sa-1"))
                return new KcOps.Resp(clientExists || !saRemovedWithClient ? 200 : 404, "{}");
            if (method.equals("GET") && path.equals("/users/sub-1"))
                return userExists ? new KcOps.Resp(200, JsonObject.of("id", "sub-1", "username", username).encode())
                    : new KcOps.Resp(404, "");
            return new KcOps.Resp(404, "");
        }
    }

    /** Граф: ответы по первому совпавшему фрагменту SQL; команды записи копятся. */
    static final class FakeGraph implements TestAccountDelete.Graph {
        final Map<String, Function<Map<String, Object>, List<Map<String, Object>>>> answers = new LinkedHashMap<>();
        final List<String> execs = new ArrayList<>();
        final List<Map<String, Object>> execParams = new ArrayList<>();

        FakeGraph on(String fragment, List<Map<String, Object>> rows) {
            answers.put(fragment, p -> rows);
            return this;
        }

        @Override
        public List<Map<String, Object>> query(String sql, Map<String, Object> params) {
            for (var e : answers.entrySet()) if (sql.contains(e.getKey())) return e.getValue().apply(params);
            return List.of();
        }

        @Override
        public void exec(String sql, Map<String, Object> params) {
            execs.add(sql);
            execParams.add(params);
        }
    }

    private static Map<String, Object> row(Object... kv) {
        Map<String, Object> m = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    private static FakeGraph agentGraph() {
        return new FakeGraph()
            .on("FROM KnowActor WHERE kind = 'agent' AND (client_id = :c OR actor_id = :c)", List.of(
                row("actor_id", "lore-mcp-full_TestUat", "name", "lore-mcp-full_TestUat", "client_id", "lore-mcp-full_TestUat",
                    "agent_role", "full", "machine_id", "TestUat", "owners", List.of("sub-owner"))))
            .on("expand(bothE()) FROM KnowActor", List.of(row("@type", "OWNED_BY"), row("@type", "USES_MACHINE")));
    }

    // ── агент ─────────────────────────────────────────────────────────────

    @Test
    @SuppressWarnings("unchecked")
    void agentDryRunShowsKcClientServiceAccountRolesAndLoreActor() throws Exception {
        FakeKc kc = new FakeKc();
        Map<String, Object> plan = TestAccountDelete.agentPlan(kc, agentGraph(), "lore-mcp-full_TestUat");

        Map<String, Object> k = (Map<String, Object>) plan.get("keycloak");
        assertEquals("present", k.get("state"));
        assertEquals("lore-mcp-full_TestUat", k.get("client_id"));
        assertEquals("uuid-1", k.get("client_uuid"));
        Map<String, Object> sa = (Map<String, Object>) k.get("service_account_user");
        assertEquals("sa-1", sa.get("id"));
        assertEquals("service-account-lore-mcp-full_testuat", sa.get("username"));
        assertEquals(List.of("admin", "default-roles-omilore", "lore-mcp/agent-full"), k.get("roles"));
        assertEquals(true, k.get("roles_checked"));

        Map<String, Object> l = (Map<String, Object>) plan.get("lore");
        List<Map<String, Object>> actors = (List<Map<String, Object>>) l.get("actors");
        assertEquals(1, actors.size());
        assertEquals("lore-mcp-full_TestUat", actors.get(0).get("actor_id"));
        assertEquals(List.of("sub-owner"), actors.get(0).get("owners"));
        assertEquals("full", actors.get(0).get("agent_role"));
        assertEquals(Map.of("OWNED_BY", 1, "USES_MACHINE", 1), actors.get(0).get("edges"));

        // dry-run ничего не пишет и ничего не удаляет
        assertTrue(kc.calls.stream().noneMatch(c -> c.startsWith("DELETE") || c.startsWith("PUT") || c.startsWith("POST")));
    }

    @Test
    @SuppressWarnings("unchecked")
    void agentApplyDeletesKcClientThenLoreActorAndProbesServiceAccount() throws Exception {
        FakeKc kc = new FakeKc();
        FakeGraph g = agentGraph();
        Map<String, Object> plan = TestAccountDelete.agentPlan(kc, g, "lore-mcp-full_TestUat");
        Map<String, Object> done = TestAccountDelete.applyAgent(kc, g, plan);

        int del = kc.calls.indexOf("DELETE /clients/uuid-1");
        assertTrue(del >= 0, "клиент KC удалён");
        assertTrue(kc.calls.indexOf("GET /users/sa-1") > del, "после удаления — проба сервисной учётки");
        assertEquals(true, done.get("kc_client_deleted"));
        assertEquals(true, done.get("service_account_user_removed"));
        // LORE: сначала рёбра актора, потом сама вершина
        assertEquals(2, g.execs.size());
        assertTrue(g.execs.get(0).contains("DELETE FROM (SELECT expand(bothE()) FROM KnowActor WHERE actor_id = :a)"));
        assertTrue(g.execs.get(1).contains("DELETE FROM KnowActor WHERE actor_id = :a"));
        assertEquals("lore-mcp-full_TestUat", g.execParams.get(1).get("a"));
        assertEquals(List.of("lore-mcp-full_TestUat"), done.get("actors_deleted"));
        // пользователей KC мост не удаляет никогда
        assertTrue(kc.calls.stream().noneMatch(c -> c.startsWith("DELETE /users")));
    }

    @Test
    void agentApplyStopsWhenKcRefusesAndLeavesLoreUntouched() throws Exception {
        FakeKc kc = new FakeKc();
        kc.deleteStatus = 403;
        FakeGraph g = agentGraph();
        Map<String, Object> plan = TestAccountDelete.agentPlan(kc, g, "lore-mcp-full_TestUat");
        KcOps.KcFailed e = assertThrows(KcOps.KcFailed.class, () -> TestAccountDelete.applyAgent(kc, g, plan));
        assertEquals(403, e.status);
        assertTrue(g.execs.isEmpty(), "KC отказал — актор в LORE остаётся, повтор согласован");
    }

    @Test
    void agentApplySaysWhenKcKeptServiceAccount() throws Exception {
        FakeKc kc = new FakeKc();
        kc.saRemovedWithClient = false;
        FakeGraph g = agentGraph();
        Map<String, Object> done = TestAccountDelete.applyAgent(kc, g, TestAccountDelete.agentPlan(kc, g, "lore-mcp-full_TestUat"));
        assertEquals(false, done.get("service_account_user_removed"));
        assertNotNull(done.get("service_account_note"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void agentAbsentInKcStillCleansLoreActor() throws Exception {
        // так и с lore-mcp-full_TestUat: клиента KC удалили руками, актор остался
        FakeKc kc = new FakeKc();
        kc.clientExists = false;
        FakeGraph g = agentGraph();
        Map<String, Object> plan = TestAccountDelete.agentPlan(kc, g, "lore-mcp-full_TestUat");
        assertEquals("absent", ((Map<String, Object>) plan.get("keycloak")).get("state"));
        Map<String, Object> done = TestAccountDelete.applyAgent(kc, g, plan);
        assertTrue(kc.calls.stream().noneMatch(c -> c.startsWith("DELETE")));
        assertEquals(false, done.get("kc_client_deleted"));
        assertEquals(2, g.execs.size());
    }

    @Test
    void agentNothingAnywhereIsEmptyPlan() throws Exception {
        FakeKc kc = new FakeKc();
        kc.clientExists = false;
        Map<String, Object> plan = TestAccountDelete.agentPlan(kc, new FakeGraph(), "lore-mcp-full_TestUat");
        assertTrue(TestAccountDelete.isEmpty(plan));
    }

    // ── человек ───────────────────────────────────────────────────────────

    private static FakeGraph personGraph(String agentClient) {
        FakeGraph g = new FakeGraph()
            .on("expand(in('OWNED_BY')) FROM KnowUser", List.of(row("actor_id", agentClient, "client_id", agentClient)))
            .on("expand(bothE()) FROM KnowUser", List.of(row("@type", "HAS_PROJECT_ROLE"), row("@type", "OWNED_BY")))
            .on("SELECT kc_sub, display_name FROM KnowUser WHERE kc_sub = :s", List.of(row("kc_sub", "sub-1", "display_name", "Test User 1")))
            .on("FROM HAS_PROJECT_ROLE WHERE @out.kc_sub = :s", List.of(row("project", "lore-sandbox", "role", "owner")))
            .on("FROM HAS_PROJECT_ROLE WHERE @in.slug = :p AND role = 'owner'", List.of(row("n", 2)));
        g.answers.putAll(agentGraph().answers);
        return g;
    }

    @Test
    @SuppressWarnings("unchecked")
    void personDryRunListsRolesAgentsVertexAndKeepsKcUser() throws Exception {
        FakeKc kc = new FakeKc();
        Map<String, Object> plan = TestAccountDelete.personPlan(kc, personGraph("lore-mcp-full_TestUat"), "sub-1", "test-user-1");
        Map<String, Object> l = (Map<String, Object>) plan.get("lore");
        assertEquals("sub-1", ((Map<String, Object>) l.get("user")).get("kc_sub"));
        assertEquals(List.of(Map.of("project", "lore-sandbox", "role", "owner")), l.get("project_roles"));
        List<Map<String, Object>> agents = (List<Map<String, Object>>) plan.get("agents");
        assertEquals(1, agents.size());
        assertEquals("lore-mcp-full_TestUat", agents.get(0).get("client_id"));
        Map<String, Object> ku = (Map<String, Object>) plan.get("kc_user");
        assertEquals("kept", ku.get("action"));
        assertTrue(String.valueOf(ku.get("note")).contains("не удаляет"));
        assertEquals(List.of(), plan.get("blockers"));
    }

    @Test
    void personWithRealAgentIsBlocked() throws Exception {
        FakeKc kc = new FakeKc();
        Map<String, Object> plan = TestAccountDelete.personPlan(kc, personGraph("lore-mcp-full"), "sub-1", "test-user-1");
        assertNotNull(TestAccountDelete.refusal(plan));
        assertTrue(TestAccountDelete.refusal(plan).contains("lore-mcp-full"));
    }

    @Test
    void personLastOwnerIsBlocked() throws Exception {
        FakeGraph g = personGraph("lore-mcp-full_TestUat");
        // замена значения на месте: порядок сопоставления фрагментов прежний
        g.answers.put("FROM HAS_PROJECT_ROLE WHERE @in.slug = :p AND role = 'owner'", p -> List.of(row("n", 1)));
        Map<String, Object> plan = TestAccountDelete.personPlan(new FakeKc(), g, "sub-1", "test-user-1");
        assertNotNull(TestAccountDelete.refusal(plan));
        assertTrue(TestAccountDelete.refusal(plan).contains("lore-sandbox"));
    }

    @Test
    void personApplyDeletesAgentsRolesVertexButNeverKcUser() throws Exception {
        FakeKc kc = new FakeKc();
        FakeGraph g = personGraph("lore-mcp-full_TestUat");
        Map<String, Object> plan = TestAccountDelete.personPlan(kc, g, "sub-1", "test-user-1");
        assertNull(TestAccountDelete.refusal(plan));
        Map<String, Object> done = TestAccountDelete.applyPerson(kc, g, plan);

        assertTrue(kc.calls.contains("DELETE /clients/uuid-1"), "агент человека удалён шагом 1");
        assertTrue(kc.calls.stream().noneMatch(c -> c.startsWith("DELETE /users")), "пользователя KC LORE не трогает");
        String all = String.join("\n", g.execs);
        assertTrue(all.contains("DELETE FROM HAS_PROJECT_ROLE WHERE @out.kc_sub = :s"));
        assertTrue(all.contains("DELETE FROM (SELECT expand(bothE()) FROM KnowUser WHERE kc_sub = :s)"));
        assertTrue(g.execs.get(g.execs.size() - 1).contains("DELETE FROM KnowUser WHERE kc_sub = :s"));
        assertEquals(true, done.get("user_deleted"));
        assertEquals("kept", done.get("kc_user"));
    }

    @Test
    void personApplyRefusesWhenBlocked() throws Exception {
        FakeKc kc = new FakeKc();
        FakeGraph g = personGraph("lore-mcp-full");
        Map<String, Object> plan = TestAccountDelete.personPlan(kc, g, "sub-1", "test-user-1");
        assertThrows(IllegalStateException.class, () -> TestAccountDelete.applyPerson(kc, g, plan));
        assertTrue(g.execs.isEmpty());
        assertTrue(kc.calls.stream().noneMatch(c -> c.startsWith("DELETE")));
    }
}
