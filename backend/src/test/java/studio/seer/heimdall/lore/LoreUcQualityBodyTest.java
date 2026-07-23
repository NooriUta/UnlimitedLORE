package studio.seer.heimdall.lore;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.greaterThan;

/**
 * PL-17: линтер оценивает НАБИРАЕМОЕ тело, а не только сохранённый UC.
 *
 * <p>Эндпоинт требовал `uc_id` и читал запись из графа. Форме создания это не
 * годится по построению: записи ещё нет, оценивать нечего — ровно поэтому
 * готовый линтер из фронта не звался ни разу, а «живой чек-лист» из ADR-027
 * оставался обещанием.
 *
 * <p>БД здесь не нужна: разбор тела — чистая функция, и тест это фиксирует.
 */
@QuarkusTest
class LoreUcQualityBodyTest {

    private static io.restassured.response.Response lint(String body) {
        return given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(body).when().post("/lore/uc/quality").then().statusCode(200).extract().response();
    }

    /** Пустой сценарий: счёт 0, но знаменатель НЕ нулевой — форма показывает, что впереди. */
    @Test
    void emptyScenarioScoresZeroOutOfSomething() {
        var r = lint("{\"scenario_md\":\"\",\"acceptance_md\":\"\",\"rigor\":\"casual\"}");
        r.then().body("score", equalTo(0)).body("max", greaterThan(0));
    }

    /**
     * Заполненный по шаблону casual — счёт растёт.
     *
     * <p>Проверяется именно РОСТ относительно пустого, а не конкретное число:
     * состав проверок задаёт ADR и он будет пополняться, а привязка к «7 из 8»
     * ломала бы тест при каждом новом правиле, ничего не защищая.
     */
    @Test
    void filledScenarioScoresHigher() {
        String md = "### Триггер\\nАгент открыл PR.\\n\\n### Основной сценарий\\n1. Проверяем CI\\n2. Мержим\\n\\n"
            + "### Минимальные гарантии\\nВетка не сломана.\\n";
        var empty = lint("{\"scenario_md\":\"\",\"rigor\":\"casual\"}").jsonPath().getInt("score");
        var filled = lint("{\"scenario_md\":\"" + md + "\",\"acceptance_md\":\"1. CI зелёный\",\"rigor\":\"casual\","
            + "\"goal_level\":\"sea-level\"}").jsonPath().getInt("score");
        org.junit.jupiter.api.Assertions.assertTrue(filled > empty,
            "заполненный по шаблону сценарий обязан набирать больше пустого: " + filled + " vs " + empty);
    }

    /**
     * Вес меняет ЗНАМЕНАТЕЛЬ: у casual обязательных проверок меньше.
     *
     * <p>Это то, что видит пользователь при переключении веса в форме, и самая
     * правдоподобная поломка — оценивать оба веса по одному набору: тогда
     * переключение ничего не меняет, и вес выглядит косметикой.
     */
    @Test
    void casualHasFewerRequiredChecksThanFullyDressed() {
        int casualMax = lint("{\"scenario_md\":\"x\",\"rigor\":\"casual\"}").jsonPath().getInt("max");
        int fullMax = lint("{\"scenario_md\":\"x\",\"rigor\":\"fully-dressed\"}").jsonPath().getInt("max");
        org.junit.jupiter.api.Assertions.assertTrue(fullMax > casualMax,
            "у полного веса обязательных проверок должно быть больше: " + fullMax + " vs " + casualMax);
    }

    /** Без тела и без uc_id — понятный отказ, а не 500. */
    @Test
    void neitherIdNorBodyIsRefused() {
        given().header("X-Seer-Role", "admin").contentType("application/json").body("{}")
        .when().post("/lore/uc/quality")
        .then().statusCode(400);
    }
}
