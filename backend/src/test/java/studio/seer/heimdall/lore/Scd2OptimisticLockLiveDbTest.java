package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.RestAssured;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-09 — оптимистическая блокировка SCD2.
 *
 * <p>Close-open читал rid открытой строки отдельным запросом, а закрывал её
 * условием только по {@code @rid}. Две сессии, прочитавшие одну и ту же
 * открытую версию, обе её «закрывали» и обе открывали свою — у сущности
 * оказывалось две открытые строки истории. Теперь закрытие условно
 * ({@code valid_to IS NULL}, при {@code expected} — ещё и прежний статус),
 * и проигравший получает 409 CONFLICT с текущим состоянием.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class Scd2OptimisticLockLiveDbTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newHttpClient();

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

    private List<Map<String, Object>> sprintHist(String sid) {
        return query("SELECT status_raw, valid_to, priority FROM KnowSprintHist "
            + "WHERE in('HAS_STATE').sprint_id CONTAINS :sid", Map.of("sid", sid));
    }

    private static long open(List<Map<String, Object>> rows) {
        return rows.stream().filter(r -> r.get("valid_to") == null).count();
    }

    private void createSprint(String sid) {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"sprint_id\":\"" + sid + "\"}")
        .when().post("/lore/sprint/create")
        .then().statusCode(200);
    }

    private int postStatus(String body) {
        return given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(body).when().post("/lore/status").then().extract().statusCode();
    }

    // ── 1. Гонка: параллельные смены статуса одной сущности ──────────────────

    @Test
    void parallelStatusFlipsLeaveExactlyOneOpenVersionAndLosersGet409() throws Exception {
        final String sid = "SPRINT_S209_RACE_PROBE";
        createSprint(sid);
        final int n = 8;
        final String[] targets = {"active", "blocked", "partial", "design", "backlog", "todo", "active", "blocked"};
        String base = "http://localhost:" + RestAssured.port;
        ExecutorService pool = Executors.newFixedThreadPool(n);
        CountDownLatch go = new CountDownLatch(1);
        List<Future<Integer>> fs = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            final String st = targets[i];
            fs.add(pool.submit(() -> {
                go.await();
                HttpRequest r = HttpRequest.newBuilder(URI.create(base + "/lore/status"))
                    .header("X-Seer-Role", "admin").header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(
                        "{\"entity_type\":\"sprint\",\"id\":\"" + sid + "\",\"status\":\"" + st + "\"}"))
                    .build();
                return HTTP.send(r, HttpResponse.BodyHandlers.ofString()).statusCode();
            }));
        }
        go.countDown();
        int ok = 0, conflict = 0;
        List<Integer> codes = new ArrayList<>();
        for (Future<Integer> f : fs) {
            int c = f.get();
            codes.add(c);
            if (c == 200) ok++;
            else if (c == 409) conflict++;
        }
        pool.shutdown();

        assertEquals(n, ok + conflict, "every racer must end in 200 or 409, got " + codes);
        assertTrue(ok >= 1, "at least one racer must win, got " + codes);
        List<Map<String, Object>> rows = sprintHist(sid);
        assertEquals(1, open(rows), "race must leave exactly ONE open hist row, got " + rows);
        assertEquals(1 + ok, rows.size(),
            "each winner adds exactly one version, a 409 adds none (codes " + codes + ", rows " + rows + ")");
    }

    // ── 2. expected («было») не совпал — 409 с текущим состоянием, записи нет ──

    @Test
    void staleExpectedStatusIs409WithCurrentAndWritesNothing() {
        final String sid = "SPRINT_S209_EXPECTED_PROBE";
        createSprint(sid); // 📋 PLANNED
        assertEquals(200, postStatus(
            "{\"entity_type\":\"sprint\",\"id\":\"" + sid + "\",\"status\":\"active\",\"expected\":\"planned\"}"),
            "matching expected must pass");

        var resp = given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"entity_type\":\"sprint\",\"id\":\"" + sid + "\",\"status\":\"done\",\"expected\":\"planned\"}")
            .when().post("/lore/status").then().extract();
        assertEquals(409, resp.statusCode(), "stale expected must be refused: " + resp.asString());
        assertEquals("CONFLICT", resp.jsonPath().getString("error"));
        assertEquals("active", resp.jsonPath().getString("current.status"),
            "409 must tell the caller what the state actually is");

        List<Map<String, Object>> rows = sprintHist(sid);
        assertEquals(2, rows.size(), "refused write must not open a version: " + rows);
        assertEquals(1, open(rows));
    }

    // ── 3. Положительный контроль: последовательные смены без expected проходят ──

    @Test
    void sequentialFlipsWithoutExpectedStillPass() {
        final String sid = "SPRINT_S209_SEQ_PROBE";
        createSprint(sid);
        assertEquals(200, postStatus("{\"entity_type\":\"sprint\",\"id\":\"" + sid + "\",\"status\":\"active\"}"));
        assertEquals(200, postStatus("{\"entity_type\":\"sprint\",\"id\":\"" + sid + "\",\"status\":\"blocked\"}"));
        assertEquals(200, postStatus("{\"entity_type\":\"sprint\",\"id\":\"" + sid + "\",\"status\":\"done\"}"));
        List<Map<String, Object>> rows = sprintHist(sid);
        assertEquals(4, rows.size());
        assertEquals(1, open(rows));
    }

    // ── 4. sprint/plan: тот же close-open, expected по полям плана ────────────

    @Test
    void sprintPlanHonoursExpectedAndKeepsOneOpenVersion() {
        final String sid = "SPRINT_S209_PLAN_PROBE";
        createSprint(sid);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"sprint_id\":\"" + sid + "\",\"priority\":\"high\"}")
        .when().post("/lore/sprint/plan").then().statusCode(200);

        var stale = given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"sprint_id\":\"" + sid + "\",\"priority\":\"low\",\"expected\":{\"priority\":\"normal\"}}")
            .when().post("/lore/sprint/plan").then().extract();
        assertEquals(409, stale.statusCode(), "stale expected priority must be refused: " + stale.asString());
        assertEquals("CONFLICT", stale.jsonPath().getString("error"));
        assertEquals("high", stale.jsonPath().getString("current.priority"));

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"sprint_id\":\"" + sid + "\",\"priority\":\"low\",\"expected\":{\"priority\":\"high\"}}")
        .when().post("/lore/sprint/plan").then().statusCode(200);

        List<Map<String, Object>> rows = sprintHist(sid);
        assertEquals(3, rows.size(), "create + 2 accepted plan edits: " + rows);
        assertEquals(1, open(rows));
        assertEquals("low", rows.stream().filter(r -> r.get("valid_to") == null)
            .findFirst().orElseThrow().get("priority"));
    }

    // ── 5. task/edit (task_set): expected по полям — 409 при расхождении ──────

    @Test
    void taskEditStaleExpectedIs409() {
        final String sid = "SPRINT_S209_TASK_PROBE";
        createSprint(sid);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"sprint_id\":\"" + sid + "\",\"task_id\":\"T1\",\"title\":\"v1\",\"note_md\":\"n1\"}")
        .when().post("/lore/task").then().statusCode(200);

        var stale = given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"task_uid\":\"" + sid + "/T1\",\"title\":\"v2\",\"note_md\":\"n2\","
                + "\"expected\":{\"note_md\":\"something else\"}}")
            .when().post("/lore/task/edit").then().extract();
        assertEquals(409, stale.statusCode(), "stale expected note must be refused: " + stale.asString());
        assertEquals("CONFLICT", stale.jsonPath().getString("error"));
        assertEquals("n1", stale.jsonPath().getString("current.note_md"));

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"task_uid\":\"" + sid + "/T1\",\"title\":\"v2\",\"note_md\":\"n2\","
                + "\"expected\":{\"note_md\":\"n1\",\"status\":\"planned\"}}")
        .when().post("/lore/task/edit").then().statusCode(200);
    }
}
