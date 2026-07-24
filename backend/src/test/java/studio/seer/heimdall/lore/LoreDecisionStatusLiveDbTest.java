package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;

/**
 * AL-79 (указание владельца 2026-07-23): статус решения — значение словаря
 * decision_status (V14), а не свободный текст, и у него есть инструмент
 * простановки. До этого статусы существовали только у решений, залитых прямой
 * записью при сидировании, а decision_new статуса не имел вовсе.
 * Поле вершины — status_raw (там же лежат статусы сида, его читают слайсы).
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreDecisionStatusLiveDbTest {

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    @Test
    @Order(1)
    void createAcceptsOnlyDictionaryStatuses() {
        // Свободный текст отбивается СО СПИСКОМ допустимых — не молчаливым ok.
        admin().body("{\"decision_id\":\"D-ST-BAD\",\"title\":\"Правило со статусом-фантазией\","
                + "\"status\":\"утверждено-навсегда\"}")
            .when().post("/lore/decision")
            .then().statusCode(400)
            .body("detail", containsString("decision_status"));

        admin().body("{\"decision_id\":\"D-ST-1\",\"title\":\"Правило со словарным статусом\","
                + "\"status\":\"proposed\"}")
            .when().post("/lore/decision")
            .then().statusCode(200).body("ok", equalTo(true));

        given().when().get("/lore/slice/decision?id=D-ST-1")
            .then().statusCode(200)
            .body("rows[0].status_raw", equalTo("proposed"));
    }

    @Test
    @Order(2)
    void statusFlipReturnsOldAndNewAndMissingDecisionIs404() {
        admin().body("{\"decision_id\":\"D-ST-1\",\"status\":\"accepted\"}")
            .when().post("/lore/decision/status")
            .then().statusCode(200)
            .body("ok", equalTo(true))
            .body("old_status", equalTo("proposed"))
            .body("new_status", equalTo("accepted"));

        // Несуществующее решение — жёсткий 404, а не ok:true-ловушка.
        admin().body("{\"decision_id\":\"D-ST-GHOST\",\"status\":\"accepted\"}")
            .when().post("/lore/decision/status")
            .then().statusCode(404);

        // Значение мимо словаря — 400 со списком.
        admin().body("{\"decision_id\":\"D-ST-1\",\"status\":\"вечное\"}")
            .when().post("/lore/decision/status")
            .then().statusCode(400)
            .body("detail", containsString("decision_status"));
    }

    @Test
    @Order(3)
    void statusOmittedStaysUntouchedOnUpsert() {
        // Повторный upsert без статуса не затирает проставленный (LH-44-семантика).
        admin().body("{\"decision_id\":\"D-ST-1\",\"title\":\"Правило со словарным статусом (ред. 2)\"}")
            .when().post("/lore/decision")
            .then().statusCode(200).body("ok", equalTo(true));

        given().when().get("/lore/slice/decision?id=D-ST-1")
            .then().statusCode(200)
            .body("rows[0].status_raw", equalTo("accepted"));
    }
}
