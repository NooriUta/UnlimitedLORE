package studio.seer.heimdall.lore;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.hasItem;

/**
 * AL-35/AL-45: поверхности безопасности KC-моста, проверяемые БЕЗ живого KC —
 * в тестовом окружении KC_ADMIN_CLIENT_SECRET не задан, поэтому preflight обязан
 * честно сказать «включать auth нельзя», а буфер отказов — накапливать 403.
 * 409-путь guard'а с живым KC — интеграционно в AL-48.
 */
@QuarkusTest
class LoreKcSafetyEndpointsTest {

    @Test
    void preflightForbiddenWithoutAdminRole() {
        given().header("X-Seer-Role", "viewer")
        .when().get("/lore/kc/auth-preflight")
        .then().statusCode(403).body("error", equalTo("FORBIDDEN"));
    }

    @Test
    void preflightSaysCannotEnableAuthWhenKcUnconfigured() {
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/kc/auth-preflight")
        .then().statusCode(200)
            .body("kc_configured", equalTo(false))
            .body("can_enable_auth", equalTo(false))   // инвариант AL-35: нет подтверждённых админов — нет включения
            .body("admin_count", equalTo(-1))          // -1 = «неизвестно», не «ноль» — состояния различимы (AL-31)
            .body("agent_scope_enforced", equalTo(false)); // честность до AL-17
    }

    @Test
    void denialsBufferRecordsA403AndServesItToAdmin() {
        // Спровоцировать отказ: viewer лезет в users.
        given().header("X-Seer-Role", "viewer")
        .when().get("/lore/kc/users")
        .then().statusCode(403);

        // Буфер отдаёт его админу, с ролью и путём как их увидел сервер.
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/kc/denials")
        .then().statusCode(200)
            .body("denials.size()", greaterThanOrEqualTo(1))
            .body("denials.status", hasItem(403))
            .body("denials.role", hasItem("viewer"));
    }

    @Test
    void denialsEndpointItselfRequiresAdmin() {
        given().header("X-Seer-Role", "viewer")
        .when().get("/lore/kc/denials")
        .then().statusCode(403);
    }
}
