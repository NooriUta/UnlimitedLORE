package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_POLISH_UAT_1113/PU-17 — роли задачи живут рёбрами ROLE_HELD_BY (TR-05), а два пути
 * читали ещё строки вершины, которые больше не пишутся:
 * <ol>
 *   <li>перенос задачи (task_mv) копировал author/executor/reviewer_agent из пустых строк — роли
 *       терялись (репро приёмки: S9-FACETS-BAD-AXES → PU-01);</li>
 *   <li>гейт →done читал executor_agent/reviewer_agent из строк — у задачи, чей ревьюер назначен
 *       ребром, узкий профиль (developer/tester/pm/architect) получал 409 NO_SELF_ACCEPTANCE.</li>
 * </ol>
 * Узкий профиль приходит JWT-клеймом, которого в live-тесте нет, поэтому гейт проверяется по его
 * чтению ({@link LoreStatusResource#DONE_GATE_SQL}) на живой базе, а решение — модульно. Только CI.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class TaskRolesFromEdgesLiveDbTest {

    private static final String PROJECT = "pu17-roles-project";
    private static final String SRC = "SPRINT_PU17_SRC";
    private static final String DST = "SPRINT_PU17_DST";
    private static final String TASK = SRC + "/R-1";
    private static final String PERSON = "PU17 Ревьюер";
    private static final String AGENT = "pu17-agent-dev";

    @Inject
    LoreIngestService ingest;

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    private static void ok(String path, String body) {
        admin().body(body).when().post(path).then().statusCode(200);
    }

    @Test
    @Order(1)
    void setUp() {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"slug\":\"" + PROJECT + "\"}").when().post("/lore/project").then().statusCode(200);
        ok("/lore/user", "{\"kc_sub\":\"pu17-sub\",\"display_name\":\"" + PERSON + "\"}");
        ok("/lore/user/role", "{\"kc_sub\":\"pu17-sub\",\"project\":\"" + PROJECT + "\",\"role\":\"owner\"}");
        ok("/lore/actor", "{\"actor_id\":\"" + AGENT + "\",\"name\":\"PU17 агент\",\"kind\":\"agent\"}");
        for (String s : List.of(SRC, DST))
            ok("/lore/sprint/create", "{\"sprint_id\":\"" + s + "\",\"name\":\"" + s + "\",\"git_project\":\"" + PROJECT + "\"}");
        ok("/lore/task", "{\"sprint_id\":\"" + SRC + "\",\"task_id\":\"R-1\",\"title\":\"задача с ролями\"}");
        ok("/lore/task/role", "{\"task_uid\":\"" + TASK + "\",\"role\":\"executor\",\"identity\":\"" + AGENT + "\"}");
        ok("/lore/task/role", "{\"task_uid\":\"" + TASK + "\",\"role\":\"reviewer\",\"identity\":\"" + PERSON + "\"}");
        assertEquals(Map.of("executor", AGENT, "reviewer", PERSON), roles(TASK), "положительный контроль: роли назначены рёбрами");
    }

    private static Map<String, Object> roles(String uid) {
        List<Map<String, Object>> rows = given().when().get("/lore/slice/task_roles?id=" + uid)
            .then().statusCode(200).extract().jsonPath().getList("rows");
        Map<String, Object> out = new TreeMap<>();
        for (Map<String, Object> r : rows) out.put(String.valueOf(r.get("role")), r.get("identity"));
        return out;
    }

    /** Гейт →done видит исполнителя и ревьюера, назначенных рёбрами, а не пустые строки вершины. */
    @Test
    @Order(2)
    void doneGateReadsRoleHoldersFromEdges() {
        List<Map<String, Object>> rows = ingest.queryPublic(LoreStatusResource.DONE_GATE_SQL, Map.of("uid", TASK));
        assertEquals(1, rows.size(), "задача найдена");
        // WK-05 (ADR-LORE-014-D5): решение — LoreDoneGate; здесь — что чтение видит держателей рёбер.
        Map<String, Object> r = rows.get(0);
        assertNotNull(r.get("reviewer_agent"), "ревьюер назначен ребром — гейт его видит: " + r);
        assertNotEquals(r.get("executor_agent"), r.get("reviewer_agent"), "ревьюер отличен от исполнителя: " + r);
        assertNull(LoreDoneGate.done(new LoreDoneGate.Facts(false, "другой человек", String.valueOf(r.get("executor_agent")),
            String.valueOf(r.get("reviewer_agent")), "review", null, "pr", "#1"), LoreModelFile.content().workflow()),
            "приёмщик назначен ребром — гейт пропускает: " + r);
    }

    /** Перенос задачи сохраняет роли: у новой задачи те же держатели. */
    @Test
    @Order(3)
    void taskMoveKeepsRoleEdges() {
        String newUid = admin().body("{\"task_uid\":\"" + TASK + "\",\"target_sprint_id\":\"" + DST + "\"}")
            .post("/lore/task/move").then().statusCode(200).extract().jsonPath().getString("new_task_uid");
        assertEquals(DST + "/R-1", newUid);
        assertEquals(Map.of("executor", AGENT, "reviewer", PERSON), roles(newUid), "роли переехали вместе с задачей");
    }
}
