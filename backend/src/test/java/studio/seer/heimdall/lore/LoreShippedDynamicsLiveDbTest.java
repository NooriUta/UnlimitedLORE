package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;

/**
 * AN-05 (ADR-LORE-030 §2 срез C, PL-15): shipped-динамика на shipped_at,
 * который ставит ТОЛЬКО вычислитель D17 при первом переходе в shipped.
 * Lead time собирается из дат первой IN PROGRESS-ревизии REALIZES-задач
 * (история, НЕ valid_from вершин — SCD2-ловушка: по valid_from вышло бы ~0).
 * Периоды/релизы группирует клиент — сырые строки, GROUP BY-ловушка.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreShippedDynamicsLiveDbTest {

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    @Test
    void shippedUcCarriesLeadTimeInputs() {
        post("/lore/feature", "{\"feature_id\":\"FEAT-SHIP\",\"title\":\"Фича динамики\"}");
        post("/lore/uc", "{\"uc_id\":\"UC-SHIP\",\"title\":\"Выехавший сценарий\","
            + "\"parent_uc_id\":\"FEAT-SHIP\",\"goal_level\":\"sea-level\"}");
        post("/lore/sprint/create", "{\"sprint_id\":\"SPRINT_SHIP_TEST\",\"name\":\"Спринт динамики\"}");
        // Ревьюер ≠ исполнитель — иначе done отобьёт гейт ADR-LORE-014 §4.
        post("/lore/task", "{\"sprint_id\":\"SPRINT_SHIP_TEST\",\"task_id\":\"SHIP-1\","
            + "\"title\":\"Задача доставки\",\"work_class\":\"uc\",\"uc_id\":\"UC-SHIP\","
            + "\"executor_agent\":\"claude-full\",\"reviewer_agent\":\"architect\"}");

        // До выпуска сценарий в срез не попадает: shipped_at ещё не существует.
        given().when().get("/lore/slice/shipped_dynamics")
        .then().statusCode(200)
            .body("rows.uc_id", not(hasItem("UC-SHIP")));

        // Жизненный цикл задачи: active (первая IN PROGRESS-ревизия = старт
        // lead time) → done (вычислитель D17 переводит UC в shipped и ставит штамп).
        post("/lore/status", "{\"entity_type\":\"task\",\"id\":\"SPRINT_SHIP_TEST/SHIP-1\","
            + "\"status\":\"active\"}");
        post("/lore/status", "{\"entity_type\":\"task\",\"id\":\"SPRINT_SHIP_TEST/SHIP-1\","
            + "\"status\":\"done\"}");

        given().when().get("/lore/slice/shipped_dynamics")
        .then().statusCode(200)
            .rootPath("rows.find { it.uc_id == 'UC-SHIP' }")
            .body("shipped_at", notNullValue())
            .body("status", equalTo("shipped"))
            .body("root_uc_id", equalTo("FEAT-SHIP"))
            .body("task_uids", hasItem("SPRINT_SHIP_TEST/SHIP-1"))
            // Вход lead time: дата первой IN PROGRESS-ревизии задачи есть в строке.
            .body("active_since_dates", notNullValue())
            .body("active_since_dates.size()", equalTo(1));
    }
}
