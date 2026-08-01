package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.notNullValue;

/**
 * AN-08 (ADR-LORE-030 §2 срез F): распределение оценок — ТОТ ЖЕ линтер UcQuality,
 * что панель формы и uc_new/uc_set (правила не дублируются, 027-D3).
 * Ключевой инвариант — НОРМИРОВКА: знаменатель у casual меньше, чем у
 * fully-dressed (027-D1), сырые score несравнимы, сравнивается score/max
 * своего веса — иначе casual-UC ложно «лучше».
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreUcQualityDistributionLiveDbTest {

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    @Test
    void distributionCallsTheSameLinterAndFlagsConsistently() {
        post("/lore/feature", "{\"feature_id\":\"FEAT-QLT\",\"title\":\"Фича качества\"}");
        post("/lore/uc", "{\"uc_id\":\"UC-QLT-EMPTY\",\"title\":\"Голый сценарий\","
            + "\"parent_uc_id\":\"FEAT-QLT\",\"goal_level\":\"sea-level\"}");

        // Эталон — пер-UC линтер (ADR-027-D3): срез обязан отдать ТЕ ЖЕ цифры,
        // это и есть «зовёт его же, не дублирует правила».
        var single = given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"uc_id\":\"UC-QLT-EMPTY\"}")
            .when().post("/lore/uc/quality")
            .then().statusCode(200).extract();
        int score = single.path("score");
        int max = single.path("max");

        var all = given().when().get("/lore/uc/quality/all")
            .then().statusCode(200)
            // Порог и пояснение нормировки — в ответе, не в чьей-то голове.
            .body("threshold", notNullValue())
            .body("note", notNullValue())
            .rootPath("rows.find { it.uc_id == 'UC-QLT-EMPTY' }")
            .body("max", greaterThan(0))
            .body("score", equalTo(score))
            .body("max", equalTo(max))
            .body("goal_level", equalTo("sea-level"))
            .extract();

        // Флаг согласован с порогом и нормировкой — не самостоятельное мнение.
        float threshold = ((Number) all.path("threshold")).floatValue();
        float normalized = ((Number) all.path("rows.find { it.uc_id == 'UC-QLT-EMPTY' }.normalized")).floatValue();
        boolean below = all.path("rows.find { it.uc_id == 'UC-QLT-EMPTY' }.below_threshold");
        org.junit.jupiter.api.Assertions.assertEquals(normalized < threshold, below,
            "below_threshold обязан быть строго normalized < threshold");
        org.junit.jupiter.api.Assertions.assertTrue(normalized >= 0f && normalized <= 1f,
            "normalized — доля [0..1] от обязательных проверок СВОЕГО веса");
    }
}
