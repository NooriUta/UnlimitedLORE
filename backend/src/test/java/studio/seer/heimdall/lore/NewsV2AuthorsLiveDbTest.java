package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import io.quarkus.test.security.jwt.Claim;
import io.quarkus.test.security.jwt.JwtSecurity;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S7A_NEWS/S7A-01 — атрибуция «человек / агент» в ленте новостей v2.
 *
 * <p>Автор версии пишется в историю с S2-12 ({@code changed_by}, {@code changed_by_kind}),
 * но лента брала {@code AuthorResolver.UNKNOWN} — все события «неизвестно», доля
 * агентов не считалась. Тест: правка от имени человека даёт в ленте автора-человека.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class NewsV2AuthorsLiveDbTest {

    static final String SUB = "s7a01-human-sub";
    static final String SPRINT = "SPRINT_S7A01_AUTHORS";
    static final String TASK = SPRINT + "/AU-1";

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    @Test
    @TestSecurity(user = "s7a01", roles = {"admin"})
    @JwtSecurity(claims = {@Claim(key = "sub", value = SUB)})
    void humanEditIsAttributedToTheHumanInTheFeed() {
        post("/lore/sprint/create", "{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"Авторы в новостях\"}");
        post("/lore/task", "{\"sprint_id\":\"" + SPRINT + "\",\"task_id\":\"AU-1\",\"title\":\"Кто правил\"}");
        post("/lore/status", "{\"entity_type\":\"task\",\"id\":\"" + TASK + "\",\"status\":\"active\"}");

        List<Map<String, Object>> events = given().header("X-Seer-Role", "admin")
            .when().get("/lore/news/v2?days=1&limit=5000").then().statusCode(200)
            .extract().jsonPath().getList("events.findAll { it.el == '" + TASK + "' }");
        assertFalse(events.isEmpty(), "у задачи есть события в ленте за сутки");
        assertTrue(events.stream().anyMatch(e -> "human".equals(e.get("author")) && SUB.equals(e.get("who"))),
            "правка человеком атрибутирована человеку, а не «неизвестно»: " + events);
    }
}
