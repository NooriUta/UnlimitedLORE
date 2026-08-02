package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * AL-68 (ADR-LORE-036): резолвер client_id → агент → владелец → роль в
 * проекте → матрица D4, на живых графовых фикстурах (AL-82/AL-83). Тесты
 * зовут {@link ProjectRbacService} НАПРЯМУЮ (через @Inject), а не через
 * HTTP+X-Seer-Role — сервис читает JWT-клеймы (agent_scope/client_id) через
 * SecurityIdentity, которых в тестовом профиле (oidcEnabled=false) нет; тот
 * же ограничитель, что уже документирован в AL-82/AL-83 тестах.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class ProjectRbacServiceLiveDbTest {

    @Inject
    ProjectRbacService rbac;

    private static final String PROJECT = "LORE_TEST_ORG/al68-rbac-repo";
    private static final String OWNER_ACTOR = "al68-owner-agent";
    private static final String ARCHITECT_ACTOR = "al68-architect-agent";
    private static final String ORPHAN_ACTOR = "al68-orphan-agent";
    private static final String OWNER_CLIENT = "lore-mcp-al68-owner";
    private static final String ARCHITECT_CLIENT = "lore-mcp-al68-architect";
    private static final String ORPHAN_CLIENT = "lore-mcp-al68-orphan";
    private static final String OWNER_SUB = "al68-owner-sub";
    private static final String ARCHITECT_SUB = "al68-architect-sub";
    private static final String READER_SUB = "al68-reader-sub";

    @Test
    @Order(1)
    void setUp() {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"slug\":\"" + PROJECT + "\"}")
        .when().post("/lore/project").then().statusCode(200);

        // Владелец проекта.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + OWNER_SUB + "\",\"display_name\":\"AL-68 Owner\"}")
        .when().post("/lore/user").then().statusCode(200);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + OWNER_SUB + "\",\"project\":\"" + PROJECT + "\",\"role\":\"owner\"}")
        .when().post("/lore/user/role").then().statusCode(200);

        // Архитектор в том же проекте.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + ARCHITECT_SUB + "\",\"display_name\":\"AL-68 Architect\"}")
        .when().post("/lore/user").then().statusCode(200);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + ARCHITECT_SUB + "\",\"project\":\"" + PROJECT + "\",\"role\":\"architect\"}")
        .when().post("/lore/user/role").then().statusCode(200);

        // Читатель — заведён как человек, но роль в проекте НЕ проставлена
        // (человек существует в графе, но HAS_PROJECT_ROLE к этому проекту нет).
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + READER_SUB + "\",\"display_name\":\"AL-68 No Role\"}")
        .when().post("/lore/user").then().statusCode(200);

        // Агенты-акторы и их владельцы.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"actor_id\":\"" + OWNER_ACTOR + "\",\"name\":\"AL-68 Owner Agent\",\"kind\":\"agent\"}")
        .when().post("/lore/actor").then().statusCode(200);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"actor_id\":\"" + OWNER_ACTOR + "\",\"client_id\":\"" + OWNER_CLIENT + "\",\"kc_sub\":\"" + OWNER_SUB + "\"}")
        .when().post("/lore/actor/owner").then().statusCode(200);

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"actor_id\":\"" + ARCHITECT_ACTOR + "\",\"name\":\"AL-68 Architect Agent\",\"kind\":\"agent\"}")
        .when().post("/lore/actor").then().statusCode(200);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"actor_id\":\"" + ARCHITECT_ACTOR + "\",\"client_id\":\"" + ARCHITECT_CLIENT + "\",\"kc_sub\":\"" + ARCHITECT_SUB + "\"}")
        .when().post("/lore/actor/owner").then().statusCode(200);

        // Агент без владельца вовсе (осиротевший, для orphan-сценария).
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"actor_id\":\"" + ORPHAN_ACTOR + "\",\"name\":\"AL-68 Orphan Agent\",\"kind\":\"agent\"}")
        .when().post("/lore/actor").then().statusCode(200);
    }

    @Test
    @Order(2)
    void ownersAgentIsAllowedAnyProfileInThatProject() {
        assertTrue(rbac.agentAllowedInProject(OWNER_CLIENT, PROJECT, "full"));
        assertTrue(rbac.agentAllowedInProject(OWNER_CLIENT, PROJECT, "tester"));
        assertTrue(rbac.agentAllowedInProject(OWNER_CLIENT, PROJECT, "marketer"));
    }

    @Test
    @Order(3)
    void architectsAgentIsAllowedOnlyArchitectDeveloperTester() {
        assertTrue(rbac.agentAllowedInProject(ARCHITECT_CLIENT, PROJECT, "architect"));
        assertTrue(rbac.agentAllowedInProject(ARCHITECT_CLIENT, PROJECT, "developer"));
        assertFalse(rbac.agentAllowedInProject(ARCHITECT_CLIENT, PROJECT, "full"),
            "архитектор не делегирует full — агент не может быть шире владельца");
        assertFalse(rbac.agentAllowedInProject(ARCHITECT_CLIENT, PROJECT, "pm"));
    }

    @Test
    @Order(4)
    void sameHumanTwoAgentsDifferentProjectsGiveDifferentVerdicts() {
        // Парная проба из акцептанса AL-68/ADR-036: та же связка (владелец
        // архитектор здесь), другой проект — роли там нет вовсе, отказ.
        String otherProject = "LORE_TEST_ORG/al68-other-repo";
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"slug\":\"" + otherProject + "\"}")
        .when().post("/lore/project").then().statusCode(200);

        assertTrue(rbac.agentAllowedInProject(ARCHITECT_CLIENT, PROJECT, "architect"));
        assertFalse(rbac.agentAllowedInProject(ARCHITECT_CLIENT, otherProject, "architect"),
            "роль владельца — на конкретный проект, не глобальная");
    }

    @Test
    @Order(5)
    void ownerWithoutProjectRoleIsDenied() {
        // READER_SUB существует в графе (KnowUser есть), но HAS_PROJECT_ROLE
        // к PROJECT не заведено — «роль не выдана» = проект не виден вовсе.
        assertNull(rbac.ownerRoleInProject(READER_SUB, PROJECT));
        assertFalse(ProjectRbacService.delegationAllowed(
            rbac.ownerRoleInProject(READER_SUB, PROJECT), "full"));
    }

    @Test
    @Order(6)
    void orphanAgentClientIsDenied() {
        assertNull(rbac.ownerKcSub(ORPHAN_CLIENT), "клиент без OWNED_BY — осиротевший, не пропуск");
        assertFalse(rbac.agentAllowedInProject(ORPHAN_CLIENT, PROJECT, "full"));
    }

    @Test
    @Order(7)
    void unknownClientIdIsDenied() {
        assertNull(rbac.ownerKcSub("lore-mcp-does-not-exist"));
        assertFalse(rbac.agentAllowedInProject("lore-mcp-does-not-exist", PROJECT, "full"));
    }

    @Test
    @Order(8)
    void ownerKcSubResolvesCorrectlyPerClient() {
        assertEquals(OWNER_SUB, rbac.ownerKcSub(OWNER_CLIENT));
        assertEquals(ARCHITECT_SUB, rbac.ownerKcSub(ARCHITECT_CLIENT));
    }

    // ── AL-93: список разрешённых проектов (на тех же фикстурах) ────────────

    @Test
    @Order(9)
    void allowedProjectsForUserListsOnlyProjectsWithAnyRole() {
        assertTrue(rbac.allowedProjectsForUser(OWNER_SUB).contains(PROJECT));
        assertTrue(rbac.allowedProjectsForUser(ARCHITECT_SUB).contains(PROJECT));
        // otherProject создан в Order(4), но роли туда никому не выдавались.
        assertFalse(rbac.allowedProjectsForUser(ARCHITECT_SUB).contains("LORE_TEST_ORG/al68-other-repo"));
        // Человек без единой роли — пустое множество, не ошибка.
        assertTrue(rbac.allowedProjectsForUser(READER_SUB).isEmpty());
        assertTrue(rbac.allowedProjectsForUser("no-such-sub").isEmpty());
        assertTrue(rbac.allowedProjectsForUser(null).isEmpty());
    }

    @Test
    @Order(10)
    void allowedProjectsForAgentFiltersByDelegationMatrix() {
        // Владелец-owner делегирует любой профиль → проект в списке для всех.
        assertTrue(rbac.allowedProjectsForAgent(OWNER_CLIENT, "full").contains(PROJECT));
        assertTrue(rbac.allowedProjectsForAgent(OWNER_CLIENT, "marketer").contains(PROJECT));
        // Владелец-архитектор: architect-профиль виден, full — нет НИГДЕ.
        assertTrue(rbac.allowedProjectsForAgent(ARCHITECT_CLIENT, "architect").contains(PROJECT));
        assertTrue(rbac.allowedProjectsForAgent(ARCHITECT_CLIENT, "full").isEmpty(),
            "агент не может быть шире владельца ни в одном проекте");
    }

    @Test
    @Order(11)
    void allowedProjectsForOrphanOrUnknownAgentIsEmpty() {
        assertTrue(rbac.allowedProjectsForAgent(ORPHAN_CLIENT, "full").isEmpty());
        assertTrue(rbac.allowedProjectsForAgent("lore-mcp-does-not-exist", "full").isEmpty());
        assertTrue(rbac.allowedProjectsForAgent(OWNER_CLIENT, null).isEmpty());
    }

    // ── Решение владельца 2026-08-01: читать — в пределах своих проектов,
    //    изменять — в пределах роли. Видимость и право менять расходятся.

    @Test
    @Order(12)
    void visibilityIsWiderThanWriteRights() {
        // Тот же клиент, тот же проект: для ЗАПИСИ профиль full у
        // architect-владельца не проходит (D4 не делегирует), а ВИДЕТЬ проект
        // он обязан — иначе участник проекта не знает его артефактов.
        assertTrue(rbac.allowedProjectsForAgent(ARCHITECT_CLIENT, "full").isEmpty(),
            "запись сужается ролью — это правило не меняется");
        assertTrue(rbac.visibleProjectsForAgent(ARCHITECT_CLIENT).contains(PROJECT),
            "чтение сужается только проектом, не ролью");
    }

    @Test
    @Order(13)
    void visibilityNeverExceedsTheOwner() {
        // Агент не видит больше владельца: множество берётся из его рёбер.
        assertEquals(rbac.allowedProjectsForUser(ARCHITECT_SUB),
            rbac.visibleProjectsForAgent(ARCHITECT_CLIENT));
        // READER_SUB ролей не имеет вовсе — значит и агент такого владельца
        // не увидел бы ничего. Проверяем через владельца напрямую: клиента на
        // reader'а в фикстурах нет, и заводить его ради одного утверждения
        // дороже, чем сверить исходное множество.
        assertTrue(rbac.allowedProjectsForUser(READER_SUB).isEmpty());
    }

    @Test
    @Order(14)
    void visibilityForOrphanOrUnknownAgentIsEmpty() {
        // Fail-closed на чтении так же, как на записи: неопознанный клиент
        // не получает корпус целиком.
        assertTrue(rbac.visibleProjectsForAgent(ORPHAN_CLIENT).isEmpty());
        assertTrue(rbac.visibleProjectsForAgent("lore-mcp-does-not-exist").isEmpty());
        assertTrue(rbac.visibleProjectsForAgent(null).isEmpty());
    }
}
