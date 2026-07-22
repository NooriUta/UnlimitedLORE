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

/**
 * PL-29: валидация уровня цели идёт по СЛОВАРЮ-канону, а не по Java-константе.
 *
 * Раньше write-path сверялся только с константой `UC_GOAL_LEVELS`, а словарь
 * `uc_goal_level` на записи не читался вовсе — при том что комментарий рядом
 * утверждал «канон, словарь uc_goal_level». Правка словаря не меняла
 * поведения, правка константы не меняла словаря: две правды, синхронизация на
 * внимательности.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreDictValidationLiveDbTest {

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    /** Сидированные значения принимаются — базовая линия. */
    @Test
    @Order(1)
    void seededLevelsPass() {
        post("/lore/feature", "{\"feature_id\":\"FEAT-DC\",\"title\":\"Корень\"}");
        post("/lore/uc", "{\"uc_id\":\"UC-DC-1\",\"title\":\"Сценарий\",\"parent_uc_id\":\"FEAT-DC\","
            + "\"goal_level\":\"sea-level\"}");
    }

    /** Значение вне словаря отбивается 400 — канон закрытый. */
    @Test
    @Order(2)
    void valueOutsideTheDictionaryIsRejected() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"uc_id\":\"UC-DC-BAD\",\"goal_level\":\"stratosphere\"}")
        .when().post("/lore/uc")
        .then().statusCode(400);
    }

    /**
     * Главная проверка: добавили значение В СЛОВАРЬ — оно начинает приниматься
     * БЕЗ пересборки. Если валидация читает константу, тест падает здесь, и
     * именно этим он полезен: расхождение словаря и кода становится видимым.
     */
    @Test
    @Order(3)
    void addingToTheDictionaryImmediatelyWidensValidation() {
        post("/lore/dict/entry", "{\"dict_type\":\"uc_goal_level\",\"code\":\"stratosphere\","
            + "\"label_ru\":\"🛰 Стратосфера — испытательный уровень\",\"sort_order\":50}");

        post("/lore/uc", "{\"uc_id\":\"UC-DC-BAD\",\"title\":\"Теперь можно\",\"goal_level\":\"stratosphere\"}");

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/use_cases_of_feature?id=FEAT-DC")
        .then().statusCode(200);
    }

    /**
     * Выведенное из обращения значение перестаёт проходить. Справочник тем и
     * полезен, что деактивация — это управляющее действие, а не пометка: иначе
     * «убрали из словаря» ничего не меняло бы на записи.
     */
    @Test
    @Order(4)
    void deactivatedValueStopsBeingAccepted() {
        post("/lore/dict/entry", "{\"dict_type\":\"uc_goal_level\",\"code\":\"stratosphere\","
            + "\"label_ru\":\"🛰 Стратосфера\",\"is_active\":false}");

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"uc_id\":\"UC-DC-2\",\"goal_level\":\"stratosphere\"}")
        .when().post("/lore/uc")
        .then().statusCode(400);
    }

    /** Корень по-прежнему ограничен верхними ступенями — это правило ADR-032 §1, не словарь. */
    @Test
    @Order(5)
    void rootAltitudeRuleIsIndependentOfTheDictionary() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"feature_id\":\"FEAT-DC-BAD\",\"goal_level\":\"sea-level\"}")
        .when().post("/lore/feature")
        .then().statusCode(400)
            .body("error", equalTo("BAD_PARAMS"));
    }
}
