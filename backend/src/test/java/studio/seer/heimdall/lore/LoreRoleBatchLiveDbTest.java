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
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

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

    /**
     * Kit 09.11 (K2-BATCH-UNDO): пачка не атомарна, поэтому итог — у КАЖДОЙ строки плана,
     * включая успешные и «уже так»: клиент не считает успех вычитанием. applied/failed — сверка.
     * Отмена с чужим id — отказ по имени.
     */
    @Test
    @Order(5)
    void everyPlanRowHasItsResultAndBatchCanBeReferenced() {
        String body = "{\"kc_sub\":\"" + SUB + "\",\"changes\":["
            + "{\"project\":\"" + P1 + "\",\"role\":\"reader\"},"
            + "{\"project\":\"" + P2 + "\",\"role\":\"tester\"}]}";
        JsonPath r = admin().body(body).when().post("/lore/user/role/batch").then().statusCode(200)
            .extract().jsonPath();
        java.util.List<Map<String, Object>> items = r.getList("items");
        assertEquals(r.getList("plan").size(), items.size(), "строка итога на каждую строку плана");
        for (Map<String, Object> it : items)
            assertTrue(java.util.Set.of("applied", "failed", "unchanged").contains(it.get("result")), "result: " + it);
        assertEquals("unchanged", items.get(0).get("result"), "P1 уже reader — «уже так», но строка есть");
        assertEquals("applied", items.get(1).get("result"));
        assertTrue(r.getString("batch_id").startsWith("rb-"), r.getString("batch_id"));
        assertNotNull(r.getString("undo_until"));

        String bad = "{\"kc_sub\":\"" + SUB + "\",\"undo_of\":\"rb-garbage\",\"changes\":[{\"project\":\"" + P2 + "\",\"action\":\"remove\"}]}";
        admin().body(bad).when().post("/lore/user/role/batch").then().statusCode(400);
    }

    /**
     * S7B-13: пачка из журнала раскрывается по batch_id до своих назначений и
     * откатывается целиком — без ответа исходного вызова (журнал открывают позже).
     * Запись журнала AO-01 о пачке несёт именно batch_id: фильтр журнала берёт
     * первое *_id поле ответа.
     */
    @Test
    @Order(6)
    void batchOpensFromJournalByIdAndRollsBackWhole() throws Exception {
        assertEquals(Map.of(P1, "reader", P2, "tester"), roles(), "исходное после Order(5)");
        String body = "{\"kc_sub\":\"" + SUB + "\",\"changes\":["
            + "{\"project\":\"" + P1 + "\",\"role\":\"developer\"},"
            + "{\"project\":\"" + P2 + "\",\"action\":\"remove\"}]}";
        String raw = admin().body(body).when().post("/lore/user/role/batch").then().statusCode(200)
            .extract().asString();
        JsonPath r = new JsonPath(raw);
        String id = r.getString("batch_id");
        // Jackson в LinkedHashMap — порядок полей как в ответе (фильтр журнала берёт первое *_id).
        Map<String, Object> resp = new com.fasterxml.jackson.databind.ObjectMapper().readValue(raw,
            new com.fasterxml.jackson.core.type.TypeReference<java.util.LinkedHashMap<String, Object>>() {});
        assertEquals(id, LoreAuditLogFilter.entityIdOf(resp), "журнал AO-01 пишет пачку её batch_id");

        JsonPath b = given().header("X-Seer-Role", "admin").when().get("/lore/admin/actions/batch/" + id)
            .then().statusCode(200).extract().jsonPath();
        assertEquals(id, b.getString("batch_id"));
        assertEquals(SUB, b.getString("kc_sub"));
        assertEquals(2, b.getInt("count"));
        Map<String, String> before = new java.util.TreeMap<>();
        for (Map<String, Object> it : b.<Map<String, Object>>getList("items"))
            before.put(String.valueOf(it.get("project")), String.valueOf(it.get("role_before")));
        assertEquals(Map.of(P1, "reader", P2, "tester"), before, "у каждого назначения — роль до пачки");
        assertEquals(id, b.getString("rollback.body.undo_of"));
        assertEquals("/lore/user/role/batch", b.getString("rollback.path"));

        String rollback = new com.fasterxml.jackson.databind.ObjectMapper()
            .valueToTree(b.getMap("rollback.body")).toString();
        admin().body(rollback).when().post("/lore/user/role/batch").then().statusCode(200);
        assertEquals(Map.of(P1, "reader", P2, "tester"), roles(), "откат пачки из журнала вернул как было");

        given().header("X-Seer-Role", "admin").when().get("/lore/admin/actions/batch/rb-0000000000001-00000000")
            .then().statusCode(404);
        given().header("X-Seer-Role", "admin").when().get("/lore/admin/actions/batch/rb-garbage")
            .then().statusCode(400);
    }
}
