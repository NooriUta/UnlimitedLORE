package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.path.json.JsonPath;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * SPRINT_UXR_S9_SCALE_OPT/S9-09 — /lore/history постранично сквозь REST: без
 * параметров ответ прежний (все версии), с limit — страница и честное has_more;
 * плохой параметр — 400.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreHistoryPageLiveDbTest {

    static final String SPRINT = "SPRINT_S909_HIST";
    static final String TASK = SPRINT + "/HP-1";

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    @Test
    void historyIsPagedNewestFirstAndSaysThereIsMore() {
        post("/lore/sprint/create", "{\"sprint_id\":\"" + SPRINT + "\"}");
        post("/lore/task", "{\"sprint_id\":\"" + SPRINT + "\",\"task_id\":\"HP-1\",\"title\":\"история\"}");
        post("/lore/status", "{\"entity_type\":\"task\",\"id\":\"" + TASK + "\",\"status\":\"active\"}");
        post("/lore/status", "{\"entity_type\":\"task\",\"id\":\"" + TASK + "\",\"status\":\"blocked\",\"reason\":\"тест: ждём доступ\"}"); // WK-05: blocked — с причиной

        JsonPath all = given().header("X-Seer-Role", "admin")
            .when().get("/lore/history?type=task&id=" + TASK).then().statusCode(200).extract().jsonPath();
        assertEquals(3, all.getList("rows").size(), "без параметров — вся цепочка, как раньше");
        assertEquals(false, all.getBoolean("page.has_more"));

        JsonPath p = given().header("X-Seer-Role", "admin")
            .when().get("/lore/history?type=task&id=" + TASK + "&order=desc&limit=1")
            .then().statusCode(200).extract().jsonPath();
        assertEquals(1, p.getList("rows").size());
        assertEquals("🔴 BLOCKED", p.getString("rows[0].status_raw"), "desc — последняя версия первой");
        assertEquals(3, p.getInt("page.total"));
        assertEquals(true, p.getBoolean("page.has_more"), "обрезка видна");

        given().header("X-Seer-Role", "admin")
            .when().get("/lore/history?type=task&id=" + TASK + "&field=title").then().statusCode(400);
    }
}
