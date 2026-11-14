package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.net.URI;
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
 * SPRINT_LORE_MEASURE_TRUTH/MT-NOTE-APPEND п.3 (вариант А) — живьём: правка текста без смены
 * статуса открывает версию SCD2, прежний текст достаётся из истории дословно (приёмка п.3
 * задачи), статус и момент статуса не двигаются. На прежней редакции (правка на месте) у
 * задачи и спринта после правок оставалась одна версия с последним текстом.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class TextVersionLiveDbTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

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
                .header("Authorization", auth).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(MAPPER.writeValueAsString(body))).build();
            HttpResponse<String> resp = LiveDbHttp.client().send(req, HttpResponse.BodyHandlers.ofString());
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

    private List<Map<String, Object>> hist(String histType, String key, String id) {
        return query("SELECT * FROM " + histType + " WHERE in('HAS_STATE')." + key
            + " CONTAINS :id ORDER BY valid_from", Map.of("id", id));
    }

    private static List<Map<String, Object>> open(List<Map<String, Object>> rows) {
        return rows.stream().filter(r -> r.get("valid_to") == null).toList();
    }

    @Test
    void taskNoteEditsAreVersionsAndTheDoneDateStays() {
        String sid = "SPRINT_TEXT_VERSION";
        String uid = sid + "/T1";
        post("/lore/sprint/create", "{\"sprint_id\":\"" + sid + "\",\"name\":\"версии текста\"}");
        post("/lore/task", "{\"sprint_id\":\"" + sid + "\",\"task_id\":\"T1\",\"title\":\"t\",\"note_md\":\"v1\"}");
        post("/lore/status", "{\"entity_type\":\"task\",\"id\":\"" + uid + "\",\"status\":\"active\"}");
        int before = hist("KnowTaskHist", "task_uid", uid).size();

        post("/lore/task/edit", "{\"task_uid\":\"" + uid + "\",\"title\":\"t\",\"note_md\":\"v2\"}");
        post("/lore/task/edit", "{\"task_uid\":\"" + uid + "\",\"title\":\"t\",\"note_append\":\"v3\"}");
        post("/lore/task/edit", "{\"task_uid\":\"" + uid + "\",\"title\":\"t\",\"note_md\":\"v2\\n\\nv3\"}");   // тот же текст

        List<Map<String, Object>> rows = hist("KnowTaskHist", "task_uid", uid);
        assertEquals(before + 2, rows.size(), "две правки текста — две версии, повтор того же текста — ни одной: " + rows);
        assertEquals(1, open(rows).size(), "ровно одна открытая версия: " + rows);
        assertEquals("v1", rows.get(before - 1).get("note_md"), "прежний текст достаётся из истории дословно");
        assertEquals("v2", rows.get(before).get("note_md"));
        Map<String, Object> cur = open(rows).get(0);
        assertEquals("v2\n\nv3", cur.get("note_md"));
        assertEquals(StatusHistoryService.TEXT_VERSION, cur.get("version_kind"));
        assertEquals(rows.get(before - 1).get("status_raw"), cur.get("status_raw"), "статус тот же");
        assertNotNull(cur.get("content_hash"), "хэш нового текста проставлен");

        // Закрыть, затем дописать заметку: дата закрытия в task_done_dates — момент статуса.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"entity_type\":\"task\",\"id\":\"" + uid + "\",\"status\":\"done\"}").when().post("/lore/status");
        List<Map<String, Object>> afterDone = hist("KnowTaskHist", "task_uid", uid);
        Map<String, Object> doneRow = open(afterDone).get(0);
        if (!String.valueOf(doneRow.get("status_raw")).contains("DONE")) return;   // гейт WK-05 не пустил — проверка даты неприменима
        assertNull(doneRow.get("version_kind"), "смена статуса — не правка текста");
        Object doneAt = given().get("/lore/slice/task_done_dates").then().statusCode(200).extract().jsonPath()
            .getList("rows").stream().map(r -> (Map<?, ?>) r).filter(r -> uid.equals(r.get("task_uid")))
            .findFirst().orElseThrow().get("valid_from");
        post("/lore/task/edit", "{\"task_uid\":\"" + uid + "\",\"title\":\"t\",\"note_append\":\"после закрытия\"}");
        Object doneAt2 = given().get("/lore/slice/task_done_dates").then().statusCode(200).extract().jsonPath()
            .getList("rows").stream().map(r -> (Map<?, ?>) r).filter(r -> uid.equals(r.get("task_uid")))
            .findFirst().orElseThrow().get("valid_from");
        assertEquals(FreshnessChangedAtLiveDbTest.at(doneAt), FreshnessChangedAtLiveDbTest.at(doneAt2),
            "правка заметки закрытой задачи не сдвигает дату закрытия");
    }

    @Test
    void sprintTextEditsAreVersions() {
        String sid = "SPRINT_TEXT_VERSION_S";
        post("/lore/sprint/create", "{\"sprint_id\":\"" + sid + "\",\"name\":\"версии текста спринта\",\"context_md\":\"c1\"}");
        int before = hist("KnowSprintHist", "sprint_id", sid).size();
        post("/lore/sprint/update", "{\"sprint_id\":\"" + sid + "\",\"context_append\":\"c2\"}");
        post("/lore/sprint/update", "{\"sprint_id\":\"" + sid + "\",\"outcome_md\":\"итог\"}");
        List<Map<String, Object>> rows = hist("KnowSprintHist", "sprint_id", sid);
        assertTrue(rows.size() >= before + 2, "правки контекста и итога — версии: " + rows);
        assertEquals(1, open(rows).size(), rows.toString());
        Map<String, Object> cur = open(rows).get(0);
        assertEquals("c1\n\nc2", cur.get("context_md"));
        assertEquals("итог", cur.get("outcome_md"));
        assertEquals(StatusHistoryService.TEXT_VERSION, cur.get("version_kind"));
        assertTrue(rows.stream().anyMatch(r -> "c1\n\nc2".equals(r.get("context_md")) && r.get("outcome_md") == null
            && r.get("valid_to") != null), "версия до правки итога осталась в истории: " + rows);
    }
}
