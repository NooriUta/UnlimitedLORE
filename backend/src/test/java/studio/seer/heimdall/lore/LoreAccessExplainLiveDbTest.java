package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.path.json.JsonPath;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-10 — «почему видит / не видит» и «кто видит проект X»
 * сквозь REST: роль человека берётся из графа (HAS_PROJECT_ROLE), цепочка — в ответе.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreAccessExplainLiveDbTest {

    static final String SUB = "s7b10-reader";
    static final String PROJECT = "LORE_TEST_ORG/s7b10-access";

    @Test
    @Order(1)
    void setUp() {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"slug\":\"" + PROJECT + "\"}").when().post("/lore/project").then().statusCode(200);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + SUB + "\",\"project\":\"" + PROJECT + "\",\"role\":\"reader\"}")
            .when().post("/lore/user/role").then().statusCode(200);
    }

    @Test
    @Order(2)
    void explainsWhyAPersonSeesAProject() {
        JsonPath r = given().header("X-Seer-Role", "admin")
            .when().get("/lore/admin/access?kc_sub=" + SUB + "&project=" + PROJECT + "&realm_role=viewer")
            .then().statusCode(200).extract().jsonPath();
        assertEquals("reader", r.getString("project_role"), "роль из графа");
        assertEquals(false, r.getBoolean("can_write"));
        assertTrue(!r.getList("chain").isEmpty(), "цепочка рассуждения в ответе");
    }

    @Test
    @Order(3)
    void listsWhoSeesAProject() {
        JsonPath r = given().header("X-Seer-Role", "admin")
            .when().get("/lore/admin/access?project=" + PROJECT).then().statusCode(200).extract().jsonPath();
        List<String> subs = r.getList("people.kc_sub");
        assertTrue(subs.contains(SUB), "кто видит проект — по ролям: " + subs);
        assertTrue(r.getList("bypass_realm_roles").contains("admin"), "плюс роли realm, видящие всё");
    }

    @Test
    @Order(4)
    void missingProjectIsBadRequest() {
        given().header("X-Seer-Role", "admin").when().get("/lore/admin/access?kc_sub=" + SUB).then().statusCode(400);
    }
}
