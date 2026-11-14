package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
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
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Сверка задач 14.11.2026: у старых задач список показывал устаревший статус. Пример
 * [[task:SPRINT_HOUND_DIALECT_MODEL_DEPTH/HD-1]]: открытая версия истории — ✅ DONE, а
 * {@code tasks_by_uids} и {@code open_tasks} отдавали «PARTIAL» и считали задачу открытой.
 *
 * <p>Корень: статус брался как {@code out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0]} —
 * версия, ВСТАВЛЕННАЯ последней (ArcadeDB отдаёт рёбра от новых к старым), а не открытая.
 * У HD-1 закрытая июньская версия была дописана в историю уже после открытой. Правило:
 * статус — из открытой версии ({@code valid_to IS NULL}), иначе прежнее выражение.
 *
 * <p>Тест воспроизводит порядок вставки HD-1: открытая версия DONE, потом дописанная
 * закрытая PARTIAL.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class TaskStatusOpenVersionLiveDbTest {

    private static final String SPRINT = "SPRINT_STATUS_OPEN_PROBE";
    private static final String TASK = SPRINT + "/T1";

    private static void post(String path, String json) {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body(json).when().post(path).then().statusCode(200);
    }

    private static void sql(String command) throws Exception {
        HttpClient http = LiveDbHttp.client();
        String body = io.vertx.core.json.JsonObject.of("language", "sql", "command", command).encode();
        HttpRequest req = HttpRequest.newBuilder(
                URI.create(LoreArcadeDbTestResource.BASE_URL + "/api/v1/command/" + LoreArcadeDbTestResource.TEST_DB))
            .header("Content-Type", "application/json; charset=utf-8")
            .header("Authorization", "Basic " + Base64.getEncoder().encodeToString(
                ("root:" + LoreArcadeDbTestResource.ROOT_PASSWORD).getBytes(StandardCharsets.UTF_8)))
            .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8)).build();
        HttpResponse<String> r = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        assertEquals(200, r.statusCode(), command + " → " + r.body());
    }

    private static List<Map<String, Object>> rows(String slice, String param, String value) {
        return given().queryParam(param, value).when().get("/lore/slice/" + slice)
            .then().statusCode(200).extract().jsonPath().getList("rows");
    }

    @Test
    void statusComesFromOpenVersionEvenIfAClosedOneWasInsertedLater() throws Exception {
        post("/lore/sprint/create", "{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"проба статуса\"}");
        post("/lore/task", "{\"sprint_id\":\"" + SPRINT + "\",\"task_id\":\"T1\",\"title\":\"проба статуса\"}");
        post("/lore/status", "{\"entity_type\":\"task\",\"id\":\"" + TASK + "\",\"status\":\"done\"}");

        // Положительный контроль: до порчи порядка статус — DONE.
        Map<String, Object> before = rows("tasks_by_uids", "task_uids", TASK).get(0);
        assertTrue(String.valueOf(before.get("status_raw")).contains("DONE"), "до: " + before);

        // Как у HD-1: закрытая старая версия PARTIAL дописана в историю ПОСЛЕ открытой.
        sql("INSERT INTO KnowTaskHist SET state_uid = 'probe-legacy-partial', status_raw = 'PARTIAL', "
            + "note_md = 'чужая старая заметка', valid_from = '2026-06-14 20:23:39', valid_to = '2026-06-14 21:55:01'");
        sql("CREATE EDGE HAS_STATE FROM (SELECT FROM KnowTask WHERE task_uid = '" + TASK + "') "
            + "TO (SELECT FROM KnowTaskHist WHERE state_uid = 'probe-legacy-partial')");

        Map<String, Object> r = rows("tasks_by_uids", "task_uids", TASK).get(0);
        assertTrue(String.valueOf(r.get("status_raw")).contains("DONE"), "статус из открытой версии: " + r);

        List<Map<String, Object>> open = rows("open_tasks", "sprint", SPRINT);
        assertFalse(open.stream().anyMatch(x -> TASK.equals(x.get("task_uid"))), "закрытая задача не в open_tasks: " + open);

        List<Map<String, Object>> ofSprint = rows("tasks_of_sprint", "sprint_id", SPRINT);
        assertTrue(String.valueOf(ofSprint.get(0).get("status_raw")).contains("DONE"), "tasks_of_sprint: " + ofSprint);
    }
}
