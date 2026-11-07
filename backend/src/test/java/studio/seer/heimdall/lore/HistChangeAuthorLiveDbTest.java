package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import io.quarkus.test.security.jwt.Claim;
import io.quarkus.test.security.jwt.JwtSecurity;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-12 — БАГ: в строках истории (*Hist) не было автора.
 *
 * <p>Каждая новая версия обязана нести {@code changed_by} / {@code changed_by_kind}
 * из ПРОВЕРЕННОГО токена: человек (JWT без agent_scope), агент (JWT с agent_scope,
 * личность — client_id), а без токена (dev-режим) — {@code unknown}, не «человек».
 * Проверяются все пути close-open, до которых дотягивается REST в одном прогоне:
 * создание спринта, смена статуса спринта и задачи, правка плана спринта,
 * создание задачи и фазы, ADR и спека (первая версия и checkpoint).
 * Прочие вставки Hist держит статический сторож {@code HistInsertCarriesAuthorTest}.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class HistChangeAuthorLiveDbTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newHttpClient();

    static final String HUMAN = "s212-owner";
    /** Личность человека — kc_sub (контракт S2 HistoryAuthor, KnowUser.kc_sub), не отображаемое имя. */
    static final String HUMAN_SUB = "s212-owner-sub";
    static final String AGENT_CLIENT = "lore-mcp-s212-probe";

    @BeforeAll
    static void waitForResource() {
        assertNotNull(LoreArcadeDbTestResource.BASE_URL, "test resource must have started the container first");
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> query(String sql, Map<String, Object> params) {
        try {
            String auth = "Basic " + Base64.getEncoder().encodeToString(
                ("root:" + LoreArcadeDbTestResource.ROOT_PASSWORD).getBytes(StandardCharsets.UTF_8));
            Map<String, Object> body = Map.of("language", "sql", "command", sql, "params", params);
            HttpRequest req = HttpRequest.newBuilder(URI.create(
                    LoreArcadeDbTestResource.BASE_URL + "/api/v1/query/" + LoreArcadeDbTestResource.TEST_DB))
                .header("Authorization", auth)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(MAPPER.writeValueAsString(body)))
                .build();
            HttpResponse<String> resp = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
            assertEquals(200, resp.statusCode(), "verification query failed: " + resp.body());
            Object result = MAPPER.readValue(resp.body(), Map.class).get("result");
            return result instanceof List ? (List<Map<String, Object>>) result : List.of();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private void post(String path, String json) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(json)
            .when().post(path).then().statusCode(200);
    }

    /** Все версии цепочки сущности: автор каждой строки. */
    private List<Map<String, Object>> hist(String histType, String keyField, String id) {
        return query("SELECT state_uid, valid_from, valid_to, changed_by, changed_by_kind FROM " + histType
            + " WHERE in('HAS_STATE')." + keyField + " CONTAINS :id ORDER BY valid_from", Map.of("id", id));
    }

    private static void allBy(List<Map<String, Object>> rows, String by, String kind, String what) {
        assertFalse(rows.isEmpty(), what + ": версий нет вовсе — проверять нечего");
        for (Map<String, Object> r : rows) {
            assertEquals(kind, r.get("changed_by_kind"), what + ": вид автора версии " + r);
            assertEquals(by, r.get("changed_by"), what + ": автор версии " + r);
        }
    }

    /** Полный набор путей одним вызывающим; возвращает id-шники для проверки. */
    private void exerciseAllPaths(String sid, String adr, String spec) {
        exerciseAllPaths(sid, adr, spec, true);
    }

    /**
     * withTask=false — для агента: создание задачи агентом закрыто гейтом ролей
     * (TaskRoleWriter.refuseCreate — автор и исполнитель из ролей проекта), это
     * ортогонально автору версии. Смена статуса задачи идёт тем же
     * updateScd2Status, что и спринта, — его агентская ветка покрыта спринтом.
     */
    private void exerciseAllPaths(String sid, String adr, String spec, boolean withTask) {
        post("/lore/sprint/create", "{\"sprint_id\":\"" + sid + "\"}");
        post("/lore/status", "{\"entity_type\":\"sprint\",\"id\":\"" + sid + "\",\"status\":\"active\"}");
        post("/lore/sprint/plan", "{\"sprint_id\":\"" + sid + "\",\"priority\":\"high\"}");
        if (withTask) {
            post("/lore/task", "{\"sprint_id\":\"" + sid + "\",\"task_id\":\"T1\",\"title\":\"author probe\"}");
            post("/lore/status", "{\"entity_type\":\"task\",\"id\":\"" + sid + "/T1\",\"status\":\"active\"}");
        }
        post("/lore/phase", "{\"sprint_id\":\"" + sid + "\",\"phase_key\":\"A\"}");
        post("/lore/adr", "{\"adr_id\":\"" + adr + "\",\"name\":\"author probe\",\"context_md\":\"v1\"}");
        post("/lore/adr", "{\"adr_id\":\"" + adr + "\",\"name\":\"author probe\",\"context_md\":\"v2\",\"checkpoint\":true}");
        post("/lore/spec", "{\"spec_id\":\"" + spec + "\",\"title\":\"author probe\",\"content_md\":\"v1\"}");
        post("/lore/spec", "{\"spec_id\":\"" + spec + "\",\"content_md\":\"v2\",\"checkpoint\":true}");
    }

    private void assertAllPathsBy(String sid, String adr, String spec, String by, String kind) {
        assertAllPathsBy(sid, adr, spec, by, kind, true);
    }

    private void assertAllPathsBy(String sid, String adr, String spec, String by, String kind, boolean withTask) {
        List<Map<String, Object>> sprint = hist("KnowSprintHist", "sprint_id", sid);
        assertEquals(3, sprint.size(), "create + status + plan = три версии спринта: " + sprint);
        allBy(sprint, by, kind, "спринт");
        if (withTask) {
            List<Map<String, Object>> task = hist("KnowTaskHist", "task_uid", sid + "/T1");
            assertEquals(2, task.size(), "create + status = две версии задачи: " + task);
            allBy(task, by, kind, "задача");
        }
        allBy(hist("KnowPhaseHist", "phase_uid", sid + "/PHASE_A"), by, kind, "фаза");
        List<Map<String, Object>> a = hist("KnowADRHist", "adr_id", adr);
        assertEquals(2, a.size(), "первая версия + checkpoint ADR: " + a);
        allBy(a, by, kind, "ADR");
        List<Map<String, Object>> s = hist("KnowSpecHist", "spec_id", spec);
        assertEquals(2, s.size(), "первая версия + checkpoint спеки: " + s);
        allBy(s, by, kind, "спека");
    }

    // ── 1. Человек: JWT без agent_scope → human + preferred_username ──────────

    @Test
    @TestSecurity(user = HUMAN, roles = {"admin"})
    @JwtSecurity(claims = {
        @Claim(key = "preferred_username", value = HUMAN),
        @Claim(key = "sub", value = HUMAN_SUB)})
    void humanTokenStampsEveryNewVersionAsHuman() {
        exerciseAllPaths("SPRINT_S212_HUMAN", "ADR-S212-HUMAN", "SPEC-S212-HUMAN");
        assertAllPathsBy("SPRINT_S212_HUMAN", "ADR-S212-HUMAN", "SPEC-S212-HUMAN", HUMAN_SUB, "human");
    }

    // ── 2. Агент: agent_scope в токене → agent + client_id (личность агента) ──

    @Test
    @TestSecurity(user = "service-account-" + AGENT_CLIENT, roles = {"admin"})
    @JwtSecurity(claims = {
        @Claim(key = "agent_scope", value = "agent-full"),
        @Claim(key = "client_id", value = AGENT_CLIENT),
        @Claim(key = "sub", value = "s212-agent-sub")})
    void agentTokenStampsEveryNewVersionAsAgentClient() {
        exerciseAllPaths("SPRINT_S212_AGENT", "ADR-S212-AGENT", "SPEC-S212-AGENT", false);
        assertAllPathsBy("SPRINT_S212_AGENT", "ADR-S212-AGENT", "SPEC-S212-AGENT", AGENT_CLIENT, "agent", false);
    }

    // ── 3. Положительный контроль: без токена — «неизвестно», а не «человек» ──

    @Test
    void noTokenStampsUnknownNotHuman() {
        exerciseAllPaths("SPRINT_S212_ANON", "ADR-S212-ANON", "SPEC-S212-ANON");
        assertAllPathsBy("SPRINT_S212_ANON", "ADR-S212-ANON", "SPEC-S212-ANON", null, "unknown");
    }

    // ── 4. Автор не берётся из тела запроса ──────────────────────────────────

    @Test
    void authorInRequestBodyIsIgnored() {
        final String sid = "SPRINT_S212_SPOOF";
        post("/lore/sprint/create", "{\"sprint_id\":\"" + sid + "\"}");
        post("/lore/status", "{\"entity_type\":\"sprint\",\"id\":\"" + sid + "\",\"status\":\"active\","
            + "\"changed_by\":\"spoofed\",\"changed_by_kind\":\"human\"}");
        for (Map<String, Object> r : hist("KnowSprintHist", "sprint_id", sid)) {
            assertNull(r.get("changed_by"), "автор из тела запроса не должен попасть в историю: " + r);
            assertEquals("unknown", r.get("changed_by_kind"), r.toString());
        }
    }

    // ── 5. История отдаёт автора из строки, а не догадку по журналу ──────────

    @Test
    // super-admin: история режется проектным скоупом, а у пробного человека проектных
    // ролей нет — у суперадмина скоуп не применяется (как в LoreScopeEnforcedLiveDbTest).
    @TestSecurity(user = HUMAN, roles = {"super-admin"})
    @JwtSecurity(claims = {
        @Claim(key = "preferred_username", value = HUMAN),
        @Claim(key = "sub", value = HUMAN_SUB)})
    @SuppressWarnings("unchecked")
    void historyEndpointServesAuthorFromTheRow() {
        final String sid = "SPRINT_S212_HISTORY";
        post("/lore/sprint/create", "{\"sprint_id\":\"" + sid + "\"}");
        post("/lore/status", "{\"entity_type\":\"sprint\",\"id\":\"" + sid + "\",\"status\":\"active\"}");
        List<Map<String, Object>> rows = given().header("X-Seer-Role", "admin")
            .when().get("/lore/history?type=sprint&id=" + sid)
            .then().statusCode(200).extract().jsonPath().getList("rows");
        assertNotNull(rows, "history must return rows");
        assertEquals(2, rows.size(), rows.toString());
        for (Map<String, Object> r : rows) {
            Map<String, Object> a = (Map<String, Object>) r.get("author");
            assertEquals("human", a.get("kind"), r.toString());
            assertEquals(HUMAN_SUB, a.get("caller"), r.toString());
            assertEquals(HUMAN_SUB, a.get("kc_sub"), "контракт S2 HistoryAuthor: у человека kc_sub " + r);
            assertEquals("hist", a.get("source"), "автор должен браться из строки истории: " + r);
        }
        assertTrue(rows.stream().allMatch(r -> HUMAN_SUB.equals(r.get("changed_by"))), rows.toString());
    }
}
