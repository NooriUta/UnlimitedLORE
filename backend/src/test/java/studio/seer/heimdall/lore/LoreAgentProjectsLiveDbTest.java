package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.path.json.JsonPath;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-12 — скоуп агентов: у агента «Проекты (наследует от
 * владельца)» — читает все проекты владельца, пишет — где роль владельца делегирует
 * профиль (D4); у человека — «агенты видят ваши N проектов». Агент без владельца —
 * пусто с причиной, а не «нет проектов».
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreAgentProjectsLiveDbTest {

    static final String OWNER = "s7b12-owner";
    static final String PROJECT = "LORE_TEST_ORG/s7b12-agents";
    static final String ACTOR = "AGENT-S7B12";
    static final String CLIENT = "lore-mcp-s7b12";

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    @Test
    @Order(1)
    void setUp() {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"slug\":\"" + PROJECT + "\"}").when().post("/lore/project").then().statusCode(200);
        admin().body("{\"kc_sub\":\"" + OWNER + "\",\"project\":\"" + PROJECT + "\",\"role\":\"developer\"}")
            .when().post("/lore/user/role").then().statusCode(200);
        admin().body("{\"actor_id\":\"" + ACTOR + "\",\"name\":\"S7B-12 agent\",\"kind\":\"agent\"}")
            .when().post("/lore/actor").then().statusCode(200);
        admin().body("{\"actor_id\":\"" + ACTOR + "\",\"client_id\":\"" + CLIENT + "\",\"kc_sub\":\"" + OWNER + "\"}")
            .when().post("/lore/actor/owner").then().statusCode(200);
    }

    @Test
    @Order(2)
    void agentInheritsProjectsFromOwner() {
        JsonPath r = given().header("X-Seer-Role", "admin")
            .when().get("/lore/admin/access/agents?client_id=" + CLIENT + "&agent_scope=developer")
            .then().statusCode(200).extract().jsonPath();
        assertEquals(OWNER, r.getString("owner_kc_sub"));
        assertTrue(r.getList("visible").contains(PROJECT), "читает проекты владельца");
        assertTrue(r.getList("writable").contains(PROJECT), "developer владельца делегирует профиль developer (D4)");
        JsonPath tester = given().header("X-Seer-Role", "admin")
            .when().get("/lore/admin/access/agents?client_id=" + CLIENT + "&agent_scope=marketer")
            .then().statusCode(200).extract().jsonPath();
        assertTrue(tester.getList("writable").isEmpty(), "marketer роль developer не делегирует");
    }

    @Test
    @Order(3)
    void ownerSeesHowManyProjectsTheirAgentsSee() {
        JsonPath r = given().header("X-Seer-Role", "admin")
            .when().get("/lore/admin/access/agents?kc_sub=" + OWNER).then().statusCode(200).extract().jsonPath();
        assertTrue(r.getList("agents.client_id").contains(CLIENT), "агенты владельца: " + r.getList("agents"));
        assertEquals(1, r.getInt("visible_projects"), "агенты видят ваши N проектов");
    }

    @Test
    @Order(4)
    void orphanAgentIsEmptyWithAReason() {
        JsonPath r = given().header("X-Seer-Role", "admin")
            .when().get("/lore/admin/access/agents?client_id=lore-mcp-nobody").then().statusCode(200).extract().jsonPath();
        assertNull(r.get("owner_kc_sub"));
        assertTrue(r.getList("visible").isEmpty());
        assertTrue(r.getString("reason").contains("владел"), "пусто с причиной: " + r.getString("reason"));
    }
}
