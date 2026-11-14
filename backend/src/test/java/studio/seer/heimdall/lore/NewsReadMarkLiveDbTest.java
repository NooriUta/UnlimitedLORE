package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.startsWith;

/**
 * Владелица 14.11.2026: «Черта «прочитано» недоступна: Received: 'Bad Request, status code 400'
 * when invoking REST Client method LoreCommandClient#command». До этого запись черты
 * ({@code UPDATE LoreNewsReadMark … UPSERT}) проверялась только заглушками — настоящий SQL на
 * ArcadeDB не гонялся ни разу. Здесь — полный круг на базе: PUT ставит, GET читает, повтор
 * сдвигает ту же запись (UPSERT, а не вторую).
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class NewsReadMarkLiveDbTest {

    /** Встроенная тест-база шаги миграций не накатывает — тип заводится тем же DDL, что у шага V70. */
    @BeforeEach
    void schema() throws Exception {
        for (String ddl : LoreNewsReadMarkStore.SCHEMA_SQL) {
            java.net.http.HttpRequest req = java.net.http.HttpRequest.newBuilder(java.net.URI.create(
                    LoreArcadeDbTestResource.BASE_URL + "/api/v1/command/" + LoreArcadeDbTestResource.TEST_DB))
                .header("Content-Type", "application/json; charset=utf-8")
                .header("Authorization", "Basic " + java.util.Base64.getEncoder().encodeToString(
                    ("root:" + LoreArcadeDbTestResource.ROOT_PASSWORD).getBytes(java.nio.charset.StandardCharsets.UTF_8)))
                .POST(java.net.http.HttpRequest.BodyPublishers.ofString(
                    io.vertx.core.json.JsonObject.of("language", "sql", "command", ddl).encode(), java.nio.charset.StandardCharsets.UTF_8))
                .build();
            LiveDbHttp.client().send(req, java.net.http.HttpResponse.BodyHandlers.ofString());
        }
    }

    private static void put(String at) {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"at\":\"" + at + "\"}")
            .when().put("/lore/news/v2/read-mark")
            .then().statusCode(200).body("state", equalTo("ok")).body("at", startsWith(at.substring(0, 16)));
    }

    @Test
    void markIsWrittenReadAndMovedOnTheRealDatabase() {
        put("2026-11-14T12:00:00Z");
        given().when().get("/lore/news/v2/read-mark")
            .then().statusCode(200).body("state", equalTo("ok")).body("at", startsWith("2026-11-14T12:00"));
        put("2026-11-14T13:30:00Z");
        given().when().get("/lore/news/v2/read-mark")
            .then().statusCode(200).body("at", startsWith("2026-11-14T13:30"));
    }
}
