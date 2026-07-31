package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;

/**
 * AL-82 (ADR-LORE-036): человек как вершина графа (KnowUser) + ребро
 * «человек × проект × роль» (HAS_PROJECT_ROLE) — предусловие всей проектной
 * RBAC-модели (D148: источник истины о правах — граф, не токен KC).
 * Живая изолированная БД (testcontainers, lore_c5_test).
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreUserProjectRoleLiveDbTest {

    private static final String SUB = "al82-test-sub-0001";
    private static final String PROJECT = "LORE_TEST_ORG/al82-role-repo";

    @Test
    @Order(1)
    void setUp() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"slug\":\"" + PROJECT + "\"}")
        .when().post("/lore/project")
        .then().statusCode(200);
    }

    @Test
    @Order(2)
    void upsertCreatesUserVertexKeyedBySub() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + SUB + "\",\"display_name\":\"Al82 Test\"}")
        .when().post("/lore/user")
        .then().statusCode(200)
            .body("kc_sub", equalTo(SUB));
    }

    @Test
    @Order(3)
    void assigningRoleCreatesEdgeVisibleInBothSlices() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + SUB + "\",\"project\":\"" + PROJECT + "\",\"role\":\"tester\"}")
        .when().post("/lore/user/role")
        .then().statusCode(200)
            .body("role", equalTo("tester"));

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/user_project_roles?kc_sub=" + SUB)
        .then().statusCode(200)
            .body("rows[0].projects", hasItem(PROJECT))
            .body("rows[0].roles", hasItem("tester"));

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/project_users?project=" + PROJECT)
        .then().statusCode(200)
            .body("rows[0].kc_subs", hasItem(SUB))
            .body("rows[0].roles", hasItem("tester"));
    }

    @Test
    @Order(4)
    void reassigningRoleUpdatesTheSameEdgeNotADuplicate() {
        // Одно ребро на пару (человек, проект) — второй assign правит role, не плодит второе ребро.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + SUB + "\",\"project\":\"" + PROJECT + "\",\"role\":\"architect\"}")
        .when().post("/lore/user/role")
        .then().statusCode(200)
            .body("role", equalTo("architect"));

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/user_project_roles?kc_sub=" + SUB)
        .then().statusCode(200)
            .body("rows[0].roles", equalTo(java.util.List.of("architect")));
    }

    @Test
    @Order(5)
    void removeActionDeletesTheEdge() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + SUB + "\",\"project\":\"" + PROJECT + "\",\"action\":\"remove\"}")
        .when().post("/lore/user/role")
        .then().statusCode(200)
            .body("removed", equalTo(true));

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/user_project_roles?kc_sub=" + SUB)
        .then().statusCode(200)
            .body("rows[0].projects", empty());
    }

    // "user" — HUMAN_ONLY (AgentScopeFilter): AgentScopeFilter сам JWT/OIDC-гейт
    // (short-circuit при oidcEnabled=false, как в тестовом профиле) — REST-запрос
    // с голым X-Seer-Role здесь этот путь не проходит. Покрытие семейства "user"
    // проверяется статически, по исходникам — AgentScopeMatrixCoverageTest.
}
