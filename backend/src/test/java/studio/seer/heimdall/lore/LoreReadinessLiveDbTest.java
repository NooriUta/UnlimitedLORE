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
import static org.hamcrest.Matchers.notNullValue;

/**
 * PL-15 · ADR-LORE-029 (D17): готовность течёт СНИЗУ ВВЕРХ — задача → сценарий
 * → корень, и по дороге не теряется факт первого выпуска.
 *
 * Правило само по себе проверено без БД (UcReadinessCalculatorTest). Здесь —
 * то, что через БД: пересчёт цепляется к смене статуса задачи, поднимается по
 * иерархии, `shipped_at` ставится один раз, а рукой готовность не назначить.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreReadinessLiveDbTest {

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    private static void setStatus(String uid, String status) {
        post("/lore/status", "{\"entity_type\":\"task\",\"id\":\"" + uid + "\",\"status\":\"" + status + "\"}");
    }

    private static String ucStatus(String ucId) {
        return given().header("X-Seer-Role", "admin")
            .when().get("/lore/slice/features")
            .then().statusCode(200).extract()
            .path("rows.find { it.uc_id == '" + ucId + "' }.status");
    }

    @Test
    @Order(1)
    void setUp() {
        post("/lore/sprint/create", "{\"sprint_id\":\"SPRINT_RD\",\"name\":\"readiness\"}");
        post("/lore/feature", "{\"feature_id\":\"FEAT-RD\",\"title\":\"Корень\"}");
        post("/lore/uc", "{\"uc_id\":\"UC-RD-1\",\"title\":\"Сценарий\",\"parent_uc_id\":\"FEAT-RD\","
            + "\"goal_level\":\"sea-level\"}");
        // Ревьюер обязателен для перехода в done (ADR-014 §4) — иначе гейт
        // отклонит смену статуса, и пересчитывать будет нечего.
        post("/lore/task", "{\"sprint_id\":\"SPRINT_RD\",\"task_id\":\"R1\",\"title\":\"первая\","
            + "\"work_class\":\"uc\",\"uc_id\":\"UC-RD-1\",\"executor_agent\":\"a\",\"reviewer_agent\":\"b\"}");
        post("/lore/task", "{\"sprint_id\":\"SPRINT_RD\",\"task_id\":\"R2\",\"title\":\"вторая\","
            + "\"work_class\":\"uc\",\"uc_id\":\"UC-RD-1\",\"executor_agent\":\"a\",\"reviewer_agent\":\"b\"}");
    }

    /** Готовность рукой не объявить — ни у сценария, ни у корня. */
    @Test
    @Order(2)
    void computedStatusesAreRejectedOnWrite() {
        for (String s : new String[]{"active", "shipped", "in_rework"}) {
            given().header("X-Seer-Role", "admin").contentType("application/json")
                .body("{\"uc_id\":\"UC-RD-1\",\"status\":\"" + s + "\"}")
            .when().post("/lore/uc").then().statusCode(400);

            given().header("X-Seer-Role", "admin").contentType("application/json")
                .body("{\"feature_id\":\"FEAT-RD\",\"status\":\"" + s + "\"}")
            .when().post("/lore/feature").then().statusCode(400);
        }
        // Намерения проходят.
        post("/lore/uc", "{\"uc_id\":\"UC-RD-1\",\"status\":\"proposed\"}");
    }

    /** Первая закрытая задача из двух — сценарий «делается», не «выпущен». */
    @Test
    @Order(3)
    void partialProgressIsActive() {
        setStatus("SPRINT_RD/R1", "done");
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/use_cases_of_feature?id=FEAT-RD")
        .then().statusCode(200)
            .body("rows.find { it.uc_id == 'UC-RD-1' }.status", equalTo("active"));
    }

    /**
     * Все задачи закрыты — сценарий выпущен, `shipped_at` проставила СИСТЕМА,
     * и корень поднялся следом. Это и есть «расхождение невозможно по
     * построению»: никто не писал статус руками ни на одном уровне.
     */
    @Test
    @Order(4)
    void allTasksDoneShipsTheUcAndItsRoot() {
        setStatus("SPRINT_RD/R2", "done");

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/use_cases_of_feature?id=FEAT-RD")
        .then().statusCode(200)
            .body("rows.find { it.uc_id == 'UC-RD-1' }.status", equalTo("shipped"))
            .body("rows.find { it.uc_id == 'UC-RD-1' }.shipped_at", notNullValue());

        // Корень наследует транзитивно.
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/features")
        .then().statusCode(200)
            .body("rows.find { it.uc_id == 'FEAT-RD' }.status", equalTo("shipped"))
            .body("rows.find { it.uc_id == 'FEAT-RD' }.uc_shipped", equalTo(1))
            .body("rows.find { it.uc_id == 'FEAT-RD' }.shipped_at", notNullValue());
    }

    /**
     * OQ-022-REENG вариант «б»: новая работа поверх выпущенного даёт in_rework,
     * а факт выпуска (`shipped_at`) переживает доработку. Если бы статус просто
     * откатывался в active, ответ на вопрос «выпускали ли мы это» терялся бы
     * после первой же правки.
     */
    @Test
    @Order(5)
    void reworkKeepsShippedAt() {
        String shippedAt = given().header("X-Seer-Role", "admin")
            .when().get("/lore/slice/use_cases_of_feature?id=FEAT-RD")
            .then().statusCode(200).extract()
            .path("rows.find { it.uc_id == 'UC-RD-1' }.shipped_at");

        post("/lore/task", "{\"sprint_id\":\"SPRINT_RD\",\"task_id\":\"R3\",\"title\":\"доработка\","
            + "\"work_class\":\"uc\",\"uc_id\":\"UC-RD-1\",\"executor_agent\":\"a\",\"reviewer_agent\":\"b\"}");
        setStatus("SPRINT_RD/R3", "active");

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/use_cases_of_feature?id=FEAT-RD")
        .then().statusCode(200)
            .body("rows.find { it.uc_id == 'UC-RD-1' }.status", equalTo("in_rework"))
            .body("rows.find { it.uc_id == 'UC-RD-1' }.shipped_at", equalTo(shippedAt));

        // Доработка закрыта — снова shipped, и shipped_at ТОТ ЖЕ: система
        // ставит его один раз, а не переписывает на каждый выпуск.
        setStatus("SPRINT_RD/R3", "done");
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/use_cases_of_feature?id=FEAT-RD")
        .then().statusCode(200)
            .body("rows.find { it.uc_id == 'UC-RD-1' }.status", equalTo("shipped"))
            .body("rows.find { it.uc_id == 'UC-RD-1' }.shipped_at", equalTo(shippedAt));
    }

    /** `dropped` — решение человека о ненужности; вычислитель его не перебивает. */
    @Test
    @Order(6)
    void droppedIsNotOverriddenByTheCalculator() {
        post("/lore/uc", "{\"uc_id\":\"UC-RD-2\",\"title\":\"Отменённый\",\"parent_uc_id\":\"FEAT-RD\","
            + "\"goal_level\":\"sea-level\",\"status\":\"dropped\"}");
        post("/lore/task", "{\"sprint_id\":\"SPRINT_RD\",\"task_id\":\"R4\",\"title\":\"по отменённому\","
            + "\"work_class\":\"uc\",\"uc_id\":\"UC-RD-2\",\"executor_agent\":\"a\",\"reviewer_agent\":\"b\"}");
        setStatus("SPRINT_RD/R4", "done");

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/use_cases_of_feature?id=FEAT-RD")
        .then().statusCode(200)
            .body("rows.find { it.uc_id == 'UC-RD-2' }.status", equalTo("dropped"));
    }
}
