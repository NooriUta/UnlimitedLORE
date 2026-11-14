package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-CAL-START — срез task_close_path живьём: проекция разбирается
 * ArcadeDB, прыжок отличим от работы, review считается отдельно, changed_from режет по дню.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class TaskClosePathLiveDbTest {

    private static final String SID = "SPRINT_CLOSE_PATH";

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    private static void status(String uid, String st) {
        String extra = "done".equals(st) ? ",\"evidence_type\":\"pr\",\"evidence_ref\":\"PR #1\"" : "";
        post("/lore/status", "{\"entity_type\":\"task\",\"id\":\"" + uid + "\",\"status\":\"" + st + "\"" + extra + "}");
    }

    private static void task(String id) {
        post("/lore/task", "{\"sprint_id\":\"" + SID + "\",\"task_id\":\"" + id + "\",\"title\":\"" + id
            + "\",\"executor_agent\":\"a\",\"reviewer_agent\":\"b\"}");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> row(String uid, Map<String, String> params) {
        List<Map<String, Object>> rows = given().header("X-Seer-Role", "admin").queryParams(params)
            .get("/lore/slice/task_close_path").then().statusCode(200).extract().jsonPath().getList("rows");
        return rows.stream().filter(r -> uid.equals(r.get("task_uid"))).findFirst().orElse(null);
    }

    @Test
    void jumpAndWorkAreDistinguishable() {
        post("/lore/sprint/create", "{\"sprint_id\":\"" + SID + "\",\"name\":\"путь закрытия\"}");
        task("JUMP");
        task("WORK");
        status(SID + "/JUMP", "review");
        status(SID + "/JUMP", "done");
        status(SID + "/WORK", "active");
        status(SID + "/WORK", "review");
        status(SID + "/WORK", "done");

        Map<String, String> sprint = Map.of("sprint", SID);
        Map<String, Object> jump = row(SID + "/JUMP", sprint);
        Map<String, Object> work = row(SID + "/WORK", sprint);
        assertNotNull(jump, "закрытая задача — в срезе");
        assertNotNull(work);
        assertEquals(0, ((Number) jump.get("work_versions")).intValue(), "planned → review → done — прыжок: " + jump);
        assertEquals(1, ((Number) jump.get("review_versions")).intValue(), jump.toString());
        assertEquals(1, ((Number) work.get("work_versions")).intValue(), "active — рабочий статус: " + work);
        assertNotNull(jump.get("done_at"));
        assertTrue(((Number) jump.get("status_versions")).intValue() >= 3, jump.toString());

        String today = java.time.LocalDate.now(java.time.ZoneOffset.UTC).toString();
        assertNotNull(row(SID + "/JUMP", Map.of("sprint", SID, "changed_from", today)), "закрыта сегодня — в окне дня");
        assertEquals(null, row(SID + "/JUMP", Map.of("sprint", SID, "changed_to", "2000-01-01")), "вне окна — нет");
    }
}
