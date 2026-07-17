package studio.seer.heimdall.lore;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.not;

/**
 * FJ-07 (ADR-LORE-024): поверхности Forgejo-моста, проверяемые БЕЗ живого Forgejo —
 * в тестовом окружении FORGEJO_API_TOKEN не задан, поэтому: health честно говорит
 * configured:false, каждый рабочий эндпоинт отвечает 503 (pluggable-контракт D14
 * из ADR-025, тот же, что у KC-моста), RBAC — admin-only, и токен не появляется
 * ни в одном теле ответа. Живой цикл PR→CI→merge — dogfood-прогон на стенде
 * :3030 при выпуске v1.0.52 (план спринта, шаг 7).
 */
@QuarkusTest
class LoreForgejoEndpointsTest {

    @Test
    void healthRequiresAdmin() {
        given().header("X-Seer-Role", "viewer")
        .when().get("/lore/forgejo/health")
        .then().statusCode(403);
    }

    @Test
    void healthSaysNotConfiguredWithoutToken() {
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/forgejo/health")
        .then().statusCode(200).body("configured", equalTo(false));
    }

    @Test
    void prCreateReturns503WithoutToken() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"git_project\":\"NooriUta/UnlimitedLORE\",\"head\":\"feature/x\"}")
        .when().post("/lore/forgejo/pr")
        .then().statusCode(503)
            .body("error", equalTo("FORGEJO_NOT_CONFIGURED"))
            // §9: ответ подсказывает fallback-нишу (tea CLI), а не оставляет тупик.
            .body("detail", containsString("tea"));
    }

    @Test
    void prStatusReturns503WithoutToken() {
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/forgejo/pr/1?git_project=NooriUta/UnlimitedLORE")
        .then().statusCode(503).body("error", equalTo("FORGEJO_NOT_CONFIGURED"));
    }

    @Test
    void mergeReturns503WithoutToken() {
        // Гейт §10 даже не вычисляется без моста: 503 раньше любой merge-логики.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"git_project\":\"NooriUta/UnlimitedLORE\"}")
        .when().post("/lore/forgejo/pr/1/merge")
        .then().statusCode(503).body("error", equalTo("FORGEJO_NOT_CONFIGURED"));
    }

    @Test
    void ciStatusReturns503WithoutToken() {
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/forgejo/ci?git_project=NooriUta/UnlimitedLORE&ref=develop")
        .then().statusCode(503).body("error", equalTo("FORGEJO_NOT_CONFIGURED"));
    }

    @Test
    void branchProtectionReturns503WithoutToken() {
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/forgejo/branch-protection?git_project=NooriUta/UnlimitedLORE&branch=develop")
        .then().statusCode(503).body("error", equalTo("FORGEJO_NOT_CONFIGURED"));
    }

    @Test
    void mergeRequiresAdminRole() {
        // OQ-024-MERGE-RBAC (дефолт): merge — только полный доступ; ограничение
        // агентных профилей живёт на MCP-слое, здесь — общий admin-гейт LORE.
        given().header("X-Seer-Role", "viewer").contentType("application/json")
            .body("{\"git_project\":\"NooriUta/UnlimitedLORE\"}")
        .when().post("/lore/forgejo/pr/1/merge")
        .then().statusCode(403);
    }

    @Test
    void tokenNeverAppearsInResponses() {
        // Токен не задан, но проверяем сам контракт: имя ключа/значение секрета
        // не сериализуются ни в одном ответе моста (включая ошибки).
        String health = given().header("X-Seer-Role", "admin")
            .when().get("/lore/forgejo/health").body().asString();
        String err503 = given().header("X-Seer-Role", "admin")
            .when().get("/lore/forgejo/ci?git_project=X&ref=y").body().asString();
        org.junit.jupiter.api.Assertions.assertFalse(health.contains("token"),
            "health не должен содержать слова token: " + health);
        // 503-detail называет ИМЯ ключа (FORGEJO_API_TOKEN) — это легально и полезно
        // для диагностики; проверяем, что нет ничего похожего на ЗНАЧЕНИЕ секрета.
        org.junit.jupiter.api.Assertions.assertFalse(err503.matches(".*(Bearer|Authorization).*"),
            "ответ моста не должен нести авторизационных заголовков: " + err503);
    }
}
