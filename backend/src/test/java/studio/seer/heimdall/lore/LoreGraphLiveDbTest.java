package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.quarkus.test.security.TestSecurity;
import io.quarkus.test.security.jwt.Claim;
import io.quarkus.test.security.jwt.JwtSecurity;
import io.restassured.path.json.JsonPath;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-04 — {@code GET /lore/graph} на живой ArcadeDB: SQL
 * источника ({@code bothE}, открытые рёбра SCD2, {@code @type NOT IN}), бизнес-ключи
 * узлов, статус с открытой строки истории, проектный скоуп, срез проекта.
 * Логика обхода покрыта чистым {@link LoreGraphBuilderTest}; здесь — то, чего без
 * базы не проверить. Профиль со включённым скоупом, как у {@link LoreBacklinksLiveDbTest}.
 */
@QuarkusTest
@TestProfile(ScopeEnforcedProfile.class)
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreGraphLiveDbTest {

    private static final String P_SEEN = "LORE_TEST_ORG/gc04-seen";
    private static final String P_HIDDEN = "LORE_TEST_ORG/gc04-hidden";
    private static final String VIEWER_SUB = "gc04-viewer-sub";

    private static final String ADR = "ADR-GC04-TARGET";
    private static final String ADR_HIDDEN = "ADR-GC04-HIDDEN";
    private static final String S_SEEN = "SPRINT_GC04_SEEN";
    private static final String S_HIDDEN = "SPRINT_GC04_HIDDEN_SECRET";
    private static final String T_SEEN_1 = S_SEEN + "/G-1";
    private static final String T_SEEN_2 = S_SEEN + "/G-2";
    private static final String T_HIDDEN = S_HIDDEN + "/G-H";

    private static void post(String role, String path, String body) {
        given().header("X-Seer-Role", role).contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    private static void admin(String path, String body) { post("admin", path, body); }

    @Test
    @Order(1)
    void setUp() {
        for (String slug : List.of(P_SEEN, P_HIDDEN))
            post("superadmin", "/lore/project", "{\"slug\":\"" + slug + "\"}");
        admin("/lore/user", "{\"kc_sub\":\"" + VIEWER_SUB + "\",\"display_name\":\"GC-04 Viewer\"}");
        admin("/lore/user/role", "{\"kc_sub\":\"" + VIEWER_SUB + "\",\"project\":\"" + P_SEEN
            + "\",\"role\":\"reader\"}");

        admin("/lore/adr", "{\"adr_id\":\"" + ADR + "\",\"name\":\"graph target\",\"status\":\"ACCEPTED\"}");
        admin("/lore/adr/project", "{\"adr_id\":\"" + ADR + "\",\"project\":\"" + P_SEEN + "\",\"action\":\"add\"}");
        admin("/lore/adr", "{\"adr_id\":\"" + ADR_HIDDEN + "\",\"name\":\"hidden\",\"status\":\"ACCEPTED\"}");
        admin("/lore/adr/project", "{\"adr_id\":\"" + ADR_HIDDEN + "\",\"project\":\"" + P_HIDDEN
            + "\",\"action\":\"add\"}");

        admin("/lore/sprint/create", "{\"sprint_id\":\"" + S_SEEN + "\",\"name\":\"seen\",\"git_project\":\""
            + P_SEEN + "\"}");
        admin("/lore/sprint/create", "{\"sprint_id\":\"" + S_HIDDEN + "\",\"name\":\"hidden\",\"git_project\":\""
            + P_HIDDEN + "\"}");
        for (String uid : List.of(T_SEEN_1, T_SEEN_2, T_HIDDEN)) {
            String[] p = uid.split("/");
            admin("/lore/task", "{\"sprint_id\":\"" + p[0] + "\",\"task_id\":\"" + p[1]
                + "\",\"title\":\"g\",\"work_class\":\"enb\"}");
            admin("/lore/task/adr", "{\"task_uid\":\"" + uid + "\",\"adr_id\":\"" + ADR + "\"}");
        }
        // Зависимость своего спринта от чужого — висячий конец под скоупом.
        admin("/lore/sprint/dep", "{\"from_sprint\":\"" + S_SEEN + "\",\"to_sprint\":\"" + S_HIDDEN
            + "\",\"kind\":\"hard\",\"reason\":\"gc04\"}");
    }

    private static JsonPath graph(Map<String, Object> params) {
        return given().queryParams(params).when().get("/lore/graph").then().statusCode(200).extract().jsonPath();
    }

    private static Map<String, Object> node(JsonPath jp, String id) {
        List<Map<String, Object>> nodes = jp.getList("nodes");
        for (Map<String, Object> n : nodes) if (id.equals(n.get("id"))) return n;
        return null;
    }

    @Test
    @Order(2)
    void neighborhoodDepthOneHasIncomingTasksWithKeysAndStatus() {
        JsonPath jp = graph(Map.of("type", "adr", "id", ADR, "depth", "1"));
        Map<String, Object> root = node(jp, ADR);
        assertNotNull(root, jp.prettify());
        assertEquals("adr", root.get("type"));
        assertEquals(0, root.get("depth"));
        assertEquals("accepted", root.get("status"));
        assertEquals("in_force", root.get("status_category"));
        for (String uid : List.of(T_SEEN_1, T_SEEN_2, T_HIDDEN)) {
            Map<String, Object> t = node(jp, uid);
            assertNotNull(t, "задача " + uid + " не видна по входящему JUSTIFIED_BY: " + jp.prettify());
            assertEquals("task", t.get("type"));
            assertEquals(1, t.get("depth"));
        }
        List<String> rels = jp.getList("edges.rel", String.class);
        assertTrue(rels.contains("JUSTIFIED_BY"));
        assertFalse(rels.contains("HAS_STATE"), "строка истории — не узел графа");
        assertTrue(jp.getBoolean("meta.complete"));
    }

    @Test
    @Order(3)
    void structuralLayerAddsSprintsMarkedStructural() {
        JsonPath off = graph(Map.of("type", "adr", "id", ADR, "depth", "2"));
        assertNull(node(off, S_SEEN), "PART_OF — структура, по умолчанию спринт не достигается");

        JsonPath on = graph(Map.of("type", "adr", "id", ADR, "depth", "2", "structural", "true"));
        assertNotNull(node(on, S_SEEN), on.prettify());
        assertEquals(2, node(on, S_SEEN).get("depth"));
        List<Map<String, Object>> edges = on.getList("edges");
        Map<String, Object> part = edges.stream().filter(e -> "PART_OF".equals(e.get("rel"))).findFirst().orElse(null);
        assertNotNull(part);
        assertEquals("structural", part.get("kind"));
    }

    @Test
    @Order(4)
    void sprintDependencyCarriesKind() {
        JsonPath jp = graph(Map.of("type", "sprint", "id", S_SEEN, "depth", "1", "rels", "DEPENDS_ON"));
        List<Map<String, Object>> edges = jp.getList("edges");
        assertEquals(1, edges.size(), jp.prettify());
        assertEquals(S_SEEN, edges.get(0).get("from"));
        assertEquals(S_HIDDEN, edges.get(0).get("to"));
        assertEquals("hard", edges.get(0).get("kind"));
    }

    @Test
    @Order(5)
    void limitTruncatesAndSaysSo() {
        JsonPath jp = graph(Map.of("type", "adr", "id", ADR, "depth", "1", "limit", "2"));
        assertEquals(2, jp.getList("nodes").size());
        assertTrue(jp.getBoolean("meta.truncated"));
        assertEquals(2, jp.getInt("meta.capped_at"));
        assertFalse(jp.getBoolean("meta.complete"));
    }

    @Test
    @Order(6)
    void projectSliceSeedsAreDepthZero() {
        JsonPath jp = graph(Map.of("scope", "project:" + P_SEEN));
        assertEquals(0, node(jp, S_SEEN).get("depth"), jp.prettify());
        assertEquals(0, node(jp, ADR).get("depth"));
        assertEquals(0, node(jp, T_SEEN_1).get("depth"));
        assertEquals("slice", jp.getString("meta.mode"));
    }

    @Test
    @Order(7)
    void badInputIsRefused() {
        given().queryParam("type", "nosuchtype").queryParam("id", "X")
            .when().get("/lore/graph").then().statusCode(400).body("error", equalTo("BAD_PARAMS"));
        given().queryParam("type", "adr").queryParam("id", ADR).queryParam("depth", "4")
            .when().get("/lore/graph").then().statusCode(400).body("error", equalTo("BAD_PARAMS"));
        given().queryParam("scope", "galaxy:x")
            .when().get("/lore/graph").then().statusCode(400).body("error", equalTo("BAD_SCOPE"));
        given().queryParam("scope", "all").queryParam("type", "adr").queryParam("id", ADR)
            .when().get("/lore/graph").then().statusCode(400).body("error", equalTo("BAD_PARAMS"));
        given().when().get("/lore/graph").then().statusCode(400).body("error", equalTo("BAD_PARAMS"));
        given().queryParam("type", "adr").queryParam("id", "ADR-GC04-NOPE")
            .when().get("/lore/graph").then().statusCode(404).body("error", equalTo("NOT_FOUND"));
        given().queryParam("scope", "project:LORE_TEST_ORG/gc04-nope")
            .when().get("/lore/graph").then().statusCode(404).body("error", equalTo("NOT_FOUND"));
    }

    // ── скоуп ────────────────────────────────────────────────────────────────

    @Test
    @Order(8)
    @TestSecurity(user = "gc04-viewer", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = VIEWER_SUB))
    void foreignNodesAreHiddenCountedAndNotLeaked() {
        JsonPath jp = graph(Map.of("type", "adr", "id", ADR, "depth", "2", "structural", "true"));
        assertNotNull(node(jp, T_SEEN_1));
        assertNull(node(jp, T_HIDDEN), "задача чужого проекта видна при включённом скоупе");
        assertTrue(jp.getInt("meta.hidden_by_scope") >= 1, jp.prettify());
        List<String> reasons = jp.getList("meta.dangling.reason", String.class);
        assertTrue(reasons.contains("hidden_by_scope"));
        String body = jp.prettify();
        assertFalse(body.contains(T_HIDDEN) || body.contains(S_HIDDEN), "ключ чужой записи утёк: " + body);
        assertEquals(Boolean.TRUE, jp.getBoolean("meta.caller_scope.applied"));
    }

    @Test
    @Order(9)
    @TestSecurity(user = "gc04-viewer", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = VIEWER_SUB))
    void foreignRootAndForeignSliceAreRefused() {
        given().queryParam("type", "adr").queryParam("id", ADR_HIDDEN)
            .when().get("/lore/graph").then().statusCode(403).body("error", equalTo("OUTSIDE_SCOPE"));
        given().queryParam("scope", "project:" + P_HIDDEN)
            .when().get("/lore/graph").then().statusCode(403).body("error", equalTo("OUTSIDE_SCOPE"));
    }

    @Test
    @Order(10)
    @TestSecurity(user = "gc04-nobody", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = "gc04-nobody-sub"))
    void emptyScopeIsRefusedNotEmpty() {
        given().queryParam("type", "adr").queryParam("id", ADR)
            .when().get("/lore/graph").then().statusCode(403).body("error", equalTo("SCOPE_EMPTY"));
        given().queryParam("scope", "all")
            .when().get("/lore/graph").then().statusCode(403).body("error", equalTo("SCOPE_EMPTY"));
    }
}
