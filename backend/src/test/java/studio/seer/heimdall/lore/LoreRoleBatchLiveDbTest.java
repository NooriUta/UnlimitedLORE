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
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-05 — массовая смена ролей сквозь REST: dry_run даёт дифф
 * без записи; применение меняет роли во всех проектах одним вызовом; undo из ответа
 * возвращает всё как было.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreRoleBatchLiveDbTest {

    static final String SUB = "s7b05-batch";
    static final String P1 = "LORE_TEST_ORG/s7b05-one";
    static final String P2 = "LORE_TEST_ORG/s7b05-two";
    static List<Object> undo;

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    private static Map<String, String> roles() {
        List<Map<String, Object>> rows = given().header("X-Seer-Role", "admin")
            .when().get("/lore/slice/user_project_roles?kc_sub=" + SUB).then().statusCode(200)
            .extract().jsonPath().getList("rows");
        Map<String, String> out = new java.util.TreeMap<>();
        if (rows.isEmpty()) return out;
        List<?> ps = (List<?>) rows.get(0).get("projects");
        List<?> rs = (List<?>) rows.get(0).get("roles");
        for (int i = 0; i < ps.size(); i++) out.put(String.valueOf(ps.get(i)), String.valueOf(rs.get(i)));
        return out;
    }

    @Test
    @Order(1)
    void setUp() {
        for (String p : List.of(P1, P2))
            given().header("X-Seer-Role", "superadmin").contentType("application/json")
                .body("{\"slug\":\"" + p + "\"}").when().post("/lore/project").then().statusCode(200);
        admin().body("{\"kc_sub\":\"" + SUB + "\",\"project\":\"" + P1 + "\",\"role\":\"reader\"}")
            .when().post("/lore/user/role").then().statusCode(200);
    }

    private static String batch(boolean dry) {
        return "{\"kc_sub\":\"" + SUB + "\",\"dry_run\":" + dry + ",\"changes\":["
            + "{\"project\":\"" + P1 + "\",\"role\":\"developer\"},"
            + "{\"project\":\"" + P2 + "\",\"role\":\"tester\"}]}";
    }

    @Test
    @Order(2)
    void dryRunShowsTheDiffAndWritesNothing() {
        JsonPath r = admin().body(batch(true)).when().post("/lore/user/role/batch").then().statusCode(200)
            .extract().jsonPath();
        assertEquals("update", r.getString("plan[0].kind"));
        assertEquals("grant", r.getString("plan[1].kind"));
        assertEquals(Map.of(P1, "reader"), roles(), "dry_run ничего не пишет");
    }

    @Test
    @Order(3)
    void applyChangesAllProjectsInOneCall() {
        JsonPath r = admin().body(batch(false)).when().post("/lore/user/role/batch").then().statusCode(200)
            .extract().jsonPath();
        assertEquals(2, r.getInt("applied"));
        assertEquals(Map.of(P1, "developer", P2, "tester"), roles());
        undo = r.getList("undo");
        assertEquals(2, undo.size());
    }

    @Test
    @Order(4)
    void undoRestoresEverything() {
        String body = "{\"kc_sub\":\"" + SUB + "\",\"changes\":" + new com.fasterxml.jackson.databind.ObjectMapper()
            .valueToTree(undo).toString() + "}";
        admin().body(body).when().post("/lore/user/role/batch").then().statusCode(200);
        assertEquals(Map.of(P1, "reader"), roles(), "откат пачки вернул как было");
    }
}
