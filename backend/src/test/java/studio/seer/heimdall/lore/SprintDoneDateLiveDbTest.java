package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-11, часть 2: дата закрытия спринта — момент
 * перехода в «выполнен». Правка плана закрытого спринта открывает новую версию
 * (close-open), но дату закрытия сдвигать не должна, а статусные поля версии
 * (категория, «статус известен с») обязана переносить, а не терять.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class SprintDoneDateLiveDbTest {

    @Inject
    LoreIngestService ingest;

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    private static String doneDate(String slice, String sid) {
        List<Map<String, Object>> rows = given().header("X-Seer-Role", "admin")
            .when().get("/lore/slice/" + slice).then().statusCode(200)
            .extract().jsonPath().getList("rows");
        return rows.stream().filter(r -> sid.equals(r.get("sprint_id")))
            .map(r -> String.valueOf(r.get("done_date"))).findFirst().orElse(null);
    }

    private Map<String, Object> openVersion(String sid) {
        List<Map<String, Object>> rows = ingest.queryPublic(
            "SELECT status_raw, status_category, status_known_from, valid_from FROM KnowSprintHist "
            + "WHERE valid_to IS NULL AND in('HAS_STATE').sprint_id CONTAINS :sid", Map.of("sid", sid));
        assertEquals(1, rows.size(), rows.toString());
        return rows.get(0);
    }

    @Test
    void editingAClosedSprintKeepsItsDoneDateAndStatusFields() throws Exception {
        String sid = "SPRINT_S211_DONE_DATE";
        post("/lore/sprint/create", "{\"sprint_id\":\"" + sid + "\"}");
        post("/lore/status", "{\"entity_type\":\"sprint\",\"id\":\"" + sid + "\",\"status\":\"done\"}");

        Map<String, Object> closed = openVersion(sid);
        assertNotNull(closed.get("status_known_from"), "переход в done ставит момент смены статуса");
        String d1 = doneDate("sprint_done_dates", sid);
        assertNotNull(d1, "у закрытого спринта есть дата закрытия");

        Thread.sleep(1100); // версии должны различаться по времени
        post("/lore/sprint/plan", "{\"sprint_id\":\"" + sid + "\",\"priority\":\"high\"}");

        Map<String, Object> edited = openVersion(sid);
        assertEquals(closed.get("status_category"), edited.get("status_category"),
            "правка плана переносит категорию статуса, а не теряет её");
        assertEquals(String.valueOf(closed.get("status_known_from")), String.valueOf(edited.get("status_known_from")),
            "правка плана — не смена статуса: «статус известен с» прежний");

        assertEquals(d1, doneDate("sprint_done_dates", sid), "правка закрытого спринта не сдвигает дату закрытия");
        assertEquals(d1, doneDate("sprints", sid), "срез sprints отдаёт ту же дату закрытия");
    }
}
