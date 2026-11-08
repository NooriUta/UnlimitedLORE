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
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-02 — {@code GET /lore/backlinks?type&id}: «кто
 * ссылается на X» одним запросом, а не обратным полем в каждом слайсе.
 *
 * <p>Что держит тест:
 * <ul>
 *   <li>входящие рёбра сгруппированы по типу ребра, у источника — тип API и код;</li>
 *   <li>структурные рёбра (HAS_STATE, BELONGS_TO_PROJECT) в ответ не попадают;</li>
 *   <li>закрытое SCD2-ребро (ROLE_HELD_BY с valid_to) не показывается, а открытое
 *       показывается — положительный контроль, иначе «не видно» ничего не доказывает;</li>
 *   <li>лимит на группу режет items, но не счётчик: хаб честно говорит «есть ещё»;</li>
 *   <li>проектный скоуп как у слайсов: источник вне разрешённых проектов скрыт и
 *       ПОСЧИТАН, цель вне скоупа — 403, пустой скоуп — 403 SCOPE_EMPTY.</li>
 * </ul>
 *
 * <p>Профиль со включённым скоупом: без токена (auth выключен) поведение как у
 * superadmin — этим путём идут несоупные кейсы, скоупные идут под JWT viewer'а.
 */
@QuarkusTest
@TestProfile(ScopeEnforcedProfile.class)
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreBacklinksLiveDbTest {

    private static final String P_SEEN = "LORE_TEST_ORG/s202-seen";
    private static final String P_HIDDEN = "LORE_TEST_ORG/s202-hidden";
    private static final String VIEWER_SUB = "s202-viewer-sub";

    private static final String ADR = "ADR-S202-TARGET";
    private static final String ADR_HIDDEN = "ADR-S202-HIDDEN";
    private static final String UC = "UC-S202-1";
    private static final String S_SEEN = "SPRINT_S202_SEEN";
    private static final String S_HIDDEN = "SPRINT_S202_HIDDEN";
    private static final String T_SEEN_1 = S_SEEN + "/BL-1";
    private static final String T_SEEN_2 = S_SEEN + "/BL-2";
    private static final String T_HIDDEN = S_HIDDEN + "/BL-H";
    private static final String T_ROLE = S_SEEN + "/BL-ROLE";
    private static final String AGENT_OLD = "s202-agent-old";
    private static final String AGENT_NEW = "s202-agent-new";

    private static void post(String role, String path, String body) {
        given().header("X-Seer-Role", role).contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    private static void admin(String path, String body) { post("admin", path, body); }

    private static void superadmin(String path, String body) { post("superadmin", path, body); }

    @Test
    @Order(1)
    void setUp() {
        for (String slug : List.of(P_SEEN, P_HIDDEN))
            superadmin("/lore/project", "{\"slug\":\"" + slug + "\"}");

        admin("/lore/user", "{\"kc_sub\":\"" + VIEWER_SUB + "\",\"display_name\":\"S2-02 Viewer\"}");
        admin("/lore/user/role", "{\"kc_sub\":\"" + VIEWER_SUB + "\",\"project\":\"" + P_SEEN
            + "\",\"role\":\"reader\"}");

        // Цель в видимом проекте и вторая — в скрытом.
        admin("/lore/adr", "{\"adr_id\":\"" + ADR + "\",\"name\":\"backlinks target\",\"status\":\"ACCEPTED\"}");
        admin("/lore/adr/project", "{\"adr_id\":\"" + ADR + "\",\"project\":\"" + P_SEEN + "\",\"action\":\"add\"}");
        admin("/lore/adr", "{\"adr_id\":\"" + ADR_HIDDEN + "\",\"name\":\"hidden target\",\"status\":\"ACCEPTED\"}");
        admin("/lore/adr/project", "{\"adr_id\":\"" + ADR_HIDDEN + "\",\"project\":\"" + P_HIDDEN
            + "\",\"action\":\"add\"}");

        // Сценарий → ADR (TRACED_TO).
        admin("/lore/uc", "{\"uc_id\":\"" + UC + "\",\"title\":\"tracer\",\"goal_level\":\"sea-level\"}");
        admin("/lore/uc/link", "{\"uc_id\":\"" + UC + "\",\"rel\":\"project\",\"target_id\":\"" + P_SEEN + "\"}");
        admin("/lore/uc/link", "{\"uc_id\":\"" + UC + "\",\"rel\":\"adr\",\"target_id\":\"" + ADR + "\"}");

        // Задачи → ADR (JUSTIFIED_BY): две в видимом проекте, одна в скрытом.
        admin("/lore/sprint/create", "{\"sprint_id\":\"" + S_SEEN + "\",\"name\":\"seen\",\"git_project\":\""
            + P_SEEN + "\"}");
        admin("/lore/sprint/create", "{\"sprint_id\":\"" + S_HIDDEN + "\",\"name\":\"hidden\",\"git_project\":\""
            + P_HIDDEN + "\"}");
        for (String uid : List.of(T_SEEN_1, T_SEEN_2, T_HIDDEN, T_ROLE)) {
            String[] p = uid.split("/");
            admin("/lore/task", "{\"sprint_id\":\"" + p[0] + "\",\"task_id\":\"" + p[1]
                + "\",\"title\":\"bl\",\"work_class\":\"enb\"}");
        }
        for (String uid : List.of(T_SEEN_1, T_SEEN_2, T_HIDDEN))
            admin("/lore/task/adr", "{\"task_uid\":\"" + uid + "\",\"adr_id\":\"" + ADR + "\"}");

        // SCD2-ребро: исполнитель сменён — ребро к прежнему закрыто valid_to.
        for (String a : List.of(AGENT_OLD, AGENT_NEW))
            admin("/lore/actor", "{\"actor_id\":\"" + a + "\",\"name\":\"" + a + "\",\"kind\":\"agent\"}");
        admin("/lore/task/role", "{\"task_uid\":\"" + T_ROLE + "\",\"role\":\"executor\",\"identity\":\""
            + AGENT_OLD + "\"}");
        admin("/lore/task/role", "{\"task_uid\":\"" + T_ROLE + "\",\"role\":\"executor\",\"identity\":\""
            + AGENT_NEW + "\"}");
    }

    private static JsonPath backlinks(String type, String id, Integer limit) {
        var req = given().queryParam("type", type).queryParam("id", id);
        if (limit != null) req = req.queryParam("limit", limit);
        return req.when().get("/lore/backlinks").then().statusCode(200).extract().jsonPath();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> group(JsonPath jp, String edge) {
        List<Map<String, Object>> groups = jp.getList("groups");
        assertNotNull(groups, "в ответе нет groups");
        for (Map<String, Object> g : groups) if (edge.equals(g.get("edge"))) return g;
        return null;
    }

    @SuppressWarnings("unchecked")
    private static List<String> refIds(Map<String, Object> g) {
        return ((List<Map<String, Object>>) g.get("items")).stream()
            .map(i -> String.valueOf(i.get("ref_id"))).toList();
    }

    @Test
    @Order(2)
    @SuppressWarnings("unchecked")
    void incomingEdgesAreGroupedByEdgeTypeWithSourceTypeAndId() {
        JsonPath jp = backlinks("adr", ADR, null);
        assertEquals("adr", jp.getString("type"));
        assertEquals(ADR, jp.getString("id"));

        Map<String, Object> traced = group(jp, "TRACED_TO");
        assertNotNull(traced, "сценарий, сославшийся на ADR, не виден: " + jp.prettify());
        assertEquals(List.of(UC), refIds(traced));
        Map<String, Object> item = ((List<Map<String, Object>>) traced.get("items")).get(0);
        assertEquals("use_case", item.get("type"));
        assertEquals("tracer", item.get("title"));

        Map<String, Object> justified = group(jp, "JUSTIFIED_BY");
        assertNotNull(justified, "задачи, сославшиеся на ADR, не видны: " + jp.prettify());
        assertEquals(3, ((Number) justified.get("count")).intValue());
        assertTrue(refIds(justified).containsAll(List.of(T_SEEN_1, T_SEEN_2, T_HIDDEN)));
        assertEquals(4, jp.getInt("total"));
        assertTrue(jp.getBoolean("complete"));
    }

    @Test
    @Order(3)
    void structuralEdgesAreNotBacklinks() {
        JsonPath jp = backlinks("adr", ADR, null);
        List<String> edges = jp.getList("groups.edge", String.class);
        assertFalse(edges.contains("HAS_STATE"), "HAS_STATE — структура SCD2, не ссылка");
        assertFalse(edges.contains("BELONGS_TO_PROJECT"), "проектная привязка — не ссылка");
        assertTrue(jp.getList("excluded_edges", String.class).containsAll(List.of("HAS_STATE", "BELONGS_TO_PROJECT")),
            "исключённые типы рёбер обязаны быть названы в ответе");
    }

    @Test
    @Order(4)
    void closedScd2EdgeIsHiddenOpenOneIsShown() {
        // Положительный контроль: открытое ребро к новому исполнителю видно.
        Map<String, Object> fresh = group(backlinks("agent_actor", AGENT_NEW, null), "ROLE_HELD_BY");
        assertNotNull(fresh, "открытое ребро роли не видно — проверка закрытого ничего бы не доказала");
        assertEquals(List.of(T_ROLE), refIds(fresh));

        // Закрытое (valid_to проставлен при смене исполнителя) — не видно.
        assertNull(group(backlinks("agent_actor", AGENT_OLD, null), "ROLE_HELD_BY"),
            "закрытое SCD2-ребро попало в обратные связи");
    }

    @Test
    @Order(5)
    void limitCutsItemsButNotTheCount() {
        JsonPath jp = backlinks("adr", ADR, 1);
        Map<String, Object> justified = group(jp, "JUSTIFIED_BY");
        assertNotNull(justified);
        assertEquals(3, ((Number) justified.get("count")).intValue(), "счётчик группы обязан быть полным");
        assertEquals(1, refIds(justified).size());
        assertEquals(Boolean.TRUE, justified.get("truncated"));
        assertEquals(1, jp.getInt("limit"));
    }

    @Test
    @Order(6)
    void badInputIsRefusedAndMissingIdIsNotFound() {
        given().queryParam("type", "nosuchtype").queryParam("id", "X")
            .when().get("/lore/backlinks").then().statusCode(400).body("error", equalTo("BAD_PARAMS"));
        given().queryParam("type", "adr")
            .when().get("/lore/backlinks").then().statusCode(400).body("error", equalTo("BAD_PARAMS"));
        given().queryParam("type", "adr").queryParam("id", "ADR-S202-NOPE")
            .when().get("/lore/backlinks").then().statusCode(404).body("error", equalTo("NOT_FOUND"));
    }

    // ── скоуп ────────────────────────────────────────────────────────────────

    @Test
    @Order(7)
    @TestSecurity(user = "s202-viewer", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = VIEWER_SUB))
    void sourceOutsideScopeIsHiddenAndCounted() {
        JsonPath jp = backlinks("adr", ADR, null);
        Map<String, Object> justified = group(jp, "JUSTIFIED_BY");
        assertNotNull(justified);
        List<String> ids = refIds(justified);
        assertTrue(ids.containsAll(List.of(T_SEEN_1, T_SEEN_2)), "задачи своего проекта обязаны быть видны");
        assertFalse(ids.contains(T_HIDDEN), "задача чужого проекта видна при включённом скоупе");
        assertEquals(2, ((Number) justified.get("count")).intValue());
        assertEquals(1, jp.getInt("hidden_by_scope"), "скрытое скоупом обязано быть посчитано, а не исчезнуть");
        assertEquals(Boolean.TRUE, jp.getBoolean("scope.applied"));
    }

    @Test
    @Order(8)
    @TestSecurity(user = "s202-viewer", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = VIEWER_SUB))
    void targetOutsideScopeIsRefused() {
        given().queryParam("type", "adr").queryParam("id", ADR_HIDDEN)
            .when().get("/lore/backlinks").then().statusCode(403).body("error", equalTo("OUTSIDE_SCOPE"));
    }

    @Test
    @Order(9)
    @TestSecurity(user = "s202-nobody", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = "s202-nobody-sub"))
    void emptyScopeIsRefusedNotEmpty() {
        given().queryParam("type", "adr").queryParam("id", ADR)
            .when().get("/lore/backlinks").then().statusCode(403).body("error", equalTo("SCOPE_EMPTY"));
    }

    @Test
    @Order(10)
    void authOffSeesEverythingWithoutScopeMarker() {
        JsonPath jp = backlinks("adr", ADR, null);
        assertEquals(0, jp.getInt("hidden_by_scope"));
        assertNull(jp.get("scope"));
    }
}
