package studio.seer.heimdall.lore;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;

/**
 * OH-MCP-HOSTED-SWITCH (1.18.1): правило «роль не выше главной harness» проверяется сервером ДО Keycloak — отказ
 * словами (409), а не 503 «KC не настроен». Отказ по рангу (младшая главная) — LoreModelAgentProfilesTest:
 * в действующей модели у всех трёх harness главная — full.
 */
@QuarkusTest
class LoreKcMcpAccountsEndpointTest {

    @Test
    void harnessWithoutMainRefusesInWordsBeforeKc() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"profile\":\"tester\",\"harness\":\"dsh\"}")
        .when().post("/lore/kc/agent-client")
        .then().statusCode(409).body("error", equalTo("ROLE_ABOVE_HARNESS_MAIN"))
            .body("detail", containsString("главная роль"));
    }

    @Test
    void unknownRoleIsRefused() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"profile\":\"ghost\",\"harness\":\"claude-code\"}")
        .when().post("/lore/kc/agent-client")
        .then().statusCode(409).body("detail", containsString("ghost"));
    }

    @Test
    void allowedRoleGoesOnToKcBridge() {
        // Правило пропустило — дальше честное «KC не настроен» тестового окружения, а не отказ правилом.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"profile\":\"tester\",\"harness\":\"kimi-code\"}")
        .when().post("/lore/kc/agent-client")
        .then().statusCode(503).body("error", equalTo("KC_NOT_CONFIGURED"));
    }
}
