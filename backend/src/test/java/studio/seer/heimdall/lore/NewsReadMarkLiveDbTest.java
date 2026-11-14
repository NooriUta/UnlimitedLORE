package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
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
