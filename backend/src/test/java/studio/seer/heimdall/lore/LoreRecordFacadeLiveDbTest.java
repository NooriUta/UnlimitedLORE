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
        // MC-04 (PU-02): вкладок «без среза — не проверено» больше нет; вкладка без своего среза читается
        // по ребру из модели (источник «edge:…»). На здоровой базе ВСЕ источники ok.
        List<Map<String, Object>> ds = t.getList("meta.data_state");
        assertTrue(ds.stream().allMatch(e -> "ok".equals(e.get("state"))), "data_state: " + ds);
        assertTrue(ds.stream().noneMatch(e -> String.valueOf(e.get("source")).startsWith("relation:")), "data_state: " + ds);
        assertTrue(ds.stream().anyMatch(e -> "edge:REFERENCES:out".equals(e.get("source"))),
            "вкладка «Ссылается» прочитана по ребру: " + ds);

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
        admin().get("/lore/record/pain/P-1").then().statusCode(400);   // тип без паспорта (компонент, технология, фича заведены S4-V2-SECTIONS)
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
        // S5-08: правка на месте двигает версию — вторая правка с той же (прочитанной ДО
        // первой) версией не ложится поверх молча. До S5-08 версия была одним valid_from
        // открытой строки, правка текста её не двигала, и здесь было 200.
        var c2 = admin().body("{\"sprint_id\":\"" + sid + "\",\"context_md\":\"поверх\",\"expected_version\":\"" + sv + "\"}")
            .post("/lore/sprint/update").then().statusCode(409).extract().jsonPath();
        assertEquals(record("sprint", sid).getString("record.version"), c2.getString("current.version"));
        // без expected_version — как раньше (MCP, v1, miniLORE)
        admin().body("{\"sprint_id\":\"" + sid + "\",\"context_md\":\"y\"}").post("/lore/sprint/update").then().statusCode(200);

        String tv = record("task", sid + "/T-1").getString("record.version");
        admin().body("{\"task_uid\":\"" + sid + "/T-1\",\"title\":\"t2\",\"expected_version\":\"stale\"}")
            .post("/lore/task/edit").then().statusCode(409);
        admin().body("{\"task_uid\":\"" + sid + "/T-1\",\"title\":\"t2\",\"expected_version\":\"" + tv + "\"}")
            .post("/lore/task/edit").then().statusCode(200);
        admin().body("{\"task_uid\":\"" + sid + "/T-1\",\"title\":\"t3\",\"note_md\":\"поверх\",\"expected_version\":\"" + tv + "\"}")
            .post("/lore/task/edit").then().statusCode(409);

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

    /**
     * Владелица 09.11: итоги спринта в паспорте — те же ключи и та же функция
     * (LoreSprintTotals), что у среза sprint_totals: одно число — один источник.
     */
    @Test
    void sprintPassportCarriesServerTotalsLikeTheList() {
        final String sid = "SPRINT_REC_TOTALS";
        sprint(sid);
        task(sid, "T-1");
        task(sid, "T-2");
        JsonPath r = record("sprint", sid);
        // Итоги — отдельным блоком computed, не в values: values — поля схемы, клиент рисует
        // их строкой, и объект {value, known, of} там стал бы мусором (S7A-12, 09.11).
        assertNull(r.get("values.tasks_total"), "итоги не в values");
        assertEquals(2, r.getInt("computed.tasks_total.of"), "задач в спринте");
        assertEquals(0, r.getInt("computed.tasks_total.done"));
        assertEquals(0, r.getInt("computed.effort_days_total.known"), "оценок не задавали");
        assertNull(r.get("computed.effort_days_total.value"), "нет оценок — null, а не 0");
        JsonPath list = given().get("/lore/slice/sprint_totals?sprint_ids=" + sid).then().statusCode(200).extract().jsonPath();
        assertEquals(r.getMap("computed.tasks_total"), list.getMap("rows[0].tasks_total"), "паспорт и список — одно число");
    }

    /**
     * SPRINT_UXR_S11_TEST_OPT/CT-RECORD — то, на чём kit держит кнопки: perms.can_status (кнопка
     * статуса) и record.version строкой (защита от перезаписи). В values — только скаляры и
     * списки: объект там клиент рисует мусором (#1004).
     */
    @Test
    void contractForKit() {
        final String sid = "SPRINT_REC_CONTRACT";
        sprint(sid);
        task(sid, "T-1");
        for (String[] tr : new String[][]{{"sprint", sid}, {"task", sid + "/T-1"}}) {
            JsonPath r = record(tr[0], tr[1]);
            String w = tr[0] + ": ";
            assertInstanceOf(String.class, r.get("record.version"), w + "версия — строка (valid_from открытой версии)");
            assertInstanceOf(Boolean.class, r.get("perms.can_status"), w + "perms.can_status — булево");
            assertInstanceOf(Boolean.class, r.get("perms.can_edit"), w + "perms.can_edit — булево");
            assertInstanceOf(Map.class, r.get("computed"), w + "computed — объект всегда, пусть и пустой");
            Map<String, Object> values = r.getMap("values");
            for (Map.Entry<String, Object> e : values.entrySet())
                assertFalse(e.getValue() instanceof Map, w + "в values объект — " + e.getKey());
        }
    }

    /** Kit 09.11: паспорта решения и вопроса (только чтение) — первыми из восьми типов разделов v2. */
    @Test
    void decisionAndQuestionPassportsAreReadOnly() {
        admin().body("{\"decision_id\":\"D-2026-REC-PASS\",\"title\":\"решение для паспорта\"}").post("/lore/decision").then().statusCode(200);
        JsonPath d = record("decision", "D-2026-REC-PASS");
        assertEquals("decision", d.getString("record.type"));
        assertEquals("решение для паспорта", d.getString("values.title"));
        assertFalse(d.getBoolean("perms.can_edit"), "только чтение — правка не обещается");
        assertEquals(List.of(), d.getList("perms.status_next"));

        admin().body("{\"question_id\":\"Q-REC-PASS\",\"title\":\"вопрос для паспорта\",\"status\":\"open\"}").post("/lore/question").then().statusCode(200);
        JsonPath q = record("question", "Q-REC-PASS");
        assertEquals("question", q.getString("record.type"));
        assertEquals("open", q.getString("values.status"));
        assertFalse(q.getBoolean("perms.can_edit"));
        admin().get("/lore/record/question/Q-NO-SUCH").then().statusCode(404);
    }

    /** Общий минимум контракта lore.record/1 для паспорта только-для-чтения. */
    private JsonPath readOnlyContract(String type, String id) {
        JsonPath r = record(type, id);
        String w = type + ": ";
        assertEquals("lore.record/1", r.getString("contract"), w + "контракт");
        assertEquals(type, r.getString("record.type"), w + "тип");
        assertEquals(id, r.getString("record.id"), w + "деловой ключ, не @rid");
        assertNull(r.get("record.version"), w + "истории SCD2 нет — версии нет");
        assertFalse(r.getBoolean("perms.can_edit"), w + "только чтение — правка не обещается");
        assertFalse(r.getBoolean("perms.can_status"), w + "смена статуса не обещается");
        assertEquals(List.of(), r.getList("perms.status_next"), w);
        assertEquals(type, r.getString("schema.type"), w + "раскладка из реестра");
        assertInstanceOf(Map.class, r.get("computed"), w + "computed — объект всегда");
        Map<String, Object> values = r.getMap("values");
        for (Map.Entry<String, Object> e : values.entrySet())
            assertFalse(e.getValue() instanceof Map, w + "в values объект — " + e.getKey());
        return r;
    }

    /** S4-V2-SECTIONS: паспорт вехи — контракт lore.record/1 на живой БД. */
    @Test
    void milestonePassportContract() {
        admin().body(Map.of("milestone_id", "M-REC-PASS", "label", "веха для паспорта", "goal_md", "цель"))
            .post("/lore/milestone").then().statusCode(200);
        JsonPath m = readOnlyContract("milestone", "M-REC-PASS");
        assertEquals("веха для паспорта", m.getString("values.title"));
        assertEquals("цель", m.getString("values.goal_md"));
        assertEquals(0, m.getInt("computed.sprints_total.value"));
        admin().get("/lore/record/milestone/M-NO-SUCH").then().statusCode(404);
    }

    /** Чип шапки: {id, label, inherited_from: null | {type, id}}. */
    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> chips(JsonPath r, String key) {
        Object v = r.get("values." + key);
        assertInstanceOf(List.class, v, "values." + key + " — список чипов у каждого типа: " + v);
        List<Map<String, Object>> l = (List<Map<String, Object>>) v;
        for (Map<String, Object> c : l) {
            assertTrue(c.containsKey("id") && c.containsKey("label") && c.containsKey("inherited_from"),
                "форма чипа {id, label, inherited_from}: " + c);
        }
        return l;
    }

    private static Map<String, Object> chip(List<Map<String, Object>> l, String id) {
        return l.stream().filter(c -> id.equals(c.get("id"))).findFirst()
            .orElseThrow(() -> new AssertionError("чипа " + id + " нет: " + l));
    }

    /**
     * Решения владелицы 50а, 51а, 55а (D-2026-UXR-OWNER-DELEGATED-ANSWERS-10-11): компоненты и
     * проекты — чипами в шапке паспорта; унаследованные — с пометкой источника (задача — от
     * спринта, сценарий — от фичи); свои — первыми. Было: у задачи нет проектов, у вехи и
     * компонента нет ни того ни другого, наследования нет нигде.
     */
    @Test
    void headChips_ownFirst_thenInheritedWithSource() {
        final String gp = "test/rec-chips";
        final String sid = "SPRINT_REC_CHIPS";
        // Проект заводит только superadmin (admin → 403).
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body(Map.of("slug", gp, "name", "Проект чипов")).post("/lore/project").then().statusCode(200);
        admin().body(Map.of("component_id", "C-CHIP-SPRINT", "full_name", "Компонент спринта", "area", "core"))
            .post("/lore/component/create").then().statusCode(200);
        admin().body(Map.of("component_id", "C-CHIP-OWN", "full_name", "Свой компонент", "area", "core"))
            .post("/lore/component/create").then().statusCode(200);
        sprint(sid);
        admin().body(Map.of("sprint_id", sid, "git_project", gp)).post("/lore/sprint/project").then().statusCode(200);
        admin().body(Map.of("sprint_id", sid, "component_id", "C-CHIP-SPRINT")).post("/lore/sprint/component").then().statusCode(200);
        task(sid, "T-1");
        admin().body(Map.of("task_uid", sid + "/T-1", "component_id", "C-CHIP-OWN")).post("/lore/task/component")
            .then().statusCode(200);

        JsonPath t = record("task", sid + "/T-1");
        List<Map<String, Object>> tp = chips(t, "projects");
        Map<String, Object> p = chip(tp, gp);
        assertEquals("Проект чипов", p.get("label"));
        assertEquals(Map.of("type", "sprint", "id", sid), p.get("inherited_from"), "проект задачи — от спринта");
        List<Map<String, Object>> tc = chips(t, "components");
        assertEquals(List.of("C-CHIP-OWN", "C-CHIP-SPRINT"), tc.stream().map(c -> c.get("id")).toList(), "свои — первыми");
        assertNull(tc.get(0).get("inherited_from"), "свой компонент — без источника");
        assertEquals("Свой компонент", tc.get(0).get("label"));
        assertEquals(Map.of("type", "sprint", "id", sid), tc.get(1).get("inherited_from"));

        JsonPath s = record("sprint", sid);
        assertNull(chip(chips(s, "projects"), gp).get("inherited_from"), "у спринта проект свой");

        // Сценарий — от фичи.
        admin().body(Map.of("feature_id", "UC-CHIP-ROOT", "title", "корень чипов", "goal_level", "kite"))
            .post("/lore/feature").then().statusCode(200);
        admin().body(Map.of("uc_id", "UC-CHIP-ROOT", "rel", "project", "target_id", gp)).post("/lore/uc/link")
            .then().statusCode(200);
        admin().body(Map.of("uc_id", "UC-CHIP-CHILD", "title", "сценарий чипов", "parent_uc_id", "UC-CHIP-ROOT",
            "goal_level", "sea-level")).post("/lore/uc").then().statusCode(200);
        JsonPath f = record("feature", "UC-CHIP-CHILD");
        assertEquals(Map.of("type", "feature", "id", "UC-CHIP-ROOT"), chip(chips(f, "projects"), gp).get("inherited_from"),
            "проект сценария — от фичи");

        // Веха и компонент: ключи есть всегда (пустой список — «проверено, нет»).
        admin().body(Map.of("milestone_id", "M-REC-CHIPS", "label", "веха чипов")).post("/lore/milestone").then().statusCode(200);
        JsonPath m = record("milestone", "M-REC-CHIPS");
        chips(m, "projects");
        chips(m, "components");
        JsonPath c = record("component", "C-CHIP-SPRINT");
        assertEquals(Map.of("type", "sprint", "id", sid), chip(chips(c, "projects"), gp).get("inherited_from"),
            "проект компонента — от его спринтов");
        chips(c, "components");
    }

    /**
     * S4-29: вкладки «Задачи» и «Спринты» паспорта компонента — по рёбрам, постранично.
     * Спринт, чьё имя содержит ключ компонента, но ребра нет, — НЕ спринт компонента
     * (раньше подбор по имени его подтягивал).
     */
    @Test
    void componentTasksAndSprints_byEdge_paged() {
        final String cid = "CPAGE";
        admin().body(Map.of("component_id", cid, "full_name", "компонент страниц", "area", "core"))
            .post("/lore/component/create").then().statusCode(200);
        final String linked = "SPRINT_CPAGE_LINKED";
        final String byName = "SPRINT_CPAGE_NAME_ONLY";
        sprint(linked);
        sprint(byName);
        admin().body(Map.of("sprint_id", linked, "component_id", cid)).post("/lore/sprint/component").then().statusCode(200);
        task(linked, "T-1");
        task(linked, "T-2");
        task(byName, "T-3");
        for (String t : List.of("T-1", "T-2"))
            admin().body(Map.of("task_uid", linked + "/" + t, "component_id", cid)).post("/lore/task/component")
                .then().statusCode(200);

        JsonPath tp = admin().queryParam("cid", cid).queryParam("limit", 1).get("/lore/slice/component_tasks")
            .then().statusCode(200).extract().jsonPath();
        assertEquals(1, tp.getList("rows").size(), "страница из одной строки");
        assertEquals(2, tp.getInt("page.total"), "total — все задачи компонента, а не страница");
        assertTrue(tp.getBoolean("page.has_more"));

        List<String> sprints = admin().queryParam("cid", cid).get("/lore/slice/component_sprints")
            .then().statusCode(200).extract().jsonPath().getList("rows.sprint_id");
        assertEquals(List.of(linked), sprints, "спринт компонента — по ребру, не по имени");

        JsonPath c = record("component", cid);
        List<Map<String, Object>> links = c.getList("links");
        assertEquals(2, links.stream().filter(l -> "TAGGED_WITH".equals(l.get("rel")) && "task".equals(l.get("type"))).count(),
            "вкладка «Задачи»: " + links);
        assertEquals(List.of(linked), links.stream().filter(l -> "sprint".equals(l.get("type"))).map(l -> l.get("id")).toList(),
            "вкладка «Спринты»: " + links);
        List<Map<String, Object>> ds = c.getList("meta.data_state");
        for (String part : List.of("tasks", "sprints"))
            assertTrue(ds.stream().anyMatch(e -> part.equals(e.get("part")) && "ok".equals(e.get("state"))),
                part + " прочитана и названа в data_state: " + ds);
    }

    /**
     * S4-29, решение 53а: паспорт проекта — контракт lore.record/1 на живой БД. Вкладки Спринты ·
     * Компоненты (через спринты) · ADR · Релизы · Люди и агенты читаются срезами project_*; каждая
     * названа в data_state, срез вкладки — постранично с честным total.
     */
    @Test
    void projectPassportContract() {
        final String gp = "test/rec-project";
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body(Map.of("slug", gp, "name", "Проект паспорта")).post("/lore/project").then().statusCode(200);
        admin().body(Map.of("component_id", "C-REC-PROJECT", "full_name", "Компонент проекта", "area", "core"))
            .post("/lore/component/create").then().statusCode(200);
        for (String sid : List.of("SPRINT_REC_PROJECT_A", "SPRINT_REC_PROJECT_B")) {
            sprint(sid);
            admin().body(Map.of("sprint_id", sid, "git_project", gp)).post("/lore/sprint/project").then().statusCode(200);
        }
        admin().body(Map.of("sprint_id", "SPRINT_REC_PROJECT_A", "component_id", "C-REC-PROJECT"))
            .post("/lore/sprint/component").then().statusCode(200);

        JsonPath p = readOnlyContract("project", gp);
        assertEquals("Проект паспорта", p.getString("values.title"));
        assertEquals(gp, p.getString("values.code"));
        List<Map<String, Object>> links = p.getList("links");
        assertEquals(List.of("SPRINT_REC_PROJECT_B", "SPRINT_REC_PROJECT_A"),
            links.stream().filter(l -> "sprint".equals(l.get("type"))).map(l -> l.get("id")).toList(),
            "вкладка «Спринты» — по ребру BELONGS_TO_PROJECT, свежие сверху: " + links);
        assertEquals(List.of("C-REC-PROJECT"),
            links.stream().filter(l -> "component".equals(l.get("type"))).map(l -> l.get("id")).toList(),
            "вкладка «Компоненты» — через спринты проекта: " + links);
        List<Map<String, Object>> ds = p.getList("meta.data_state");
        for (String part : List.of("sprints", "components", "adrs", "releases", "people", "agents"))
            assertTrue(ds.stream().anyMatch(e -> part.equals(e.get("part")) && "ok".equals(e.get("state"))),
                part + " прочитана и названа в data_state: " + ds);

        JsonPath page = admin().queryParam("project", gp).queryParam("limit", 1).get("/lore/slice/project_sprints")
            .then().statusCode(200).extract().jsonPath();
        assertEquals(1, page.getList("rows").size(), "страница из одной строки");
        assertEquals(2, page.getInt("page.total"), "total — все спринты проекта, а не страница");
        assertTrue(page.getBoolean("page.has_more"));

        admin().get("/lore/record/project/test/no-such-project").then().statusCode(404);
    }

    /** S4-V2-SECTIONS: паспорта компонента, технологии и фичи (только чтение). */
    @Test
    void componentTechFeaturePassportsAreReadOnly() {
        admin().body(Map.of("component_id", "C-REC-PASS", "full_name", "компонент для паспорта", "area", "core",
            "owner", "arharaga")).post("/lore/component/create").then().statusCode(200);
        JsonPath c = readOnlyContract("component", "C-REC-PASS");
        assertEquals("компонент для паспорта", c.getString("values.title"));
        assertEquals("core", c.getString("values.area"));
        admin().get("/lore/record/component/C-NO-SUCH").then().statusCode(404);

        admin().body(Map.of("spec_id", "SPEC-TECH-C-REC-PASS-QUARKUS", "title", "Quarkus", "version", "3.15.1",
            "content_md", "- license: Apache-2.0")).post("/lore/spec").then().statusCode(200);
        JsonPath t = readOnlyContract("tech", "SPEC-TECH-C-REC-PASS-QUARKUS");
        assertEquals("Quarkus", t.getString("values.title"));
        assertEquals("3.15.1", t.getString("values.version"));
        admin().body(Map.of("spec_id", "SPEC-REC-NOT-TECH", "title", "обычная спека"))
            .post("/lore/spec").then().statusCode(200);
        admin().get("/lore/record/tech/SPEC-REC-NOT-TECH").then().statusCode(404);   // спека — не технология

        admin().body(Map.of("feature_id", "FEAT-REC-PASS", "title", "фича для паспорта"))
            .post("/lore/feature").then().statusCode(200);
        admin().body(Map.of("uc_id", "UC-REC-PASS-1", "title", "сценарий фичи", "parent_uc_id", "FEAT-REC-PASS",
            "goal_level", "sea-level")).post("/lore/uc").then().statusCode(200);
        JsonPath f = readOnlyContract("feature", "FEAT-REC-PASS");
        assertEquals("фича для паспорта", f.getString("values.title"));
        // Паспорт фичи открывает и сценарий любого уровня — US разделом тоже щёлкаются.
        JsonPath u = readOnlyContract("feature", "UC-REC-PASS-1");
        assertEquals("sea-level", u.getString("values.goal_level"));
        assertEquals("FEAT-REC-PASS", u.getString("values.parent"));
    }

    /** S4-V2-SECTIONS, «US разделом»: срез всех уровней без обязательного параметра. */
    @Test
    void useCasesSliceReturnsEveryLevel() {
        admin().body(Map.of("feature_id", "FEAT-REC-ALL", "title", "корень"))
            .post("/lore/feature").then().statusCode(200);
        admin().body(Map.of("uc_id", "UC-REC-ALL-1", "title", "лист", "parent_uc_id", "FEAT-REC-ALL",
            "goal_level", "subfunction")).post("/lore/uc").then().statusCode(200);
        List<String> ids = admin().get("/lore/slice/use_cases").then().statusCode(200).extract().jsonPath()
            .getList("rows.uc_id", String.class);
        assertTrue(ids.contains("FEAT-REC-ALL"), "корень в выдаче: " + ids);
        assertTrue(ids.contains("UC-REC-ALL-1"), "сценарий уровня subfunction в выдаче: " + ids);
        List<String> leaves = admin().get("/lore/slice/use_cases?goal_level=subfunction").then().statusCode(200)
            .extract().jsonPath().getList("rows.uc_id", String.class);
        assertTrue(leaves.contains("UC-REC-ALL-1") && !leaves.contains("FEAT-REC-ALL"), leaves.toString());
    }

    /**
     * S4-V2-SECTIONS, просьба kit: прогресс «сценариев x/y» (uc_shipped рядом с uc_total),
     * веха корня (milestone_id) и НАСЛЕДУЕМЫЕ от корня компонент/проект у детей.
     * Замер kit по проду: у 5 из 5 детей FEAT-LORE-HONEST component_ids и projects пусты.
     * Живая БД нужна ещё и ради разбора: фильтр-проекция [status='shipped'].size()
     * в списке полей должна пройти парсер ArcadeDB.
     */
    @Test
    void useCasesSliceCarriesProgressMilestoneAndInherited() {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body(Map.of("slug", "acme/uc-cols", "name", "Продукт колонок")).post("/lore/project")
            .then().statusCode(200);
        admin().body(Map.of("component_id", "C-UC-COLS", "full_name", "компонент колонок", "area", "core"))
            .post("/lore/component/create").then().statusCode(200);
        admin().body(Map.of("milestone_id", "M-UC-COLS", "label", "веха колонок"))
            .post("/lore/milestone").then().statusCode(200);
        admin().body(Map.of("feature_id", "FEAT-UC-COLS", "title", "корень колонок"))
            .post("/lore/feature").then().statusCode(200);
        admin().body(Map.of("feature_id", "FEAT-UC-COLS", "rel", "milestone", "target_id", "M-UC-COLS"))
            .post("/lore/feature/link").then().statusCode(200);
        admin().body(Map.of("feature_id", "FEAT-UC-COLS", "rel", "component", "target_id", "C-UC-COLS"))
            .post("/lore/feature/link").then().statusCode(200);
        admin().body(Map.of("uc_id", "FEAT-UC-COLS", "rel", "project", "target_id", "acme/uc-cols"))
            .post("/lore/uc/link").then().statusCode(200);
        for (String uc : new String[]{"UC-UC-COLS-1", "UC-UC-COLS-2"})
            admin().body(Map.of("uc_id", uc, "title", "сценарий " + uc, "parent_uc_id", "FEAT-UC-COLS",
                "goal_level", "sea-level")).post("/lore/uc").then().statusCode(200);
        // Один из двух выпущен — тем же путём, что в жизни: задача done → вычислитель D17 → shipped.
        final String sid = "SPRINT_UC_COLS";
        sprint(sid);
        admin().body(Map.of("sprint_id", sid, "task_id", "UCC-1", "title", "доставка", "work_class", "uc",
            "uc_id", "UC-UC-COLS-1", "executor_agent", "claude-full", "reviewer_agent", "architect"))
            .post("/lore/task").then().statusCode(200);
        for (String st : new String[]{"active", "done"})
            admin().body(Map.of("entity_type", "task", "id", sid + "/UCC-1", "status", st))
                .post("/lore/status").then().statusCode(200);

        JsonPath j = admin().get("/lore/slice/use_cases").then().statusCode(200).extract().jsonPath();
        Map<String, Object> root = j.getMap("rows.find { it.uc_id == 'FEAT-UC-COLS' }");
        assertNotNull(root, "корень в выдаче");
        assertEquals(2, ((Number) root.get("uc_total")).intValue(), root.toString());
        assertEquals(1, ((Number) root.get("uc_shipped")).intValue(), "выпущен один из двух: " + root);
        assertEquals("M-UC-COLS", root.get("milestone_id"), root.toString());
        Map<String, Object> child = j.getMap("rows.find { it.uc_id == 'UC-UC-COLS-2' }");
        assertNotNull(child, "сценарий в выдаче");
        assertEquals(List.of("C-UC-COLS"), child.get("inherited_component_ids"), child.toString());
        assertEquals(List.of("acme/uc-cols"), child.get("inherited_projects"), child.toString());
        assertEquals(0, ((Number) child.get("uc_shipped")).intValue(), "у листа детей нет: " + child);
    }
}
