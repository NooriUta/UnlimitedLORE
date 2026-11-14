package studio.seer.heimdall.lore;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;

/**
 * SPRINT_LORE_ADMIN_POLISH/AP-01 — гейты удаления на СЕРВЕРЕ, а не только в UI.
 * Keycloak в тестовом окружении не настроен — проверки идут до первого вызова KC,
 * поэтому отказ виден без него, а настоящий KC не зовётся никогда.
 */
@QuarkusTest
class TestAccountDeleteEndpointTest {

    @Test
    void realAgentClientIsRefusedEvenForSuperadmin() {
        given().header("X-Seer-Role", "superadmin").contentType("application/json").body("{\"dry_run\":true}")
        .when().post("/lore/kc/agent-client/lore-mcp-full/delete")
        .then().statusCode(403)
            .body("error", equalTo("TEST_ACCOUNTS_ONLY"))
            .body("client_id", equalTo("lore-mcp-full"))
            .body("detail", containsString("только выключить"));
    }

    @Test
    void machineClientWithoutTestPrefixIsRefused() {
        given().header("X-Seer-Role", "superadmin").contentType("application/json").body("{}")
        .when().post("/lore/kc/agent-client/lore-mcp-full_LorCetus/delete")
        .then().statusCode(403).body("error", equalTo("TEST_ACCOUNTS_ONLY"));
    }

    @Test
    void adminIsNotEnoughToDeleteAgent() {
        given().header("X-Seer-Role", "admin").contentType("application/json").body("{\"dry_run\":true}")
        .when().post("/lore/kc/agent-client/lore-mcp-full_TestUat/delete")
        .then().statusCode(403);
    }

    @Test
    void testAgentWithoutKcConfiguredIsHonest503() {
        given().header("X-Seer-Role", "superadmin").contentType("application/json").body("{\"dry_run\":true}")
        .when().post("/lore/kc/agent-client/lore-mcp-full_TestUat/delete")
        .then().statusCode(503).body("error", equalTo("KC_NOT_CONFIGURED"));
    }

    @Test
    void adminIsNotEnoughToDeletePerson() {
        given().header("X-Seer-Role", "admin").contentType("application/json").body("{\"dry_run\":true}")
        .when().post("/lore/user/sub-1/delete")
        .then().statusCode(403);
    }

    @Test
    void personDeleteNeedsKcToCheckLogin() {
        // логин проверяется по KC: без KC сервер не угадывает, тестовая ли учётка
        given().header("X-Seer-Role", "superadmin").contentType("application/json").body("{\"dry_run\":true}")
        .when().post("/lore/user/sub-1/delete")
        .then().statusCode(503).body("error", equalTo("KC_NOT_CONFIGURED"));
    }
}
