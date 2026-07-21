package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;

/**
 * ADR-LORE-022 (PL-07): продуктовый слой на изолированной БД — V6-миграция
 * создала типы, REST держит рёбра в синхроне, слайсы отдают граф.
 * Ключевые инварианты: «фича целиком» вычисляется (D4), актор — вершина
 * с multi-связью (D12), include/extend — поперечные рёбра (D13),
 * linked-валидация не даёт тихих no-op.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreProductLayerLiveDbTest {

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    @Test
    @Order(1)
    void featureUcActorGraphRoundTrip() {
        post("/lore/feature", "{\"feature_id\":\"FEAT-T\",\"title\":\"Тестовая фича\","
            + "\"body_md\":\"ценность\",\"context_md\":\"большой контекст (D13)\",\"status\":\"active\"}");
        post("/lore/uc", "{\"uc_id\":\"UC-T-1\",\"title\":\"Базовый сценарий\",\"parent_uc_id\":\"FEAT-T\",\"status\":\"shipped\"}");
        post("/lore/uc", "{\"uc_id\":\"UC-T-2\",\"title\":\"Второй сценарий\",\"parent_uc_id\":\"FEAT-T\",\"status\":\"active\"}");
        post("/lore/actor", "{\"actor_id\":\"ACT-T-ADMIN\",\"name\":\"Администратор\",\"kind\":\"human-role\"}");
        post("/lore/actor", "{\"actor_id\":\"ACT-T-AGENT\",\"name\":\"Агент сессии\",\"kind\":\"agent\"}");
        // D12: у сценария НЕСКОЛЬКО акторов.
        post("/lore/uc/link", "{\"uc_id\":\"UC-T-1\",\"rel\":\"actor\",\"target_id\":\"ACT-T-ADMIN\"}");
        post("/lore/uc/link", "{\"uc_id\":\"UC-T-1\",\"rel\":\"actor\",\"target_id\":\"ACT-T-AGENT\"}");
        // D13: поперечная связь UC-графа.
        post("/lore/uc/link", "{\"uc_id\":\"UC-T-2\",\"rel\":\"includes\",\"target_id\":\"UC-T-1\"}");

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/use_cases_of_feature?id=FEAT-T")
        .then().statusCode(200)
            .body("rows.find { it.uc_id == 'UC-T-1' }.actor_ids", hasItem("ACT-T-ADMIN"))
            .body("rows.find { it.uc_id == 'UC-T-1' }.actor_ids", hasItem("ACT-T-AGENT"))
            .body("rows.find { it.uc_id == 'UC-T-2' }.includes_uc", hasItem("UC-T-1"))
            .body("rows.find { it.uc_id == 'UC-T-1' }.included_by", hasItem("UC-T-2"));
    }

    @Test
    @Order(2)
    void featureProgressIsComputedNotStored() {
        // D4: 1 из 2 UC shipped — счётчики выводит слайс, ручной shipped на фиче запрещён.
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/features")
        .then().statusCode(200)
            .body("rows.find { it.uc_id == 'FEAT-T' }.uc_total", equalTo(2))
            .body("rows.find { it.uc_id == 'FEAT-T' }.uc_shipped", equalTo(1))
            .body("rows.find { it.uc_id == 'FEAT-T' }.context_md", equalTo("большой контекст (D13)"));

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"feature_id\":\"FEAT-T\",\"status\":\"shipped\"}")
        .when().post("/lore/feature")
        .then().statusCode(400); // D4: shipped не назначается рукой
    }

    @Test
    @Order(3)
    void silentNoOpIsSurfaced() {
        // Правило корпуса: ребро в несуществующую цель = linked:false + hint, не «успех».
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"uc_id\":\"UC-T-1\",\"rel\":\"actor\",\"target_id\":\"ACT-NO-SUCH\"}")
        .when().post("/lore/uc/link")
        .then().statusCode(200).body("linked", equalTo(false));

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"uc_id\":\"UC-T-9\",\"title\":\"сирота\",\"parent_uc_id\":\"FEAT-NO-SUCH\"}")
        .when().post("/lore/uc")
        .then().statusCode(200).body("parent_linked", equalTo(false));
    }

    @Test
    @Order(4)
    void workClassOnTaskAndRealizes() {
        post("/lore/sprint/create", "{\"sprint_id\":\"SPRINT_PLT\",\"name\":\"plt\"}");
        post("/lore/task", "{\"sprint_id\":\"SPRINT_PLT\",\"task_id\":\"P1\",\"title\":\"uc-задача\",\"work_class\":\"uc\"}");
        post("/lore/uc/link", "{\"uc_id\":\"UC-T-1\",\"rel\":\"task\",\"target_id\":\"SPRINT_PLT/P1\"}");

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/tasks_of_sprint?sprint_id=SPRINT_PLT")
        .then().statusCode(200)
            .body("rows.find { it.task_id == 'P1' }.work_class", equalTo("uc"))
            .body("rows.find { it.task_id == 'P1' }.realizes_uc", hasItem("UC-T-1"));

        // Валидация закрытого канона.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"sprint_id\":\"SPRINT_PLT\",\"task_id\":\"P2\",\"title\":\"x\",\"work_class\":\"epic\"}")
        .when().post("/lore/task")
        .then().statusCode(400);
    }
}
