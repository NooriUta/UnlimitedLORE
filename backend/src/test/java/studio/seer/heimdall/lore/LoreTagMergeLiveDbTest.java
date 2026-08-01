package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

/**
 * AL-29 (OQ-ADMIN-TAG-SPLIT): LoreTag схлопнут в KnowTag (миграция V17,
 * LoreSchemaMigrationRunner#mergeLoreTagIntoKnowTag). Тестконтейнер стартует
 * на свежей БД с lore.migrate=true (LoreArcadeDbTestResource) — миграция уже
 * отработала до первого теста, LoreTag в ней пуст с рождения (bootstrap
 * создаёт тип, данных в нём нет), поэтому здесь проверяется ПОВЕДЕНИЕ ПОСЛЕ
 * слияния (тип снесён, старый слайс мёртв, канон работает), а не перенос
 * реальных строк — тот сценарий живёт только на проде с историческими
 * данными и проверяется вручную после деплоя (см. RUNBOOK/note_md задачи).
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreTagMergeLiveDbTest {

    /** Тип LoreTag обязан ОТСУТСТВОВАТЬ — иначе слияние существует только на бумаге. */
    @Test
    void loreTagSliceIsGone() {
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/lore_tags_usage")
        .then().statusCode(404)
            .body("error", equalTo("UNKNOWN_SLICE"));
    }

    /** KnowTag остаётся единственным живым каноном — тот же слайс, что и раньше. */
    @Test
    void knowTagSliceStillWorks() {
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/tags_usage")
        .then().statusCode(200);
    }
}
