package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.eclipse.microprofile.health.HealthCheckResponse;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * DBR-10 — readiness обязан отвечать про НАШУ базу, а не про порт сервера.
 *
 * <p>Прежняя проверка дёргала {@code /api/v1/ready} ArcadeDB и говорила «готов»
 * при живом HTTP-слое — независимо от того, открыта ли {@code system_aida_lore}
 * и принимается ли наш кред. В сценарии DBR-01/DBR-02 (кред отбит локаутом)
 * это означало бы «готов» у экземпляра, где каждый запрос падает 500.
 *
 * <p>Негативный кейс здесь несёт основную нагрузку. Позитивный сам по себе
 * ничего не доказывает: и старая проверка была бы на нём зелёной — сервер-то
 * поднят. Красным она обязана становиться именно тогда, когда сервер жив, а
 * база недоступна, и проверяется ровно это.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class ArcadeReadinessLiveDbTest {

    // @Readiness — квалификатор бина, без него инъекция не резолвится.
    @Inject
    @org.eclipse.microprofile.health.Readiness
    ArcadeReadinessCheck check;

    @Test
    void readyWhenOurOwnDatabaseAnswers() {
        given().when().get("/q/health/ready").then().statusCode(200)
            .body("checks.find { it.name == 'arcadedb' }.status", org.hamcrest.Matchers.equalTo("UP"));
    }

    @Test
    void downWhenTheServerIsAliveButOurDatabaseIsNot() {
        // Сервер тот же самый и заведомо жив — не отвечает только база.
        // Ровно этот случай старая проверка считала готовностью.
        HealthCheckResponse r = check.probe("lore_no_such_database_xyz").await().indefinitely();

        assertEquals(HealthCheckResponse.Status.DOWN, r.getStatus(),
            "живой сервер при недоступной базе — это НЕ готовность: бэкенд без своей базы "
            + "бесполезен, а оркестратор по такому сигналу держал бы его в ротации");

        String detail = String.valueOf(r.getData().orElseThrow().get("error"));
        assertTrue(detail != null && !detail.isBlank() && !"null".equals(detail),
            "причина обязана быть в ответе: «DOWN» без неё одинаково выглядит при упавшей БД, "
            + "неверном креде и несуществующей базе, а лечатся они по-разному");
    }
}
