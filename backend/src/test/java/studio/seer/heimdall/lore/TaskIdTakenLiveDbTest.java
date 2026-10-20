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
 * SE-17 на живом пути: повторный task_new с тем же кодом — 409 TASK_ID_TAKEN со
 * следующим свободным кодом, а не 502 LORE_UPSTREAM «Conflict 409 … command».
 * Положительный контроль — первое создание проходит, иначе «409» мог бы
 * значить что угодно.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class TaskIdTakenLiveDbTest {

    private static final String SPRINT = "SPRINT_SE17_TAKEN";

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    private static String task(String id) {
        return io.vertx.core.json.JsonObject.of("sprint_id", SPRINT, "task_id", id, "title", "SE-17 " + id).encode();
    }

    @Test
    @Order(1)
    void firstCreationPasses() {
        admin().body("{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"SE-17\"}")
            .when().post("/lore/sprint/create").then().statusCode(200);
        admin().body(task("TK-01")).when().post("/lore/task").then().statusCode(200);
        admin().body(task("TK-04")).when().post("/lore/task").then().statusCode(200);
    }

    @Test
    @Order(2)
    void duplicateIsNamedAndNextFreeIsSuggested() {
        admin().body(task("TK-01")).when().post("/lore/task")
            .then().statusCode(409)
            .body("error", equalTo("TASK_ID_TAKEN"))
            .body("task_id", equalTo("TK-01"))
            .body("suggested_task_id", equalTo("TK-05"))
            .body("detail", containsString("TK-05"));
    }
}
