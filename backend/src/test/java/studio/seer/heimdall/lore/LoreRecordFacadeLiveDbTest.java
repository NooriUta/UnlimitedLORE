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
 * Общий PR контрактов (ADR-LORE-047, SPEC-LORE-UXR-RECORD-CONTRACT 0.3): фасад
 * {@code GET /lore/record/{type}/{id}}, путь привязки {@code POST …/relation},
 * версия записи в путях правки (A3) и сторож закрытия спринта (A5).
 * Живая БД — только в CI.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreRecordFacadeLiveDbTest {

    private io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    private void sprint(String id) {
        admin().body("{\"sprint_id\":\"" + id + "\",\"name\":\"" + id + "\",\"context_md\":\"ctx\",\"outcome_md\":\"итог\"}")
            .post("/lore/sprint/create").then().statusCode(200);
    }

    private void task(String sprint, String taskId) {
        admin().body("{\"sprint_id\":\"" + sprint + "\",\"task_id\":\"" + taskId + "\",\"title\":\"задача " + taskId
            + "\",\"task_type\":\"dev\"}").post("/lore/task").then().statusCode(200);
    }

    private JsonPath record(String type, String id) {
        return admin().get("/lore/record/" + type + "/" + id).then().statusCode(200).extract().jsonPath();
    }

    @Test
    void sprintPassportIsAssembledFromSlices() {
        final String sid = "SPRINT_REC_FACADE";
        sprint(sid);
        task(sid, "T-1");
        JsonPath r = record("sprint", sid);
        assertEquals("lore.record/1", r.getString("contract"));
        assertEquals("server", r.getString("meta.facade"));
        assertEquals("sprint", r.getString("record.type"));
        assertEquals(sid, r.getString("record.id"));
        assertNotNull(r.getString("record.version"), "версия = valid_from открытой строки истории");
        assertEquals("ctx", r.getString("values.context_md"));
        assertEquals("итог", r.getString("values.outcome_md"), "outcome_md с вершины (через sprint_tree)");
        List<Map<String, Object>> parts = r.getList("parts");
        Map<String, Object> tasks = parts.stream().filter(p -> "tasks".equals(p.get("key"))).findFirst().orElseThrow();
        assertEquals(1, tasks.get("count"));
        assertEquals("ok", tasks.get("state"));
        assertEquals("composition", tasks.get("relation"));
        assertEquals(true, r.getBoolean("perms.can_edit"));
        assertTrue(r.getList("perms.status_next").stream().noneMatch(s -> "done".equals(s)),
            "открытая задача — done не предлагается: " + r.getList("perms.status_next"));
        assertEquals("открыто 1 задач", r.getString("perms.reason"));
        assertEquals(0, r.getInt("facts.tasks.done"));
        assertEquals(1, r.getInt("facts.tasks.total"));
        assertTrue(r.getList("meta.sources.block").contains("tasks"));
        assertNotNull(r.get("schema.layout.tree"));
    }

    @Test
    void taskAdrSpecPassportsAndNewAndNotFound() {
        final String sid = "SPRINT_REC_TYPES";
        sprint(sid);
        task(sid, "T-1");
        JsonPath t = record("task", sid + "/T-1");
        assertEquals("задача T-1", t.getString("record.title"));
        assertEquals(sid, t.getString("values.sprint"));
        assertEquals("dev", t.getString("values.task_type"));
        assertNotNull(t.getString("record.version"));
        assertTrue(t.getList("meta.sources.block").containsAll(List.of("questions", "adrs")), t.getList("meta.sources.block").toString());
        // S4-30: по каждому прочитанному источнику — своё состояние; на здоровой базе все ok.
        List<String> dsParts = t.getList("meta.data_state.part");
        assertTrue(dsParts.containsAll(List.of("questions", "adrs")), "data_state: " + t.getList("meta.data_state"));
        assertTrue(t.getList("meta.data_state.source").contains("version"), "сбой версии тоже должен быть виден");
        assertTrue(t.getList("meta.data_state.state").stream().allMatch("ok"::equals), "data_state: " + t.getList("meta.data_state"));

        admin().body("{\"adr_id\":\"ADR-REC-1\",\"name\":\"проба\",\"status\":\"proposed\",\"context_md\":\"к\",\"decision_md\":\"р\"}")
            .post("/lore/adr").then().statusCode(200);
        JsonPath a = record("adr", "ADR-REC-1");
        assertEquals("к", a.getString("values.context_md"));
        assertEquals("р", a.getString("values.decision_md"));
        assertEquals(3, a.getList("schema.layout.body").size());

        admin().body("{\"spec_id\":\"SPEC-REC-1\",\"title\":\"спека\",\"content_md\":\"тело\",\"version\":\"0.1.0\"}")
            .post("/lore/spec").then().statusCode(200);
        JsonPath s = record("spec", "SPEC-REC-1");
        assertEquals("тело", s.getString("values.body_md"));
        assertEquals("0.1.0", s.getString("values.version"));

        JsonPath n = admin().get("/lore/record/task/_new").then().statusCode(200).extract().jsonPath();
        assertNull(n.get("record.version"));
        assertEquals("dev", n.getString("values.task_type"));
        assertEquals(true, n.getBoolean("perms.can_create"));
        assertTrue(n.getList("meta.data_state").isEmpty(), "новая запись ничего не читала — список пуст");

        admin().get("/lore/record/task/NOPE_SPRINT/NOPE").then().statusCode(404);
        admin().get("/lore/record/decision/D-1").then().statusCode(400);
    }

    @Test
    void relationEndpointDispatchesToExistingLinkAndRefusesUnknown() {
        sprint("SPRINT_REC_DEP_A");
        sprint("SPRINT_REC_DEP_B");
        admin().body("{\"rel\":\"DEPENDS_ON\",\"dir\":\"out\",\"target\":\"SPRINT_REC_DEP_B\",\"action\":\"add\"}")
            .post("/lore/record/sprint/SPRINT_REC_DEP_A/relation").then().statusCode(200);
        JsonPath a = record("sprint", "SPRINT_REC_DEP_A");
        assertTrue(a.getList("links.id").contains("SPRINT_REC_DEP_B"), a.getList("links").toString());
        // «блокирует» читается входящим у второго спринта
        JsonPath b = record("sprint", "SPRINT_REC_DEP_B");
        assertTrue(b.getList("links").stream().anyMatch(l -> {
            Map<?, ?> m = (Map<?, ?>) l;
            return "DEPENDS_ON".equals(m.get("rel")) && "in".equals(m.get("dir")) && "SPRINT_REC_DEP_A".equals(m.get("id"));
        }), b.getList("links").toString());

        var bad = admin().body("{\"rel\":\"NOPE\",\"dir\":\"out\",\"target\":\"X\",\"action\":\"add\"}")
            .post("/lore/record/sprint/SPRINT_REC_DEP_A/relation").then().statusCode(400).extract().jsonPath();
        assertTrue(bad.getList("allowed").contains("DEPENDS_ON:out"), bad.prettify());

        admin().body("{\"rel\":\"DEPENDS_ON\",\"dir\":\"out\",\"target\":\"SPRINT_REC_DEP_B\",\"action\":\"remove\"}")
            .post("/lore/record/sprint/SPRINT_REC_DEP_A/relation").then().statusCode(200);
        assertFalse(record("sprint", "SPRINT_REC_DEP_A").getList("links.id").contains("SPRINT_REC_DEP_B"));
    }

    @Test
    void sprintCannotBeClosedWithOpenTasks() {
        final String sid = "SPRINT_REC_CLOSE_GUARD";
        sprint(sid);
        task(sid, "T-1");
        var refused = admin().body("{\"entity_type\":\"sprint\",\"id\":\"" + sid + "\",\"status\":\"done\"}")
            .post("/lore/status").then().statusCode(409).extract().jsonPath();
        assertEquals("SPRINT_HAS_OPEN_TASKS", refused.getString("error"));
        assertEquals(List.of(sid + "/T-1"), refused.getList("open_tasks.task_uid"));
        admin().body("{\"entity_type\":\"sprint\",\"id\":\"" + sid + "\",\"status\":\"cancelled\"}")
            .post("/lore/status").then().statusCode(409);
        // положительный контроль: незакрывающий переход проходит
        admin().body("{\"entity_type\":\"sprint\",\"id\":\"" + sid + "\",\"status\":\"blocked\",\"reason\":\"проба\"}")
            .post("/lore/status").then().statusCode(200);
        // задача закрыта — спринт закрывается
        admin().body("{\"entity_type\":\"task\",\"id\":\"" + sid + "/T-1\",\"status\":\"cancelled\"}")
            .post("/lore/status").then().statusCode(200);
        admin().body("{\"entity_type\":\"sprint\",\"id\":\"" + sid + "\",\"status\":\"cancelled\"}")
            .post("/lore/status").then().statusCode(200);
        assertEquals(200, given().get("/lore/slice/closed_sprints_with_open_tasks").statusCode());
    }

    @Test
    void staleExpectedVersionIs409OnPassportWritePaths() {
        final String sid = "SPRINT_REC_VERSION";
        sprint(sid);
        task(sid, "T-1");
        String sv = record("sprint", sid).getString("record.version");
        var c = admin().body("{\"sprint_id\":\"" + sid + "\",\"context_md\":\"x\",\"expected_version\":\"1999-01-01T00:00:00.000Z\"}")
            .post("/lore/sprint/update").then().statusCode(409).extract().jsonPath();
        assertEquals("VERSION_CONFLICT", c.getString("error"));
        assertEquals(sv, c.getString("current.version"));
        admin().body("{\"sprint_id\":\"" + sid + "\",\"context_md\":\"x\",\"expected_version\":\"" + sv + "\"}")
            .post("/lore/sprint/update").then().statusCode(200);
        // без expected_version — как раньше (MCP, v1, miniLORE)
        admin().body("{\"sprint_id\":\"" + sid + "\",\"context_md\":\"y\"}").post("/lore/sprint/update").then().statusCode(200);

        String tv = record("task", sid + "/T-1").getString("record.version");
        admin().body("{\"task_uid\":\"" + sid + "/T-1\",\"title\":\"t2\",\"expected_version\":\"stale\"}")
            .post("/lore/task/edit").then().statusCode(409);
        admin().body("{\"task_uid\":\"" + sid + "/T-1\",\"title\":\"t2\",\"expected_version\":\"" + tv + "\"}")
            .post("/lore/task/edit").then().statusCode(200);

        admin().body("{\"spec_id\":\"SPEC-REC-VER\",\"title\":\"s\",\"content_md\":\"a\",\"version\":\"0.1.0\"}")
            .post("/lore/spec").then().statusCode(200);
        String pv = record("spec", "SPEC-REC-VER").getString("record.version");
        admin().body("{\"spec_id\":\"SPEC-REC-VER\",\"content_md\":\"b\",\"expected_version\":\"stale\"}")
            .post("/lore/spec").then().statusCode(409);
        admin().body("{\"spec_id\":\"SPEC-REC-VER\",\"content_md\":\"b\",\"expected_version\":\"" + pv + "\"}")
            .post("/lore/spec").then().statusCode(200);

        // S5-08 (kit 09.11): у ADR защиты не было — правка раздела молча ложилась поверх
        // чужой. Тело ADR — три раздела, каждый своим запросом: одновременная правка
        // двух разделов — самый вероятный конфликт.
        admin().body("{\"adr_id\":\"ADR-REC-VER\",\"name\":\"a\",\"status\":\"proposed\",\"context_md\":\"c\"}")
            .post("/lore/adr").then().statusCode(200);
        String av = record("adr", "ADR-REC-VER").getString("record.version");
        var ac = admin().body("{\"adr_id\":\"ADR-REC-VER\",\"decision_md\":\"d\",\"expected_version\":\"stale\"}")
            .post("/lore/adr").then().statusCode(409).extract().jsonPath();
        assertEquals("VERSION_CONFLICT", ac.getString("error"));
        assertEquals(av, ac.getString("current.version"));
        admin().body("{\"adr_id\":\"ADR-REC-VER\",\"decision_md\":\"d\",\"expected_version\":\"" + av + "\"}")
            .post("/lore/adr").then().statusCode(200);
        // без expected_version — как раньше (MCP adr_new, v1)
        admin().body("{\"adr_id\":\"ADR-REC-VER\",\"consequences_md\":\"e\"}").post("/lore/adr").then().statusCode(200);
    }

    @Test
    void newSlicesAnswer() {
        final String sid = "SPRINT_REC_SLICES";
        sprint(sid);
        task(sid, "T-1");
        admin().body("{\"adr_id\":\"ADR-REC-SL\",\"name\":\"a\",\"status\":\"proposed\"}").post("/lore/adr").then().statusCode(200);
        admin().body("{\"task_uid\":\"" + sid + "/T-1\",\"adr_id\":\"ADR-REC-SL\"}").post("/lore/task/adr").then().statusCode(200);
        List<Object> adrs = given().get("/lore/slice/adrs_of_task?id=" + sid + "/T-1").then().statusCode(200)
            .extract().jsonPath().getList("rows.adr_id");
        assertEquals(List.of("ADR-REC-SL"), adrs);
        List<Object> tasks = given().get("/lore/slice/tasks_of_adr?id=ADR-REC-SL").then().statusCode(200)
            .extract().jsonPath().getList("rows.task_uid");
        assertEquals(List.of(sid + "/T-1"), tasks);
        assertEquals(200, given().get("/lore/slice/questions_of_task?id=" + sid + "/T-1").statusCode());
        String outcome = given().get("/lore/slice/sprint_tree?id=" + sid).then().statusCode(200)
            .extract().jsonPath().getString("rows[0].outcome_md");
        assertEquals("итог", outcome);
    }
}
