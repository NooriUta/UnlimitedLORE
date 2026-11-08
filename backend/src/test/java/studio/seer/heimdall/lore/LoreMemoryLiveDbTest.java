package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import io.quarkus.test.security.jwt.Claim;
import io.quarkus.test.security.jwt.JwtSecurity;
import io.restassured.response.Response;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-05 — «что LORE помнит обо мне» сквозь REST, на
 * живой изолированной БД, с JWT (владелец = {@code sub}, агент = {@code client_id}
 * с ребром OWNED_BY).
 *
 * <ul>
 *   <li>частые виды (поверх вида S2-04), частые срезы, недавние — одним ответом;</li>
 *   <li>чужую память не видно и не стереть (даже зная memory_id) — 404, не 403;</li>
 *   <li>агент владельца читает и стирает, но не включает/выключает и не пишет привычки;</li>
 *   <li>«не запоминать» — запись честно отвечает recorded=false, а не молча «ок»;</li>
 *   <li>стереть одну запись, вид памяти, всё; удалённый вид уходит из частых.</li>
 * </ul>
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreMemoryLiveDbTest {

    private static final String SUB_A = "s205-user-a";
    private static final String SUB_B = "s205-user-b";
    private static final String AGENT_ACTOR = "s205-agent-a";
    private static final String AGENT_CLIENT = "lore-mcp-s205-agent-a";

    private static String viewUid;
    private static String viewHabitId;
    private static String sliceHabitId;

    private static Response post(String path, String body) {
        return given().contentType("application/json").body(body).when().post(path);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> items(Response r, String kind) {
        List<Map<String, Object>> cats = r.path("categories");
        for (Map<String, Object> c : cats)
            if (kind.equals(c.get("kind"))) return (List<Map<String, Object>>) c.get("items");
        throw new AssertionError("нет категории " + kind + " в " + cats);
    }

    private static Map<String, Object> byKey(List<Map<String, Object>> items, String key) {
        return items.stream().filter(i -> key.equals(i.get("key"))).findFirst().orElse(null);
    }

    // ── Подготовка: агент A с владельцем A ──────────────────────────────────

    @Test
    @Order(1)
    void setUp() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"actor_id\":\"" + AGENT_ACTOR + "\",\"name\":\"S2-05 agent\",\"kind\":\"agent\"}")
        .when().post("/lore/actor").then().statusCode(200);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + SUB_A + "\",\"display_name\":\"S2-05 A\"}")
        .when().post("/lore/user").then().statusCode(200);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"actor_id\":\"" + AGENT_ACTOR + "\",\"client_id\":\"" + AGENT_CLIENT
                + "\",\"kc_sub\":\"" + SUB_A + "\"}")
        .when().post("/lore/actor/owner").then().statusCode(200).body("owner_linked", equalTo(true));
    }

    @Test
    @Order(2)
    void withoutIdentityIsUnauthorizedNotEmpty() {
        given().when().get("/lore/me/memory").then().statusCode(401).body("error", equalTo("NO_IDENTITY"));
        post("/lore/me/memory/delete", "{}").then().statusCode(401);
        post("/lore/me/memory/remembering", "{\"remembering\":false}").then().statusCode(401);
    }

    // ── Запоминание ─────────────────────────────────────────────────────────

    @Test
    @Order(10)
    @TestSecurity(user = "s205-a", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = SUB_A))
    void ownerHabitsAreRemembered() {
        viewUid = post("/lore/me/views", "{\"name\":\"S205 вид\",\"section\":\"tasks\",\"query\":\"status=open\"}")
            .then().statusCode(200).extract().path("view.view_uid");

        post("/lore/me/memory/hit", "{\"kind\":\"frequent_views\",\"key\":\"" + viewUid + "\"}")
            .then().statusCode(200).body("recorded", equalTo(true));
        post("/lore/me/memory/hit", "{\"kind\":\"frequent_slices\",\"key\":\"adrs?status=proposed\",\"label\":\"Предложенные\"}")
            .then().statusCode(200).body("recorded", equalTo(true)).body("hits", equalTo(1));
        post("/lore/me/memory/hit", "{\"kind\":\"frequent_slices\",\"key\":\"adrs?status=proposed\"}")
            .then().statusCode(200).body("hits", equalTo(2));
        post("/lore/me/recent", "{\"ref_type\":\"adr\",\"ref_id\":\"ADR-S205-1\"}")
            .then().statusCode(200).body("recorded", equalTo(true));

        Response r = given().when().get("/lore/me/memory");
        r.then().statusCode(200)
            .body("remembering", equalTo(true))
            .body("retention_days", equalTo(90))
            .body("access", equalTo("self_and_own_agents"));
        List<String> kinds = r.path("categories.kind");
        assertEquals(List.of("frequent_views", "frequent_slices", "recent_records"), kinds);

        Map<String, Object> v = byKey(items(r, "frequent_views"), viewUid);
        assertNotNull(v, "частый вид не запомнен");
        assertEquals("S205 вид", v.get("label"), "подпись частого вида — имя вида S2-04");
        viewHabitId = (String) v.get("memory_id");

        Map<String, Object> s = byKey(items(r, "frequent_slices"), "adrs?status=proposed");
        assertNotNull(s);
        assertEquals(2, s.get("hits"));
        assertEquals("Предложенные", s.get("label"), "подпись не затирается вызовом без label");
        assertNotNull(s.get("first_seen"));
        assertNotNull(s.get("last_seen"));
        sliceHabitId = (String) s.get("memory_id");

        Map<String, Object> rec = byKey(items(r, "recent_records"), "adr:ADR-S205-1");
        assertNotNull(rec, "недавняя запись не видна в памяти");
        assertEquals("recent:adr:ADR-S205-1", rec.get("memory_id"));
    }

    @Test
    @Order(11)
    @TestSecurity(user = "s205-a", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = SUB_A))
    void badHitsAreRejected() {
        post("/lore/me/memory/hit", "{\"kind\":\"recent_records\",\"key\":\"adr:X\"}")
            .then().statusCode(400).body("error", equalTo("BAD_PARAMS"));
        post("/lore/me/memory/hit", "{\"kind\":\"frequent_slices\",\"key\":\"Bad Section\"}").then().statusCode(400);
        post("/lore/me/memory/hit", "{\"kind\":\"frequent_views\",\"key\":\"view-does-not-exist\"}")
            .then().statusCode(404);
    }

    // ── Доступ ──────────────────────────────────────────────────────────────

    @Test
    @Order(20)
    @TestSecurity(user = "s205-b", roles = {"admin"})
    @JwtSecurity(claims = @Claim(key = "sub", value = SUB_B))
    void otherUserEvenAdminSeesNothingAndCannotErase() {
        Response r = given().header("X-Seer-Role", "admin").when().get("/lore/me/memory");
        r.then().statusCode(200);
        assertNull(byKey(items(r, "frequent_views"), viewUid), "чужая привычка утекла");
        assertNull(byKey(items(r, "frequent_slices"), "adrs?status=proposed"), "чужая привычка утекла");
        assertNull(byKey(items(r, "recent_records"), "adr:ADR-S205-1"), "чужая недавняя утекла");
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"memory_id\":\"" + sliceHabitId + "\"}")
        .when().post("/lore/me/memory/delete").then().statusCode(404);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"memory_id\":\"recent:adr:ADR-S205-1\"}")
        .when().post("/lore/me/memory/delete").then().statusCode(404);
    }

    @Test
    @Order(21)
    @TestSecurity(user = "svc-agent", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "client_id", value = AGENT_CLIENT))
    void ownAgentReadsAndErasesButDoesNotControlOrWrite() {
        Response r = given().when().get("/lore/me/memory");
        r.then().statusCode(200);
        assertNotNull(byKey(items(r, "frequent_slices"), "adrs?status=proposed"), "агент владельца не видит его память");

        post("/lore/me/memory/remembering", "{\"remembering\":false}")
            .then().statusCode(403).body("error", equalTo("AGENT_SCOPE_FORBIDDEN"));
        post("/lore/me/memory/hit", "{\"kind\":\"frequent_slices\",\"key\":\"tasks\"}")
            .then().statusCode(403).body("error", equalTo("AGENT_SCOPE_FORBIDDEN"));

        post("/lore/me/memory/delete", "{\"memory_id\":\"recent:adr:ADR-S205-1\"}")
            .then().statusCode(200).body("outcome", equalTo("deleted"));
        Response after = given().when().get("/lore/me/memory");
        assertNull(byKey(items(after, "recent_records"), "adr:ADR-S205-1"), "стёртая запись осталась");
    }

    @Test
    @Order(22)
    @TestSecurity(user = "svc-orphan", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "client_id", value = "lore-mcp-s205-orphan"))
    void agentWithoutOwnerIsUnauthorized() {
        given().when().get("/lore/me/memory").then().statusCode(401).body("error", equalTo("NO_IDENTITY"));
    }

    // ── «Не запоминать» ─────────────────────────────────────────────────────

    @Test
    @Order(30)
    @TestSecurity(user = "s205-a", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = SUB_A))
    void notRememberingStopsWritesHonestly() {
        post("/lore/me/memory/remembering", "{}").then().statusCode(400);
        post("/lore/me/memory/remembering", "{\"remembering\":false}")
            .then().statusCode(200).body("remembering", equalTo(false)).body("outcome", equalTo("updated"));
        post("/lore/me/memory/remembering", "{\"remembering\":false}")
            .then().statusCode(200).body("outcome", equalTo("unchanged"));

        post("/lore/me/memory/hit", "{\"kind\":\"frequent_slices\",\"key\":\"adrs?status=proposed\"}")
            .then().statusCode(200).body("recorded", equalTo(false)).body("reason", equalTo("not_remembering"));
        post("/lore/me/recent", "{\"ref_type\":\"adr\",\"ref_id\":\"ADR-S205-OFF\"}")
            .then().statusCode(200).body("recorded", equalTo(false)).body("reason", equalTo("not_remembering"));

        Response r = given().when().get("/lore/me/memory");
        r.then().statusCode(200).body("remembering", equalTo(false));
        assertEquals(2, byKey(items(r, "frequent_slices"), "adrs?status=proposed").get("hits"),
            "при выключенной памяти счётчик не растёт");
        assertNull(byKey(items(r, "recent_records"), "adr:ADR-S205-OFF"));
        given().when().get("/lore/me/recent").then().statusCode(200).body("remembering", equalTo(false));

        post("/lore/me/memory/remembering", "{\"remembering\":true}")
            .then().statusCode(200).body("remembering", equalTo(true));
        post("/lore/me/recent", "{\"ref_type\":\"adr\",\"ref_id\":\"ADR-S205-ON\"}")
            .then().statusCode(200).body("recorded", equalTo(true));
    }

    // ── Стереть ─────────────────────────────────────────────────────────────

    @Test
    @Order(40)
    @TestSecurity(user = "s205-a", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = SUB_A))
    void eraseByKindAndDeletedViewLeavesFrequent() {
        post("/lore/me/memory/delete", "{\"kind\":\"bogus\"}").then().statusCode(400).body("error", equalTo("BAD_PARAMS"));
        post("/lore/me/memory/delete", "{\"memory_id\":\"mem-nope\"}").then().statusCode(404);

        post("/lore/me/memory/delete", "{\"kind\":\"frequent_slices\"}")
            .then().statusCode(200).body("outcome", equalTo("deleted"));
        Response r = given().when().get("/lore/me/memory");
        assertTrue(items(r, "frequent_slices").isEmpty(), "вид памяти не стёрт");
        assertNotNull(byKey(items(r, "frequent_views"), viewUid), "стёрли лишнее: частые виды");

        post("/lore/me/views/delete", "{\"view_uid\":\"" + viewUid + "\"}").then().statusCode(200);
        Response afterView = given().when().get("/lore/me/memory");
        assertNull(byKey(items(afterView, "frequent_views"), viewUid), "удалённый вид остался в частых");
        assertNotNull(viewHabitId);
    }

    @Test
    @Order(41)
    @TestSecurity(user = "s205-a", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = SUB_A))
    void eraseAll() {
        post("/lore/me/memory/hit", "{\"kind\":\"frequent_slices\",\"key\":\"tasks\"}")
            .then().statusCode(200).body("recorded", equalTo(true));
        post("/lore/me/memory/delete", "{}").then().statusCode(200).body("outcome", equalTo("deleted"));
        Response r = given().when().get("/lore/me/memory");
        for (String k : List.of("frequent_views", "frequent_slices", "recent_records"))
            assertTrue(items(r, k).isEmpty(), "после «стереть всё» осталось в " + k);
        post("/lore/me/memory/delete", "{}").then().statusCode(200).body("outcome", equalTo("noop"));
    }
}
