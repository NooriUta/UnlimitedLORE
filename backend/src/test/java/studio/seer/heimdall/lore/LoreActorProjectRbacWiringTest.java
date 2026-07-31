package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import io.quarkus.test.security.jwt.Claim;
import io.quarkus.test.security.jwt.JwtSecurity;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.is;

/**
 * AL-90 (AL-68 wiring): резолвер D4 ({@link ProjectRbacService}) построен и
 * протестирован сам по себе ({@code ProjectRbacServiceLiveDbTest}), но здесь
 * проверяется ПУТЬ клейм→резолвер→ответ через реальный HTTP-запрос с
 * эмулированным JWT — то, что раньше нельзя было проверить: тестовый профиль
 * (oidcEnabled=false) не даёт {@code SecurityIdentity} нести JWT вовсе, а
 * {@code callerAgentScope()}/{@code callerClientId()} читают именно его.
 * {@code quarkus-test-security-jwt} решает это независимо от oidcEnabled —
 * ставит тестовый {@link org.eclipse.microprofile.jwt.JsonWebToken} принципал
 * с произвольными клеймами, не трогая реальный OIDC-контур.
 *
 * <p><b>Находка при первом прогоне (2026-08-01), меняющая смысл теста:</b>
 * узкий агентный профиль (например architect) физически НЕ доходит до этой
 * проверки в реальном контуре. После [[AL-66]] (снятие realm-роли {@code admin}
 * у 7 узких клиентов той же ночью) {@code requireAdmin(role)} — САМОСТОЯТЕЛЬНЫЙ
 * гейт ДО D4, читает {@code X-Seer-Role}, который {@code SeerRoleFromTokenFilter}
 * жёстко выставляет по REALM-роли токена: нет {@code admin} — «viewer» — отказ,
 * ДО того как код успевает спросить D4. Единственный клиент, у которого
 * realm-роль {@code admin} осталась — {@code lore-mcp-full}. Значит на
 * практике D4 сегодня реально ограничивает не узкие профили (их уже не
 * пускает realm-роль), а **agent-full** — по роли ЕГО владельца в конкретном
 * проекте: без D4 agent-full был бы всемогущ в любом проекте, с D4 — только
 * там, где владелец сам {@code owner}.
 *
 * <p>{@code roles = {"admin"}} в {@code @TestSecurity} ниже — не ошибка теста,
 * а точное отражение факта: у {@code lore-mcp-full} ЕСТЬ realm-роль admin
 * (сознательно, по конструкции модели), у остальных — нет (после AL-66).
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreActorProjectRbacWiringTest {

    private static final String PROJECT_OWNED = "LORE_TEST_ORG/al90-owned-repo";
    private static final String PROJECT_OTHER = "LORE_TEST_ORG/al90-other-repo";
    private static final String OWNER_SUB = "al90-owner-sub";
    private static final String FULL_CLIENT = "lore-mcp-al90-full-test";
    private static final String FULL_ACTOR = "al90-full-agent";
    // Второй человек, роль architect в ТОМ ЖЕ PROJECT_OWNED (не owner) — доказывает,
    // что D4 сужает по РОЛИ владельца в проекте, не по одному факту «есть какая-то роль».
    private static final String ARCHITECT_SUB = "al90-architect-sub";
    private static final String ARCHITECT_CLIENT = "lore-mcp-al90-architect-test";
    private static final String ARCHITECT_ACTOR = "al90-architect-agent";

    @Test
    @Order(1)
    void setUp() {
        for (String slug : new String[]{PROJECT_OWNED, PROJECT_OTHER}) {
            given().header("X-Seer-Role", "superadmin").contentType("application/json")
                .body("{\"slug\":\"" + slug + "\"}")
            .when().post("/lore/project").then().statusCode(200);
        }

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + OWNER_SUB + "\",\"display_name\":\"AL-90 Owner\"}")
        .when().post("/lore/user").then().statusCode(200);
        // Роль owner — ТОЛЬКО в PROJECT_OWNED (делегирует full); в PROJECT_OTHER роли нет вовсе.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + OWNER_SUB + "\",\"project\":\"" + PROJECT_OWNED + "\",\"role\":\"owner\"}")
        .when().post("/lore/user/role").then().statusCode(200);

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"actor_id\":\"" + FULL_ACTOR + "\",\"name\":\"AL-90 Full Agent\",\"kind\":\"agent\"}")
        .when().post("/lore/actor").then().statusCode(200);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"actor_id\":\"" + FULL_ACTOR + "\",\"client_id\":\"" + FULL_CLIENT + "\",\"kc_sub\":\"" + OWNER_SUB + "\"}")
        .when().post("/lore/actor/owner").then().statusCode(200);

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + ARCHITECT_SUB + "\",\"display_name\":\"AL-90 Architect\"}")
        .when().post("/lore/user").then().statusCode(200);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + ARCHITECT_SUB + "\",\"project\":\"" + PROJECT_OWNED + "\",\"role\":\"architect\"}")
        .when().post("/lore/user/role").then().statusCode(200);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"actor_id\":\"" + ARCHITECT_ACTOR + "\",\"name\":\"AL-90 Architect Agent\",\"kind\":\"agent\"}")
        .when().post("/lore/actor").then().statusCode(200);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"actor_id\":\"" + ARCHITECT_ACTOR + "\",\"client_id\":\"" + ARCHITECT_CLIENT + "\",\"kc_sub\":\"" + ARCHITECT_SUB + "\"}")
        .when().post("/lore/actor/owner").then().statusCode(200);
    }

    /** Парная проба, часть 1: владелец — owner в PROJECT_OWNED → agent-full здесь разрешён (owner делегирует всё). */
    @Test
    @Order(2)
    @TestSecurity(user = "svc-account", roles = {"admin"})
    @JwtSecurity(claims = {
        @Claim(key = "agent_scope", value = "agent-full"),
        @Claim(key = "client_id", value = FULL_CLIENT)
    })
    void agentAllowedInOwnersProject() {
        given().contentType("application/json")
            .body("{\"actor_id\":\"al90-created-by-agent-1\",\"kind\":\"agent\",\"project\":\"" + PROJECT_OWNED + "\"}")
        .when().post("/lore/actor")
        .then().statusCode(200)
            .body("ok", is(true));
    }

    /** Парная проба, часть 2: тот же агент/владелец, ДРУГОЙ проект — роли там нет вовсе → отказ, даже у full. */
    @Test
    @Order(3)
    @TestSecurity(user = "svc-account", roles = {"admin"})
    @JwtSecurity(claims = {
        @Claim(key = "agent_scope", value = "agent-full"),
        @Claim(key = "client_id", value = FULL_CLIENT)
    })
    void agentDeniedInProjectWithoutOwnerRole() {
        given().contentType("application/json")
            .body("{\"actor_id\":\"al90-created-by-agent-2\",\"kind\":\"agent\",\"project\":\"" + PROJECT_OTHER + "\"}")
        .when().post("/lore/actor")
        .then().statusCode(403)
            .body("error", equalTo("AGENT_SCOPE_FORBIDDEN"));
    }

    /** Осиротевший клиент (нет OWNED_BY) — отказ, а не пропуск, даже с realm-ролью admin и agent-full. */
    @Test
    @Order(4)
    @TestSecurity(user = "svc-account", roles = {"admin"})
    @JwtSecurity(claims = {
        @Claim(key = "agent_scope", value = "agent-full"),
        @Claim(key = "client_id", value = "lore-mcp-al90-unknown-client")
    })
    void orphanClientDenied() {
        given().contentType("application/json")
            .body("{\"actor_id\":\"al90-created-by-agent-3\",\"kind\":\"agent\",\"project\":\"" + PROJECT_OWNED + "\"}")
        .when().post("/lore/actor")
        .then().statusCode(403)
            .body("error", equalTo("AGENT_SCOPE_FORBIDDEN"));
    }

    /**
     * Полная матрица D4 проверяется на уровне логики {@code ProjectRbacServiceMatrixTest}
     * (все 8 ролей × 8 профилей). Здесь — та же проверка НА УРОВНЕ WIRING (клейм → резолвер →
     * HTTP-ответ), но для узкого профиля: сегодня узкий агент не доходит сюда в реальном
     * трафике (requireAdmin блокирует раньше, см. javadoc класса) — {@code roles={"admin"}}
     * здесь ИСКУССТВЕННО снимает этот внешний гейт, чтобы доказать: КОГДА (если) требование
     * requireAdmin для узких профилей изменится, D4-проверка на actor уже сегодня корректно
     * ограничивает их по роли владельца, а не только agent-full. В рамках своей роли узкий
     * агент обязан мочь работать — architect делегируется architect-владельцем.
     */
    @Test
    @Order(6)
    @TestSecurity(user = "svc-account", roles = {"admin"})
    @JwtSecurity(claims = {
        @Claim(key = "agent_scope", value = "agent-architect"),
        @Claim(key = "client_id", value = ARCHITECT_CLIENT)
    })
    void narrowProfileAllowedWhenOwnerRoleCoversIt() {
        given().contentType("application/json")
            .body("{\"actor_id\":\"al90-created-by-agent-4\",\"kind\":\"agent\",\"project\":\"" + PROJECT_OWNED + "\"}")
        .when().post("/lore/actor")
        .then().statusCode(200)
            .body("ok", is(true));
    }

    /**
     * Тот же владелец (architect в PROJECT_OWNED), но запрошенный профиль — full: architect
     * НЕ делегирует full (D4: architect → architect/developer/tester). Показывает, что D4
     * сужает ПО ПРОФИЛЮ, а не по факту «у владельца есть хоть какая-то роль в проекте».
     */
    @Test
    @Order(7)
    @TestSecurity(user = "svc-account", roles = {"admin"})
    @JwtSecurity(claims = {
        @Claim(key = "agent_scope", value = "agent-full"),
        @Claim(key = "client_id", value = ARCHITECT_CLIENT)
    })
    void narrowOwnerCannotDelegateWiderProfile() {
        given().contentType("application/json")
            .body("{\"actor_id\":\"al90-created-by-agent-5\",\"kind\":\"agent\",\"project\":\"" + PROJECT_OWNED + "\"}")
        .when().post("/lore/actor")
        .then().statusCode(403)
            .body("error", equalTo("AGENT_SCOPE_FORBIDDEN"));
    }

    /** Человеческий вызов (нет agent_scope) — проверка D4 не применяется вовсе, requireAdmin остаётся единственным гейтом. */
    @Test
    @Order(5)
    void humanCallerBypassesD4Check() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"actor_id\":\"al90-created-by-human\",\"kind\":\"agent\",\"project\":\"" + PROJECT_OTHER + "\"}")
        .when().post("/lore/actor")
        .then().statusCode(200)
            .body("ok", is(true));
    }
}
