package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.path.json.JsonPath;
import io.restassured.response.Response;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-05 — тесты паритета SPEC-LORE-GRAPH-SEARCH §12.4 на живой ArcadeDB: пять запросов
 * приёмки одним вызовом {@code POST /lore/find} совпадают со срезами на тех же данных (HTTP, полный путь: скоуп,
 * переходник схемы, ключи проекта). Логика find — в {@link LoreFindEmbeddedTest} на встроенном движке; здесь — то,
 * чего без настоящего сервера не проверить: что срез и find видят ОДНИ И ТЕ ЖЕ строки.
 *
 * <p>Плюс заметка 21.11 (один параметр проекта): {@code adrs?project=} — сужение, а не 400; прежнее
 * {@code scope_projects} — с {@code _warning}; реестр {@code GET /lore/slices} объявляет project у adrs.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreFindParityLiveDbTest {

    private static final String P = "LORE_TEST_ORG/gc05-find";
    private static final String P_OTHER = "LORE_TEST_ORG/gc05-find-other";
    private static final String COMP = "GC05-FIND-COMP";
    private static final String S_OPEN = "SPRINT_GC05_FIND_OPEN";
    private static final String S_DONE = "SPRINT_GC05_FIND_DONE";
    private static final String S_OTHER = "SPRINT_GC05_FIND_OTHER";
    private static final String ADR = "ADR-GC05-FIND";
    private static final String ADR_OTHER = "ADR-GC05-FIND-OTHER";
    private static final String REPO = "https://git.example.test/lore-test-org/gc05-find";

    private static final List<String> CLOSED = List.of("finished", "withdrawn");

    private static void post(String role, String path, String body) {
        given().header("X-Seer-Role", role).contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    private static void admin(String path, String body) { post("admin", path, body); }

    private static void task(String sprint, String code, String title, String status, boolean tagged) {
        admin("/lore/task", "{\"sprint_id\":\"" + sprint + "\",\"task_id\":\"" + code + "\",\"title\":\"" + title
            + "\",\"work_class\":\"enb\"}");
        if (status != null)
            admin("/lore/status", "{\"entity_type\":\"task\",\"id\":\"" + sprint + "/" + code + "\",\"status\":\"" + status + "\"}");
        if (tagged)
            admin("/lore/task/component", "{\"task_uid\":\"" + sprint + "/" + code + "\",\"component_id\":\"" + COMP + "\"}");
    }

    @Test
    @Order(1)
    void setUp() {
        for (String slug : List.of(P, P_OTHER)) post("superadmin", "/lore/project", "{\"slug\":\"" + slug + "\"}");
        admin("/lore/component/create", "{\"component_id\":\"" + COMP + "\",\"full_name\":\"GC-05 find parity\"}");
        admin("/lore/sprint/create", "{\"sprint_id\":\"" + S_OPEN + "\",\"name\":\"open\",\"git_project\":\"" + P + "\"}");
        admin("/lore/status", "{\"entity_type\":\"sprint\",\"id\":\"" + S_OPEN + "\",\"status\":\"active\"}");
        admin("/lore/sprint/create", "{\"sprint_id\":\"" + S_DONE + "\",\"name\":\"done\",\"git_project\":\"" + P + "\"}");
        admin("/lore/status", "{\"entity_type\":\"sprint\",\"id\":\"" + S_DONE + "\",\"status\":\"cancelled\"}");
        admin("/lore/sprint/create", "{\"sprint_id\":\"" + S_OTHER + "\",\"name\":\"other\",\"git_project\":\"" + P_OTHER + "\"}");
        admin("/lore/status", "{\"entity_type\":\"sprint\",\"id\":\"" + S_OTHER + "\",\"status\":\"active\"}");
        // Ребро проекта — явной дверью (как NewsDynamicsLiveDbTest), не полагаясь на git_project при создании.
        for (String[] sp : new String[][]{{S_OPEN, P}, {S_DONE, P}, {S_OTHER, P_OTHER}})
            admin("/lore/sprint/project", "{\"sprint_id\":\"" + sp[0] + "\",\"git_project\":\"" + sp[1] + "\"}");

        task(S_OPEN, "F-1", "gc05live граф поиск", "active", true);
        task(S_OPEN, "F-2", "gc05live граф путь", "cancelled", true);
        task(S_OPEN, "F-3", "gc05live отчёт", null, false);
        task(S_OPEN, "F-4", "gc05live граф find", "active", false);
        task(S_DONE, "D-1", "gc05live старое", "cancelled", true);
        task(S_OTHER, "O-1", "gc05live граф чужой", "active", true);

        admin("/lore/adr", "{\"adr_id\":\"" + ADR + "\",\"name\":\"gc05 find\",\"status\":\"ACCEPTED\"}");
        admin("/lore/adr/project", "{\"adr_id\":\"" + ADR + "\",\"project\":\"" + P + "\",\"action\":\"add\"}");
        admin("/lore/adr", "{\"adr_id\":\"" + ADR_OTHER + "\",\"name\":\"gc05 other\",\"status\":\"ACCEPTED\"}");
        admin("/lore/adr/project", "{\"adr_id\":\"" + ADR_OTHER + "\",\"project\":\"" + P_OTHER + "\",\"action\":\"add\"}");
    }

    private static JsonPath find(String body) {
        return given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post("/lore/find").then().statusCode(200).extract().jsonPath();
    }

    private static Set<String> ids(JsonPath jp) {
        return new TreeSet<>(jp.getList("rows.id", String.class));
    }

    private static JsonPath slice(String id, Map<String, String> params) {
        return given().header("X-Seer-Role", "admin").queryParams(params).queryParam("limit", "1000")
            .when().get("/lore/slice/" + id).then().statusCode(200).extract().jsonPath();
    }

    private static Set<String> sliceKeys(String id, Map<String, String> params, String key) {
        return new TreeSet<>(slice(id, params).getList("rows." + key, String.class));
    }

    private static final String OPEN = "{\"field\":\"status_category\",\"op\":\"!=\",\"value\":[\"finished\",\"withdrawn\"]}";

    /** Приёмка 2: все открытые задачи проекта = open_tasks?project=. */
    @Test
    @Order(2)
    void openTasksOfProject() {
        JsonPath jp = find("{\"type\":\"task\",\"where\":[" + OPEN + "],\"project\":\"" + P + "\"}");
        assertEquals(Set.of(S_OPEN + "/F-1", S_OPEN + "/F-3", S_OPEN + "/F-4"), ids(jp), jp.prettify());
        assertEquals(sliceKeys("open_tasks", Map.of("project", P), "task_uid"), ids(jp), "паритет с open_tasks?project=");
        // links_to project — тот же ответ.
        assertEquals(ids(jp), ids(find("{\"type\":\"task\",\"where\":[" + OPEN + "],\"links_to\":{\"id\":\"project:" + P + "\"}}")));
    }

    /** Приёмка 3: открытые спринты проекта = sprints?project=, отфильтрованные по категории статуса. */
    @Test
    @Order(3)
    void openSprintsOfProject() {
        JsonPath jp = find("{\"type\":\"sprint\",\"where\":[" + OPEN + "],\"project\":\"" + P + "\"}");
        assertEquals(Set.of(S_OPEN), ids(jp), jp.prettify());
        List<Map<String, Object>> rows = slice("sprints", Map.of("project", P)).getList("rows");
        Set<String> open = new TreeSet<>();
        for (Map<String, Object> r : rows)
            if (!CLOSED.contains(String.valueOf(LoreStatusCategory.of("sprint", r.get("status_raw")))))
                open.add(String.valueOf(r.get("sprint_id")));
        assertEquals(open, ids(jp), "паритет с sprints?project=");
    }

    /** Приёмка 4: задачи по компоненту = component_tasks?cid=. */
    @Test
    @Order(4)
    void tasksOfComponent() {
        JsonPath jp = find("{\"type\":\"task\",\"links_to\":{\"id\":\"component:" + COMP + "\",\"rels\":[\"TAGGED_WITH\"]}}");
        assertEquals(Set.of(S_OPEN + "/F-1", S_OPEN + "/F-2", S_DONE + "/D-1", S_OTHER + "/O-1"), ids(jp), jp.prettify());
        assertEquals(sliceKeys("component_tasks", Map.of("cid", COMP), "task_uid"), ids(jp), "паритет с component_tasks?cid=");
    }

    /**
     * Приёмка 5: задачи по репозиторию — через компонент (COMPONENT_REPOSITORY) и проект (HAS_REPOSITORY).
     * Репозиторий как запись есть только в схеме 1.18: на старой схеме дверь отвечает отказом — тогда проверять нечего
     * (assumption, а не зелёный «прошёл»).
     */
    @Test
    @Order(5)
    void tasksOfRepository() {
        Response created = given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"url\":\"" + REPO + "\"}").when().post("/lore/repository");
        Assumptions.assumeTrue(created.statusCode() == 200,
            "KnowRepository нет в схеме тестовой базы (старая схема) — приёмка 5 покрыта LoreFindEmbeddedTest");
        admin("/lore/repository/link", "{\"url\":\"" + REPO + "\",\"rel\":\"component\",\"target\":\"" + COMP + "\"}");
        JsonPath viaComponent = find("{\"type\":\"task\",\"links_to\":{\"id\":\"repository:" + REPO + "\"}}");
        assertEquals(sliceKeys("component_tasks", Map.of("cid", COMP), "task_uid"), ids(viaComponent),
            "задачи репозитория компонента = задачи компонента");
        admin("/lore/repository/link", "{\"url\":\"" + REPO + "\",\"rel\":\"project\",\"target\":\"" + P_OTHER + "\"}");
        JsonPath both = find("{\"type\":\"task\",\"links_to\":{\"id\":\"repository:" + REPO + "\"}}");
        assertTrue(ids(both).containsAll(ids(viaComponent)), both.prettify());
        assertTrue(ids(both).contains(S_OTHER + "/O-1"));
    }

    /** Приёмка 1: поиск с мультифильтром (текст + статус + проект + компонент) одним вызовом = срез + те же условия. */
    @Test
    @Order(6)
    void searchWithMultiFilter() {
        JsonPath jp = find("{\"type\":\"task\",\"search\":\"GC05LIVE граф\",\"project\":\"" + P + "\",\"where\":["
            + "{\"field\":\"status_category\",\"op\":\"=\",\"value\":[\"in_progress\"]},"
            + "{\"field\":\"component\",\"op\":\"=\",\"value\":[\"" + COMP + "\"]}]}");
        assertEquals(Set.of(S_OPEN + "/F-1"), ids(jp), jp.prettify());
        // Паритет: open_tasks проекта и компонента, отфильтрованные по тексту и категории на клиенте.
        Set<String> expected = new TreeSet<>();
        for (Map<String, Object> r : slice("open_tasks", Map.of("project", P, "component", COMP)).<Map<String, Object>>getList("rows")) {
            String title = String.valueOf(r.get("title")).toLowerCase();
            if (title.contains("gc05live") && title.contains("граф")
                    && "in_progress".equals(LoreStatusCategory.of("task", r.get("status_raw"))))
                expected.add(String.valueOf(r.get("task_uid")));
        }
        assertEquals(expected, ids(jp));
        assertEquals("substring", jp.getString("meta.search.mode"));
    }

    /** Заметка 21.11: adrs?project= — сужение по проекту, а не 400 «unknown param: project». */
    @Test
    @Order(7)
    void adrsTakeProjectParam() {
        JsonPath jp = slice("adrs", Map.of("project", P));
        List<String> adrs = jp.getList("rows.adr_id", String.class);
        assertTrue(adrs.contains(ADR), jp.prettify());
        assertTrue(!adrs.contains(ADR_OTHER), "чужой проект не сужен: " + adrs);
        assertNull(jp.get("_warning"), "каноническое имя — без предупреждения");
    }

    /** Прежнее имя scope_projects работает так же и говорит, что оно прежнее. */
    @Test
    @Order(8)
    void legacyScopeProjectsCarriesWarning() {
        JsonPath jp = slice("adrs", Map.of("scope_projects", P));
        List<String> adrs = jp.getList("rows.adr_id", String.class);
        assertTrue(adrs.contains(ADR) && !adrs.contains(ADR_OTHER), jp.prettify());
        String warning = jp.getString("_warning");
        assertNotNull(warning);
        assertTrue(warning.contains("scope_projects"), warning);
        JsonPath f = find("{\"type\":\"adr\",\"scope_projects\":[\"" + P + "\"]}");
        assertEquals(Set.of(ADR), ids(f));
        assertNotNull(f.getString("_warning"));
    }

    /** Реестр срезов объявляет project у adrs — MCP выводит из него подстановку проекта (ADR-LORE-017). */
    @Test
    @Order(9)
    void catalogDeclaresProjectForAdrs() {
        JsonPath jp = given().when().get("/lore/slices").then().statusCode(200).extract().jsonPath();
        List<String> optional = jp.getList("slices.find { it.id == 'adrs' }.optional", String.class);
        assertTrue(optional.contains("project"), String.valueOf(optional));
    }
}
