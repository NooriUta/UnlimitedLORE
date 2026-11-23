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

    /** 1.18.2 «гирлянда»: harness из модели — списком, без KC. */
    @Test
    void harnessListComesFromModel() {
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/kc/harness")
        .then().statusCode(200).body("harness.code", org.hamcrest.Matchers.hasItem("claude-code"));
    }

    /** KC тестового окружения не настроен — срез отвечает деревом и честным «не смогли проверить», а не пустотой. */
    @Test
    void accountsTreeWithoutKcIsUnknownNotEmpty() {
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/kc/harness/claude-code/accounts")
        .then().statusCode(200)
            .body("kc.state", equalTo("not_configured"))
            .body("nodes[0].role", equalTo("full"))
            .body("nodes[0].account.state", equalTo("unknown"));
    }

    @Test
    void accountsTreeOfUnknownHarnessIs404() {
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/kc/harness/ghost/accounts")
        .then().statusCode(404);
    }

    @Test
    void accountsTreeIsAdminOnly() {
        given().header("X-Seer-Role", "viewer")
        .when().get("/lore/kc/harness/claude-code/accounts")
        .then().statusCode(403);
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
