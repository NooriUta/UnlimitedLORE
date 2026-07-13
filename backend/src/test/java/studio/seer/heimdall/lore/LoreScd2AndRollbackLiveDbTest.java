package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
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
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * C5 (SPRINT_LORE_PROD_HARDENING) — the two-thirds of C5's original scope
 * LoreWritePathValidationTest/LoreAdminGuardTest deliberately left out:
 * SCD2 close-open correctness and A1 transactional rollback. Both need a
 * real ArcadeDB, so this class runs against a throwaway container
 * (LoreArcadeDbTestResource) instead of mocking anything — SCD2/A1 are
 * exactly the kind of DB-transaction behavior a mock would rubber-stamp.
 */
@QuarkusTest
// restrictToAnnotatedClass: @QuarkusTestResource is GLOBAL by default in Quarkus,
// so without this the ArcadeDB Testcontainer would boot for EVERY test class — and
// its Ryuk reaper failing then crashes the whole suite bootstrap (unrelated tests
// like LoreAdminGuardTest get reported as failed). Scope the container to just this
// class, which is the only one that needs it.
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
// This is the only test that needs a real ArcadeDB container. On self-hosted
// Docker-in-Docker CI (e.g. the Forgejo act_runner stand) Testcontainers can't
// reach its Ryuk/DB on the default bridge network from the job container, so we
// skip it there and rely on GitHub-hosted runners for the live-DB coverage.
// backend-ci.yml sets LORE_SKIP_LIVE_DB_TESTS=true whenever the runner is not
// github-hosted; the var is unset for a plain `./gradlew test`, so local runs
// (against Docker Desktop) still exercise it.
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreScd2AndRollbackLiveDbTest {

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
            Map<String, Object> parsed = MAPPER.readValue(resp.body(), Map.class);
            Object result = parsed.get("result");
            return result instanceof List ? (List<Map<String, Object>>) result : List.of();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    // ── SCD2: close-old + open-new correctness across two consecutive flips ──

    @Test
    void statusFlipClosesOldHistRowAndOpensExactlyOneNewRow() {
        final String sprintId = "SPRINT_C5_SCD2_PROBE";

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"sprint_id\":\"" + sprintId + "\"}")
        .when().post("/lore/sprint/create")
        .then().statusCode(200);

        List<Map<String, Object>> afterCreate = query(
            "SELECT status_raw, valid_to FROM KnowSprintHist WHERE in('HAS_STATE').sprint_id CONTAINS :sid",
            Map.of("sid", sprintId));
        assertEquals(1, afterCreate.size(), "sprint creation should seed exactly one hist row");
        assertNull(afterCreate.get(0).get("valid_to"), "freshly seeded hist row must be open");
        assertEquals("📋 PLANNED", afterCreate.get(0).get("status_raw"));

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"entity_type\":\"sprint\",\"id\":\"" + sprintId + "\",\"status\":\"active\"}")
        .when().post("/lore/status")
        .then().statusCode(200);

        List<Map<String, Object>> afterFlip1 = query(
            "SELECT status_raw, valid_to FROM KnowSprintHist WHERE in('HAS_STATE').sprint_id CONTAINS :sid",
            Map.of("sid", sprintId));
        assertEquals(2, afterFlip1.size(), "one flip should leave exactly 2 hist rows total (1 closed + 1 open)");
        long openAfterFlip1 = afterFlip1.stream().filter(r -> r.get("valid_to") == null).count();
        assertEquals(1, openAfterFlip1, "exactly one hist row must be open after a flip — never zero, never two");
        Map<String, Object> openRow1 = afterFlip1.stream().filter(r -> r.get("valid_to") == null).findFirst().orElseThrow();
        assertEquals("🔄 IN PROGRESS", openRow1.get("status_raw"));

        List<Map<String, Object>> vertexAfterFlip1 = query(
            "SELECT status_raw FROM KnowSprint WHERE sprint_id = :sid", Map.of("sid", sprintId));
        assertEquals("🔄 IN PROGRESS", vertexAfterFlip1.get(0).get("status_raw"),
            "vertex's denormalized status_raw must match the newly-opened hist row");

        // Second flip: the row opened by flip 1 must now be the one that closes.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"entity_type\":\"sprint\",\"id\":\"" + sprintId + "\",\"status\":\"done\"}")
        .when().post("/lore/status")
        .then().statusCode(200);

        List<Map<String, Object>> afterFlip2 = query(
            "SELECT status_raw, valid_to FROM KnowSprintHist WHERE in('HAS_STATE').sprint_id CONTAINS :sid",
            Map.of("sid", sprintId));
        assertEquals(3, afterFlip2.size(), "two flips total should leave exactly 3 hist rows (2 closed + 1 open)");
        long openAfterFlip2 = afterFlip2.stream().filter(r -> r.get("valid_to") == null).count();
        assertEquals(1, openAfterFlip2, "still exactly one open row after the second flip");
        Map<String, Object> openRow2 = afterFlip2.stream().filter(r -> r.get("valid_to") == null).findFirst().orElseThrow();
        assertEquals("✅ DONE", openRow2.get("status_raw"));
    }

    // ── A1: a failing statement inside an atomic sqlscript leaves no orphan ──

    @Test
    void duplicateTaskCreateFailsAtomicallyWithNoOrphanHistOrEdge() {
        final String sprintId = "SPRINT_C5_ROLLBACK_PROBE";
        final String taskId   = "T01";
        final String taskUid  = sprintId + "/" + taskId;

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"sprint_id\":\"" + sprintId + "\"}")
        .when().post("/lore/sprint/create")
        .then().statusCode(200);

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"sprint_id\":\"" + sprintId + "\",\"task_id\":\"" + taskId + "\",\"title\":\"first\"}")
        .when().post("/lore/task")
        .then().statusCode(200);

        assertEquals(1, countTaskVertices(taskUid), "first create should produce exactly one KnowTask vertex");
        assertEquals(1, countTaskHistRows(taskUid), "first create should produce exactly one KnowTaskHist row");
        assertEquals(1, countHasStateEdges(taskUid), "first create should produce exactly one HAS_STATE edge");

        // Same sprint_id + task_id again: INSERT INTO KnowTask (statement 1 of
        // the A1 sqlscript) hits the task_uid UNIQUE index and throws. If the
        // script were NOT atomic, statements 2-4 could still fire against the
        // task_uid left behind by the first, successful create — producing a
        // second, orphaned KnowTaskHist row / HAS_STATE edge with nothing new
        // to show for the failed attempt that created them.
        int dupStatus =
            given().header("X-Seer-Role", "admin").contentType("application/json")
                .body("{\"sprint_id\":\"" + sprintId + "\",\"task_id\":\"" + taskId + "\",\"title\":\"duplicate\"}")
            .when().post("/lore/task")
            .then().extract().statusCode();
        assertTrue(dupStatus >= 300, "duplicate task_uid must fail, got " + dupStatus);

        assertEquals(1, countTaskVertices(taskUid), "duplicate attempt must not create a second KnowTask vertex");
        assertEquals(1, countTaskHistRows(taskUid), "duplicate attempt must leave no orphan KnowTaskHist row");
        assertEquals(1, countHasStateEdges(taskUid), "duplicate attempt must leave no orphan HAS_STATE edge");
    }

    private long countTaskVertices(String taskUid) {
        return query("SELECT count(*) AS n FROM KnowTask WHERE task_uid = :uid", Map.of("uid", taskUid))
            .get(0).get("n") instanceof Number n ? n.longValue() : -1;
    }

    private long countTaskHistRows(String taskUid) {
        return query("SELECT count(*) AS n FROM KnowTaskHist WHERE in('HAS_STATE').task_uid CONTAINS :uid",
                Map.of("uid", taskUid)).get(0).get("n") instanceof Number n ? n.longValue() : -1;
    }

    private long countHasStateEdges(String taskUid) {
        return query("SELECT out('HAS_STATE').size() AS n FROM KnowTask WHERE task_uid = :uid", Map.of("uid", taskUid))
            .get(0).get("n") instanceof Number n ? n.longValue() : -1;
    }
}
