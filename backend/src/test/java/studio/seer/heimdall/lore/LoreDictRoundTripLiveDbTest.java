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
 * AL-48, регрессия AL-19/AL-28 («админка врала»): запись значения словаря через
 * /lore/dict/entry обязана доехать до слайса dictionary — ровно тот контракт,
 * которым живёт Admin LORE (D4: UI пишет теми же эндпоинтами, что MCP).
 * Живая изолированная БД (testcontainers, lore_c5_test) — system_aida_lore не трогается.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreDictRoundTripLiveDbTest {

    private static final String CODE = "al48-roundtrip";

    @Test
    @Order(1)
    void writeReachesTheSlice() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"dict_type\":\"tag\",\"code\":\"" + CODE + "\",\"label_ru\":\"AL-48 тест\","
                + "\"color\":\"var(--inf)\",\"icon\":\"tied-scroll\",\"sort_order\":990,\"is_active\":true}")
        .when().post("/lore/dict/entry")
        .then().statusCode(200);

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/dictionary?dict_type=tag")
        .then().statusCode(200)
            .body("rows.code", hasItem(CODE))
            .body("rows.find { it.code == '" + CODE + "' }.label_ru", equalTo("AL-48 тест"))
            .body("rows.find { it.code == '" + CODE + "' }.color", equalTo("var(--inf)"))
            .body("rows.find { it.code == '" + CODE + "' }.icon", equalTo("tied-scroll"));
    }

    @Test
    @Order(2)
    void partialUpdateDoesNotWipeOmittedFields() {
        // Партиальный upsert (ADR-025 D4): правим label — цвет/иконка НЕ затираются.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"dict_type\":\"tag\",\"code\":\"" + CODE + "\",\"label_ru\":\"AL-48 правка\"}")
        .when().post("/lore/dict/entry")
        .then().statusCode(200);

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/dictionary?dict_type=tag")
        .then().statusCode(200)
            .body("rows.find { it.code == '" + CODE + "' }.label_ru", equalTo("AL-48 правка"))
            .body("rows.find { it.code == '" + CODE + "' }.color", equalTo("var(--inf)"))
            .body("rows.find { it.code == '" + CODE + "' }.icon", equalTo("tied-scroll"));
    }

    @Test
    @Order(3)
    void softDeleteHidesFromActiveConsumers() {
        // Снятие is_active — так «Удалить» в Настройках прячет неопознанные ключи.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"dict_type\":\"tag\",\"code\":\"" + CODE + "\",\"is_active\":false}")
        .when().post("/lore/dict/entry")
        .then().statusCode(200);

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/dictionary?dict_type=tag")
        .then().statusCode(200)
            .body("rows.find { it.code == '" + CODE + "' }.is_active", equalTo(false));
    }
}
