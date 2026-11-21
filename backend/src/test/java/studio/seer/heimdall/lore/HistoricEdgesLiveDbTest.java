package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-02 · Историчная связь на живой базе: смена связи закрывает прежнее
 * ребро ({@code valid_to = сейчас}) и открывает новое, а срезы видят только текущее.
 *
 * <p>Проверяется граф, а не ответ записи: рёбра читаются обратно прямым запросом к базе, в том числе
 * закрытые — их стирание и было бы потерей истории.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class HistoricEdgesLiveDbTest {

    private static final String PROJECT = "eh-hist-project";
    private static final String SPRINT = "SPRINT_EH_HIST";
    private static final String TASK = SPRINT + "/EH-1";
    private static final String SUB = "eh-sub-1";
    private static String phaseA;
    private static String phaseB;

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "superadmin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    private static String createPhase(String key, int order) {
        return given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"sprint_id\":\"" + SPRINT + "\",\"phase_key\":\"" + key + "\",\"name\":\"Фаза " + key
                + "\",\"order_index\":" + order + "}")
            .when().post("/lore/phase").then().statusCode(200).extract().jsonPath().getString("phase_uid");
    }

    /** Прямой запрос к тестовой базе (только чтение): закрытые рёбра срезы не покажут, а база — да. */
    private static List<Map<String, Object>> db(String sql) {
        try {
            String body = io.vertx.core.json.JsonObject.of("language", "sql", "command", sql).encode();
            java.net.http.HttpRequest req = java.net.http.HttpRequest.newBuilder(java.net.URI.create(
                    LoreArcadeDbTestResource.BASE_URL + "/api/v1/query/" + LoreArcadeDbTestResource.TEST_DB))
                .header("Content-Type", "application/json; charset=utf-8")
                .header("Authorization", "Basic " + java.util.Base64.getEncoder().encodeToString(
                    ("root:" + LoreArcadeDbTestResource.ROOT_PASSWORD).getBytes(java.nio.charset.StandardCharsets.UTF_8)))
                .POST(java.net.http.HttpRequest.BodyPublishers.ofString(body, java.nio.charset.StandardCharsets.UTF_8)).build();
            String r = LiveDbHttp.client().send(req, java.net.http.HttpResponse.BodyHandlers.ofString()).body();
            io.vertx.core.json.JsonArray arr = new io.vertx.core.json.JsonObject(r).getJsonArray("result", new io.vertx.core.json.JsonArray());
            List<Map<String, Object>> out = new java.util.ArrayList<>();
            for (int i = 0; i < arr.size(); i++) out.add(arr.getJsonObject(i).getMap());
            return out;
        } catch (Exception e) {
            throw new IllegalStateException("запрос к тестовой базе: " + e.getMessage(), e);
        }
    }

    private static List<Map<String, Object>> rows(String slice, String param, String value) {
        return given().queryParam(param, value).when().get("/lore/slice/" + slice)
            .then().statusCode(200).extract().jsonPath().getList("rows");
    }

    @Test
    @Order(1)
    void setUp() {
        post("/lore/project", "{\"slug\":\"" + PROJECT + "\"}");
        post("/lore/sprint/create", "{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"История связей\",\"git_project\":\"" + PROJECT + "\"}");
        phaseA = createPhase("A", 1);
        phaseB = createPhase("B", 2);
        post("/lore/task", "{\"sprint_id\":\"" + SPRINT + "\",\"task_id\":\"EH-1\",\"title\":\"Задача меняет фазу\",\"phase_uid\":\"" + phaseA + "\"}");
        post("/lore/user", "{\"kc_sub\":\"" + SUB + "\",\"display_name\":\"EH Человек\"}");
    }

    /** Связь, созданная вместе с задачей, тоже несёт «действует с» — иначе её начало потеряно. */
    @Test
    @Order(2)
    void edgeCreatedWithTheTaskHasValidFrom() {
        List<Map<String, Object>> e = db("SELECT valid_from, valid_to FROM IN_PHASE WHERE @out.task_uid = '" + TASK + "'");
        assertEquals(1, e.size(), "одно ребро фазы: " + e);
        assertNotNull(e.get(0).get("valid_from"), "valid_from у ребра из создания задачи");
        assertNull(e.get(0).get("valid_to"));
    }

    @Test
    @Order(3)
    void changingThePhaseClosesTheOldEdgeAndOpensANewOne() {
        post("/lore/task/phase", "{\"task_uid\":\"" + TASK + "\",\"phase_uid\":\"" + phaseA + "\",\"action\":\"remove\"}");
        post("/lore/task/phase", "{\"task_uid\":\"" + TASK + "\",\"phase_uid\":\"" + phaseB + "\",\"action\":\"add\"}");

        List<Map<String, Object>> all = db("SELECT @in.phase_uid AS p, valid_from, valid_to FROM IN_PHASE "
            + "WHERE @out.task_uid = '" + TASK + "' ORDER BY valid_from");
        assertEquals(2, all.size(), "прежнее ребро не стёрто, а закрыто: " + all);
        Map<String, Object> old = all.stream().filter(r -> phaseA.equals(r.get("p"))).findFirst().orElseThrow();
        Map<String, Object> cur = all.stream().filter(r -> phaseB.equals(r.get("p"))).findFirst().orElseThrow();
        assertNotNull(old.get("valid_to"), "старая связь закрыта");
        assertNull(cur.get("valid_to"), "новая связь открыта");
        assertNotNull(cur.get("valid_from"), "у новой связи есть начало");

        assertTrue(rows("tasks_of_phase", "phase_uid", phaseA).isEmpty(), "срез фазы A не видит закрытую связь");
        assertEquals(List.of(TASK), rows("tasks_of_phase", "phase_uid", phaseB).stream().map(r -> r.get("task_uid")).toList());
        List<Map<String, Object>> sprint = rows("tasks_of_sprint", "sprint_id", SPRINT);
        assertEquals(phaseB, sprint.stream().filter(r -> TASK.equals(r.get("task_uid"))).findFirst().orElseThrow().get("phase_uid"),
            "в списке спринта у задачи одна текущая фаза");
    }

    @Test
    @Order(4)
    void returningToAClosedPhaseOpensAFreshEdge() {
        post("/lore/task/phase", "{\"task_uid\":\"" + TASK + "\",\"phase_uid\":\"" + phaseB + "\",\"action\":\"remove\"}");
        post("/lore/task/phase", "{\"task_uid\":\"" + TASK + "\",\"phase_uid\":\"" + phaseA + "\",\"action\":\"add\"}");
        List<Map<String, Object>> open = db("SELECT @in.phase_uid AS p FROM IN_PHASE WHERE @out.task_uid = '" + TASK + "' AND valid_to IS NULL");
        assertEquals(List.of(phaseA), open.stream().map(r -> r.get("p")).toList());
        assertEquals(3, db("SELECT FROM IN_PHASE WHERE @out.task_uid = '" + TASK + "'").size(), "три версии связи");
    }

    @Test
    @Order(5)
    void changingTheProjectRoleClosesTheOldEdge() {
        post("/lore/user/role", "{\"kc_sub\":\"" + SUB + "\",\"project\":\"" + PROJECT + "\",\"role\":\"developer\"}");
        post("/lore/user/role", "{\"kc_sub\":\"" + SUB + "\",\"project\":\"" + PROJECT + "\",\"role\":\"reader\"}");

        List<Map<String, Object>> all = db("SELECT role, valid_from, valid_to FROM HAS_PROJECT_ROLE "
            + "WHERE @out.kc_sub = '" + SUB + "' AND @in.slug = '" + PROJECT + "'");
        assertEquals(2, all.size(), "смена роли — новая версия ребра, а не правка на месте: " + all);
        Map<String, Object> old = all.stream().filter(r -> "developer".equals(r.get("role"))).findFirst().orElseThrow();
        Map<String, Object> cur = all.stream().filter(r -> "reader".equals(r.get("role"))).findFirst().orElseThrow();
        assertNotNull(old.get("valid_to"));
        assertNull(cur.get("valid_to"));

        List<Map<String, Object>> people = rows("project_people", "project", PROJECT).stream()
            .filter(r -> SUB.equals(r.get("kc_sub"))).toList();
        assertEquals(1, people.size(), "срез людей проекта видит одну текущую роль: " + people);
        assertEquals("reader", people.get(0).get("role"));
        List<Map<String, Object>> mine = rows("user_project_roles", "kc_sub", SUB);
        assertEquals(List.of("reader"), mine.get(0).get("roles"), "роли человека — только текущая");
    }

    @Test
    @Order(6)
    void removingTheRoleClosesItAndAccessIsGone() {
        post("/lore/user/role", "{\"kc_sub\":\"" + SUB + "\",\"project\":\"" + PROJECT + "\",\"action\":\"remove\"}");
        assertEquals(2, db("SELECT FROM HAS_PROJECT_ROLE WHERE @out.kc_sub = '" + SUB + "'").size(), "снятие не стирает историю");
        assertTrue(db("SELECT FROM HAS_PROJECT_ROLE WHERE @out.kc_sub = '" + SUB + "' AND valid_to IS NULL").isEmpty());
        assertTrue(rows("project_people", "project", PROJECT).stream().noneMatch(r -> SUB.equals(r.get("kc_sub"))),
            "снятая роль не видна в людях проекта");
    }
}
