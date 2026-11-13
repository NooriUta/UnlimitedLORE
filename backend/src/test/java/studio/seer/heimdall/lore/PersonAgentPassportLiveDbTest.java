package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.path.json.JsonPath;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S9_SCALE_OPT/S9-05 (часть A) — паспорта человека и агента на живой базе: шапка из
 * строки среза, «таблица детей» — задачи, где роль ОТКРЫТА (сменённый исполнитель в детях не
 * числится), и ни одного «не смогли проверить» в meta.data_state.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class PersonAgentPassportLiveDbTest {

    private static final String PROJECT = "LORE_TEST_ORG/s905-people";
    private static final String SPRINT = "SPRINT_S905_PEOPLE";
    private static final String TASK = SPRINT + "/PA-1";
    private static final String AGENT_OLD = "s905-agent-old";
    private static final String AGENT_NEW = "s905-agent-new";
    private static final String SUB = "s905-person-sub";

    private static void post(String role, String path, String body) {
        given().header("X-Seer-Role", role).contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    private static JsonPath record(String type, String id) {
        return given().header("X-Seer-Role", "admin").get("/lore/record/" + type + "/" + id)
            .then().statusCode(200).extract().jsonPath();
    }

    private static List<Map<String, Object>> errors(JsonPath r) {
        List<Map<String, Object>> st = r.getList("meta.data_state");
        assertNotNull(st, "meta.data_state есть");
        return st.stream().filter(e -> "error".equals(e.get("state"))).toList();
    }

    private static List<String> taskIds(JsonPath r) {
        List<Map<String, Object>> links = r.getList("links");
        return links.stream().filter(l -> "ROLE_HELD_BY".equals(l.get("rel")) && "in".equals(l.get("dir")))
            .map(l -> String.valueOf(l.get("id"))).toList();
    }

    @Test
    void agentPassportListsOnlyTasksWithAnOpenRole() {
        post("superadmin", "/lore/project", "{\"slug\":\"" + PROJECT + "\"}");
        post("admin", "/lore/sprint/create", "{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"s905\",\"git_project\":\"" + PROJECT + "\"}");
        post("admin", "/lore/task", "{\"sprint_id\":\"" + SPRINT + "\",\"task_id\":\"PA-1\",\"title\":\"задача агента\",\"work_class\":\"enb\"}");
        for (String a : List.of(AGENT_OLD, AGENT_NEW))
            post("admin", "/lore/actor", "{\"actor_id\":\"" + a + "\",\"name\":\"" + a + "\",\"kind\":\"agent\"}");
        // Исполнитель сменён: ребро к прежнему закрыто valid_to.
        post("admin", "/lore/task/role", "{\"task_uid\":\"" + TASK + "\",\"role\":\"executor\",\"identity\":\"" + AGENT_OLD + "\"}");
        post("admin", "/lore/task/role", "{\"task_uid\":\"" + TASK + "\",\"role\":\"executor\",\"identity\":\"" + AGENT_NEW + "\"}");

        JsonPath now = record("agent", AGENT_NEW);
        assertEquals(List.of(), errors(now), "паспорт агента без сбоев");
        assertEquals(AGENT_NEW, now.getString("values.title"));
        assertEquals(List.of(TASK), taskIds(now), "у нынешнего исполнителя задача в детях: " + now.getList("links"));

        JsonPath was = record("agent", AGENT_OLD);
        assertEquals(List.of(), errors(was));
        assertEquals(List.of(), taskIds(was), "сменённый исполнитель задачу в детях не держит: " + was.getList("links"));

        // Положительный контроль: вкладка прочитана своим срезом, а не пропущена.
        List<Map<String, Object>> st = now.getList("meta.data_state");
        assertTrue(st.stream().anyMatch(e -> String.valueOf(e.get("source")).contains("agent_tasks") && "ok".equals(e.get("state"))),
            "вкладка «Задачи» прочитана срезом agent_tasks: " + st);
    }

    @Test
    void personPassportOpensByKcSubWithCheckedEmptyChildren() {
        post("admin", "/lore/user", "{\"kc_sub\":\"" + SUB + "\",\"display_name\":\"S9-05 Person\"}");
        JsonPath p = record("user", SUB);
        assertEquals(List.of(), errors(p), "паспорт человека без сбоев: пустые дети — проверенный ноль");
        assertEquals("S9-05 Person", p.getString("values.title"));
        assertEquals(List.of(), taskIds(p));
    }

    @Test
    void productRoleIsNotAnAgentPassport() {
        given().header("X-Seer-Role", "admin").get("/lore/record/agent/нет-такого-агента")
            .then().statusCode(404);
    }
}
