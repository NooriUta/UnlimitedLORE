package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.hasItem;

/**
 * PL-19: паспорт ADR читает прослеживаемость В ОБЕ стороны.
 *
 * <p>Слайс `adr` отдавал только ИСХОДЯЩИЕ рёбра (depends_on, supersedes,
 * implemented_in). «На что этот ADR влияет» — сценарии через TRACED_TO и задачи
 * через JUSTIFIED_BY — читалось лишь с другой стороны: открыв каждый сценарий и
 * каждую задачу по отдельности. Тест держит именно обратный обход: создаём
 * ссылку со стороны UC/задачи и проверяем, что она видна СО СТОРОНЫ ADR.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreAdrBacklinksLiveDbTest {

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    @Test
    @Order(1)
    void setUp() {
        post("/lore/adr", "{\"adr_id\":\"ADR-BL-1\",\"name\":\"backlink target\",\"status\":\"ACCEPTED\"}");

        // Сценарий → ADR (TRACED_TO). goal_level обязателен — линтер иначе
        // прячет узел; берём sea-level, чтобы это был именно сценарий.
        post("/lore/uc", "{\"uc_id\":\"UC-BL-1\",\"title\":\"tracer\",\"goal_level\":\"sea-level\"}");
        post("/lore/uc/link", "{\"uc_id\":\"UC-BL-1\",\"rel\":\"adr\",\"target_id\":\"ADR-BL-1\"}");

        // Задача → ADR (JUSTIFIED_BY) через task_link rel="adr" (PL-14).
        post("/lore/sprint/create", "{\"sprint_id\":\"SPRINT_BL\",\"name\":\"backlinks\"}");
        post("/lore/task", "{\"sprint_id\":\"SPRINT_BL\",\"task_id\":\"T-BL\",\"title\":\"enabler\",\"work_class\":\"enb\"}");
        post("/lore/task/adr", "{\"task_uid\":\"SPRINT_BL/T-BL\",\"adr_id\":\"ADR-BL-1\"}");
    }

    /** Со стороны ADR видны и сценарий, и задача, сославшиеся на него. */
    @Test
    @Order(2)
    void adrPassportSeesWhatPointsAtIt() {
        given().header("X-Seer-Role", "admin").queryParam("id", "ADR-BL-1")
        .when().get("/lore/slice/adr")
        .then().statusCode(200)
            .body("rows[0].traced_by_ucs", hasItem("UC-BL-1"))
            .body("rows[0].justified_task_uids", hasItem("SPRINT_BL/T-BL"));
    }
}
