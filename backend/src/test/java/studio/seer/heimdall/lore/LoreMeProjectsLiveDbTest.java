package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import io.quarkus.test.security.jwt.Claim;
import io.quarkus.test.security.jwt.JwtSecurity;
import io.restassured.path.json.JsonPath;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-14 (и S9-04 «Все мои (N своих)»): «мои проекты» — по
 * назначениям ролей человека (HAS_PROJECT_ROLE), а не все проекты LORE. Без ролей —
 * честный ноль (200), без опознанного вызывающего — 401, а не «проектов нет».
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreMeProjectsLiveDbTest {

    static final String SUB_WITH = "s7b14-has-role";
    static final String SUB_WITHOUT = "s7b14-no-role";
    static final String PROJECT = "LORE_TEST_ORG/s7b14-mine";

    @Test
    @Order(1)
    void setUp() {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"slug\":\"" + PROJECT + "\"}").when().post("/lore/project").then().statusCode(200);
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"slug\":\"LORE_TEST_ORG/s7b14-not-mine\"}").when().post("/lore/project").then().statusCode(200);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + SUB_WITH + "\",\"project\":\"" + PROJECT + "\",\"role\":\"tester\"}")
            .when().post("/lore/user/role").then().statusCode(200);
    }

    @Test
    @Order(2)
    @TestSecurity(user = "s7b14-a", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = SUB_WITH))
    void myProjectsAreOnlyThoseWithMyRole() {
        JsonPath p = given().when().get("/lore/me/projects").then().statusCode(200).extract().jsonPath();
        assertEquals(1, p.getInt("count"), "свои — по назначениям ролей, не все проекты LORE: " + p.prettify());
        assertEquals(PROJECT, p.getString("projects[0].slug"));
        assertEquals("tester", p.getString("projects[0].role"));
    }

    @Test
    @Order(3)
    @TestSecurity(user = "s7b14-b", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = SUB_WITHOUT))
    void noRolesIsAnHonestZero() {
        given().when().get("/lore/me/projects").then().statusCode(200).body("count", equalTo(0));
    }

    @Test
    @Order(4)
    void withoutIdentityIsUnauthorizedNotEmpty() {
        given().when().get("/lore/me/projects").then().statusCode(401).body("error", equalTo("NO_IDENTITY"));
    }
}
