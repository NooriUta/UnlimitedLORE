package studio.seer.heimdall.lore;

import com.arcadedb.database.Database;
import com.arcadedb.database.DatabaseFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-05 — {@code find} «тип + поля + связь» (SPEC-LORE-GRAPH-SEARCH §6) и путь
 * (§7) на настоящей ArcadeDB (встроенный движок, без сервера и без Quarkus).
 *
 * <p>Пять запросов приёмки из заметки задачи — каждый отдельным тестом; где есть срез, ответ сверяется
 * со срезом на той же базе (тест паритета, SPEC §12.4): тот же набор ключей.
 */
class LoreFindEmbeddedTest {

    private static final Instant NOW = Instant.parse("2026-11-20T12:00:00Z");

    private Path dir;
    private DatabaseFactory factory;
    private Database db;
    private LoreGraphResource.DbSource.Sql sql;

    @BeforeEach
    void open() throws Exception {
        dir = Files.createTempDirectory("lore-find-");
        factory = new DatabaseFactory(dir.resolve("db").toString());
        db = factory.create();
        for (String t : List.of("KnowTask", "KnowTaskHist", "KnowSprint", "KnowSprintHist", "KnowGitProject", "LoreComponent",
                "KnowRepository", "KnowADR", "KnowSpec", "KnowSpecHist", "KnowDecision", "KnowQuestion", "KnowMilestone",
                "KnowRelease", "KnowUseCase", "KnowActor", "KnowUser", "KnowPhase", "KnowPR", "KnowTag", "KnowProduct"))
            db.command("sql", "CREATE VERTEX TYPE " + t);
        for (String e : List.of("HAS_STATE", "PART_OF", "BELONGS_TO_PROJECT", "BELONGS_TO", "TAGGED_WITH",
                "COMPONENT_REPOSITORY", "HAS_REPOSITORY", "IN_PRODUCT", "CLOSED_BY", "SHIPPED_IN", "IN_PHASE",
                "DEPENDS_ON", "JUSTIFIED_BY", "ROLE_HELD_BY", "DECIDED_IN", "DOCUMENTED_IN", "IMPLEMENTED_IN_RELEASE",
                "TARGETS_MILESTONE", "REALIZES", "RAISED_IN", "GATES"))
            db.command("sql", "CREATE EDGE TYPE " + e);
        db.transaction(() -> {
            // GC-05 (21.11): ключ проекта — короткий код; прежнее «владелец/репо» — в aliases.
            cmd("INSERT INTO KnowGitProject SET slug = 'o/p1', name = 'P1', short_code = 'P1'");
            cmd("INSERT INTO KnowGitProject SET slug = 'o/p2', name = 'P2', short_code = 'P2', aliases = ['old/p2']");
            cmd("INSERT INTO LoreComponent SET component_id = 'COMP1', full_name = 'Компонент 1'");
            cmd("INSERT INTO LoreComponent SET component_id = 'COMP2', full_name = 'Компонент 2'");
            cmd("INSERT INTO KnowRepository SET url = 'https://git.x/o/c1', full_path = 'o/c1'");
            cmd("INSERT INTO KnowRepository SET url = 'https://git.x/o/p2', full_path = 'o/p2'");
            edge("COMPONENT_REPOSITORY", "LoreComponent", "component_id", "COMP1", "KnowRepository", "url", "https://git.x/o/c1");
            edge("HAS_REPOSITORY", "KnowGitProject", "slug", "o/p2", "KnowRepository", "url", "https://git.x/o/p2");

            sprint("SP_A", "o/p1", "🔄 IN PROGRESS");
            sprint("SP_B", "o/p1", "✅ DONE");
            sprint("SP_C", "o/p2", "🟣 BACKLOG");
            sprint("SP_D", null, "✅ DONE");

            task("SP_A", "A-1", "граф поиск окрестность", "🔄 IN PROGRESS", "COMP1", "2026-11-15T10:00:00Z", 1.0);
            task("SP_A", "A-2", "граф путь", "✅ DONE", "COMP1", "2026-11-16T10:00:00Z", 2.0);
            task("SP_A", "A-3", "отчёт", "🟣 BACKLOG", "COMP2", "2026-10-01T10:00:00Z", null);
            task("SP_A", "A-4", "граф find", "🔄 IN PROGRESS", "COMP2", "2026-11-18T10:00:00Z", 3.0);
            task("SP_B", "B-1", "граф старый", "🚫 CANCELLED", "COMP1", "2026-09-01T10:00:00Z", 1.0);
            task("SP_C", "C-1", "граф чужой", "🔄 IN PROGRESS", "COMP1", "2026-11-17T10:00:00Z", 5.0);
            task("SP_C", "C-2", "в p2", "🟣 BACKLOG", null, "2026-11-01T10:00:00Z", null);
            edge("DEPENDS_ON", "KnowTask", "task_uid", "SP_A/A-4", "KnowTask", "task_uid", "SP_A/A-1");
        });
        sql = (q, p) -> {
            List<Map<String, Object>> out = new ArrayList<>();
            db.query("sql", q, p).stream().forEach(r -> out.add(r.toMap()));
            return out;
        };
    }

    @AfterEach
    void close() {
        if (db != null) db.drop();
        if (factory != null) factory.close();
    }

    private void cmd(String s) {
        db.command("sql", s);
    }

    private void edge(String type, String fc, String ff, String fv, String tc, String tf, String tv) {
        db.command("sql", "CREATE EDGE " + type + " FROM (SELECT FROM " + fc + " WHERE " + ff + " = ?) TO (SELECT FROM "
            + tc + " WHERE " + tf + " = ?)", fv, tv);
    }

    private void sprint(String id, String project, String status) {
        db.command("sql", "INSERT INTO KnowSprint SET sprint_id = ?, title = ?, created_date = '2026-11-01'", id, "Спринт " + id);
        db.command("sql", "INSERT INTO KnowSprintHist SET sprint_id = ?, status_raw = ?, valid_from = '2026-11-01T00:00:00Z'", id, status);
        db.command("sql", "CREATE EDGE HAS_STATE FROM (SELECT FROM KnowSprint WHERE sprint_id = ?) TO "
            + "(SELECT FROM KnowSprintHist WHERE sprint_id = ?)", id, id);
        if (project != null) edge("BELONGS_TO_PROJECT", "KnowSprint", "sprint_id", id, "KnowGitProject", "slug", project);
    }

    private void task(String sprint, String code, String title, String status, String comp, String from, Double effort) {
        String uid = sprint + "/" + code;
        db.command("sql", "INSERT INTO KnowTask SET task_uid = ?, task_id = ?, title = ?, work_class = 'feature'", uid, code, title);
        db.command("sql", "INSERT INTO KnowTaskHist SET task_uid = ?, status_raw = ?, valid_from = ?, effort_days = ?",
            uid, status, from, effort);
        db.command("sql", "CREATE EDGE HAS_STATE FROM (SELECT FROM KnowTask WHERE task_uid = ?) TO "
            + "(SELECT FROM KnowTaskHist WHERE task_uid = ?)", uid, uid);
        edge("PART_OF", "KnowTask", "task_uid", uid, "KnowSprint", "sprint_id", sprint);
        if (comp != null) edge("TAGGED_WITH", "KnowTask", "task_uid", uid, "LoreComponent", "component_id", comp);
    }

    // ── помощники ────────────────────────────────────────────────────────────

    private Map<String, Object> find(Map<String, Object> req) {
        return find(req, null);
    }

    private Map<String, Object> find(Map<String, Object> req, Set<String> allowed) {
        return LoreFind.run(req, sql, allowed, NOW);
    }

    @SuppressWarnings("unchecked")
    private static List<String> ids(Map<String, Object> res) {
        return ((List<Map<String, Object>>) res.get("rows")).stream().map(r -> String.valueOf(r.get("id"))).toList();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> meta(Map<String, Object> res) {
        return (Map<String, Object>) res.get("meta");
    }

    private static Map<String, Object> cond(String field, String op, Object value) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("field", field);
        m.put("op", op);
        if (value != null) m.put("value", value);
        return m;
    }

    private static Map<String, Object> req(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    private Set<String> slice(String name, Map<String, String> params, String key) {
        LoreSlices.Composed c = LoreSlices.compose(name, params);
        Set<String> out = new TreeSet<>();
        for (Map<String, Object> r : sql.queryPublic(c.sql(), c.params())) out.add(String.valueOf(r.get(key)));
        return out;
    }

    private static final List<String> CLOSED = List.of("finished", "withdrawn");

    // ── приёмка 1: поиск с мультифильтром ────────────────────────────────────

    @Test
    void acceptance1_searchWithMultiFilter() {
        // тип + текст + статус + проект + компонент + дата — одним вызовом.
        Map<String, Object> res = find(req("type", "task", "where", List.of(
            cond("title", "contains", "ГРАФ"),
            cond("status_category", "=", List.of("in_progress")),
            cond("project", "=", List.of("o/p1")),
            cond("component", "=", List.of("COMP2")),
            cond("changed_at", ">=", "2026-11-10"))));
        assertEquals(List.of("SP_A/A-4"), ids(res));
        assertEquals(Boolean.TRUE, meta(res).get("complete"));
        // Без компонента — оба открытых «граф» проекта, недавние.
        Map<String, Object> wide = find(req("type", "task", "where", List.of(
            cond("title", "contains", "граф"),
            cond("status_category", "=", List.of("in_progress")),
            cond("project", "=", List.of("o/p1")),
            cond("changed_at", ">=", "2026-11-10"))));
        assertEquals(List.of("SP_A/A-1", "SP_A/A-4"), ids(wide));
    }

    // ── приёмка 2: все открытые задачи проекта = open_tasks?project ─────────

    @Test
    void acceptance2_openTasksOfProject_parityWithOpenTasks() {
        Map<String, Object> res = find(req("type", "task",
            "where", List.of(cond("status_category", "!=", CLOSED)),
            "links_to", req("id", "project:o/p1")));
        assertEquals(List.of("SP_A/A-1", "SP_A/A-3", "SP_A/A-4"), ids(res));
        assertEquals(slice("open_tasks", Map.of("project", "o/p1"), "task_uid"), new TreeSet<>(ids(res)),
            "паритет со срезом open_tasks?project=o/p1");
    }

    // ── приёмка 3: все открытые спринты (+ проект) = sprints ─────────────────

    @Test
    void acceptance3_openSprints_parityWithSprints() {
        Map<String, Object> all = find(req("type", "sprint", "where", List.of(cond("status_category", "!=", CLOSED))));
        assertEquals(List.of("SP_A", "SP_C"), ids(all));
        Map<String, Object> p1 = find(req("type", "sprint", "where", List.of(cond("status_category", "!=", CLOSED)),
            "links_to", req("id", "project:o/p1")));
        assertEquals(List.of("SP_A"), ids(p1));

        // Паритет: срез sprints (с проектом и без), отфильтрованный по той же категории статуса.
        for (Map.Entry<Map<String, String>, List<String>> en : Map.of(
                Map.<String, String>of(), ids(all), Map.<String, String>of("project", "o/p1"), ids(p1)).entrySet()) {
            LoreSlices.Composed c = LoreSlices.compose("sprints", en.getKey());
            Set<String> open = new TreeSet<>();
            for (Map<String, Object> r : sql.queryPublic(c.sql(), c.params()))
                if (!LoreStatusCategory.CLOSED.contains(LoreStatusCategory.of("sprint", r.get("status_raw"))))
                    open.add(String.valueOf(r.get("sprint_id")));
            assertEquals(open, new TreeSet<>(en.getValue()), "паритет со срезом sprints " + en.getKey());
        }
    }

    // ── приёмка 4: задачи по компоненту = component_tasks ────────────────────

    @Test
    void acceptance4_tasksOfComponent_parityWithComponentTasks() {
        Map<String, Object> res = find(req("type", "task",
            "links_to", req("id", "component:COMP1", "rels", List.of("TAGGED_WITH"))));
        assertEquals(List.of("SP_A/A-1", "SP_A/A-2", "SP_B/B-1", "SP_C/C-1"), ids(res));
        assertEquals(slice("component_tasks", Map.of("cid", "COMP1"), "task_uid"), new TreeSet<>(ids(res)),
            "паритет со срезом component_tasks?cid=COMP1");
        // + статус
        Map<String, Object> open = find(req("type", "task",
            "where", List.of(cond("status_category", "!=", CLOSED)),
            "links_to", req("id", "component:COMP1", "rels", List.of("TAGGED_WITH"))));
        assertEquals(List.of("SP_A/A-1", "SP_C/C-1"), ids(open));
    }

    // ── приёмка 5: задачи по репозиторию ─────────────────────────────────────

    @Test
    void acceptance5_tasksOfRepository() {
        // Репозиторий компонента (COMPONENT_REPOSITORY): задачи компонента.
        Map<String, Object> comp = find(req("type", "task", "links_to", req("id", "repository:https://git.x/o/c1")));
        assertEquals(List.of("SP_A/A-1", "SP_A/A-2", "SP_B/B-1", "SP_C/C-1"), ids(comp));
        // Основной репозиторий проекта (HAS_REPOSITORY): задачи проекта.
        Map<String, Object> proj = find(req("type", "task", "links_to", req("id", "repository:https://git.x/o/p2")));
        assertEquals(List.of("SP_C/C-1", "SP_C/C-2"), ids(proj));
    }

    // ── GC-05, 21.11: один параметр проекта и поиск с мультифильтром ─────────

    /** {@code project} у find — тот же фильтр, что links_to project (и что open_tasks?project=), по ключу проекта. */
    @Test
    void projectParamEqualsLinksToProject_byShortCodeAndAlias() {
        Map<String, Object> viaLink = find(req("type", "task", "where", List.of(cond("status_category", "!=", CLOSED)),
            "links_to", req("id", "project:o/p1")));
        Map<String, Object> byCode = find(req("type", "task", "where", List.of(cond("status_category", "!=", CLOSED)),
            "project", "p1"));
        assertEquals(ids(viaLink), ids(byCode));
        assertEquals(slice("open_tasks", Map.of("project", "o/p1"), "task_uid"), new TreeSet<>(ids(byCode)),
            "паритет со срезом open_tasks?project=");
        // Прежнее «владелец/репо» из aliases и список проектов (= любой из них).
        assertEquals(List.of("SP_C/C-1", "SP_C/C-2"), ids(find(req("type", "task", "project", "old/p2"))));
        assertEquals(7, ids(find(req("type", "task", "project", List.of("P1", "P2")))).size());
        // links_to по короткому коду и where по короткому коду — тот же ключ.
        assertEquals(ids(viaLink), ids(find(req("type", "task", "where", List.of(cond("status_category", "!=", CLOSED)),
            "links_to", req("id", "project:P1")))));
        assertEquals(ids(viaLink), ids(find(req("type", "task", "where", List.of(cond("status_category", "!=", CLOSED),
            cond("project", "=", List.of("P1")))))));
        assertNull(find(req("type", "task", "project", "P1")).get("_warning"));
    }

    /** Прежнее имя scope_projects принимается, но ответ говорит, что оно прежнее. */
    @Test
    void legacyScopeProjectsAcceptedWithWarning() {
        Map<String, Object> res = find(req("type", "sprint", "scope_projects", List.of("o/p1")));
        assertEquals(List.of("SP_A", "SP_B"), ids(res));
        assertNotNull(res.get("_warning"));
        assertTrue(String.valueOf(res.get("_warning")).contains("project"));
        // Оба имени — пересечение.
        assertTrue(ids(find(req("type", "sprint", "project", "P2", "scope_projects", "o/p1"))).isEmpty());
    }

    @Test
    void projectParamOutsideScopeIs403_unknownIs404() {
        LoreGraphBuilder.GraphException out = assertThrows(LoreGraphBuilder.GraphException.class,
            () -> find(req("type", "task", "project", "P2"), Set.of("o/p1")));
        assertEquals(403, out.status());
        LoreGraphBuilder.GraphException unknown = assertThrows(LoreGraphBuilder.GraphException.class,
            () -> find(req("type", "task", "project", "NOPE")));
        assertEquals(404, unknown.status());
    }

    /** Приёмка §12.4 «поиск с мультифильтром»: текст + тип + статус + проект + компонент + дата — одним вызовом. */
    @Test
    void searchWithMultiFilterInOneCall() {
        Map<String, Object> res = find(req("type", "task", "search", "ГРАФ",
            "project", "P1",
            "where", List.of(cond("status_category", "=", List.of("in_progress")),
                cond("component", "=", List.of("COMP2")),
                cond("changed_at", ">=", "2026-11-10"))));
        assertEquals(List.of("SP_A/A-4"), ids(res));
        // Несколько слов — все обязаны встретиться (в коде или названии), порядок не важен.
        assertEquals(List.of("SP_A/A-1"), ids(find(req("type", "task", "search", "окрестность граф"))));
        // По коду записи тоже ищется.
        assertEquals(List.of("SP_C/C-2"), ids(find(req("type", "task", "search", "c-2"))));
        @SuppressWarnings("unchecked")
        Map<String, Object> s = (Map<String, Object>) meta(res).get("search");
        assertEquals("substring", s.get("mode"));
        assertThrows(LoreGraphBuilder.GraphException.class, () -> find(req("type", "task", "search", "  ")));
    }

    // ── скоуп: пустое ≠ «нет данных» ─────────────────────────────────────────

    @Test
    void scopeHidesAndCounts() {
        Map<String, Object> res = find(req("type", "task",
            "links_to", req("id", "component:COMP1", "rels", List.of("TAGGED_WITH"))), Set.of("o/p1"));
        assertEquals(List.of("SP_A/A-1", "SP_A/A-2", "SP_B/B-1"), ids(res));
        assertEquals(1, meta(res).get("hidden_by_scope"));
    }

    @Test
    void emptyBecauseOfScopeSaysSo() {
        Map<String, Object> res = find(req("type", "task", "where", List.of(cond("title", "contains", "чужой"))),
            Set.of("o/p1"));
        assertTrue(ids(res).isEmpty());
        assertEquals(1, meta(res).get("hidden_by_scope"));
        assertEquals("hidden_by_scope", meta(res).get("empty_reason"));
        Map<String, Object> none = find(req("type", "task", "where", List.of(cond("title", "contains", "нет такого"))));
        assertEquals("no_match", meta(none).get("empty_reason"));
    }

    @Test
    void linksToProjectOutsideScopeIs403() {
        LoreGraphBuilder.GraphException e = assertThrows(LoreGraphBuilder.GraphException.class,
            () -> find(req("type", "task", "links_to", req("id", "project:o/p2")), Set.of("o/p1")));
        assertEquals(403, e.status());
    }

    @Test
    void emptyScopeIsRefused() {
        LoreGraphBuilder.GraphException e = assertThrows(LoreGraphBuilder.GraphException.class,
            () -> find(req("type", "task"), Set.of()));
        assertEquals("SCOPE_EMPTY", e.code());
    }

    // ── грамматика ───────────────────────────────────────────────────────────

    @Test
    void orAndNot() {
        // (effort > 2 ИЛИ effort не задан) И НЕ статус finished/withdrawn — пример из спеки.
        Map<String, Object> res = find(req("type", "task", "where", List.of(
            Map.of("or", List.of(cond("effort_days", ">", 2), Map.of("not", cond("effort_days", "set", null)))),
            Map.of("not", cond("status_category", "=", CLOSED)))));
        assertEquals(List.of("SP_A/A-3", "SP_A/A-4", "SP_C/C-1", "SP_C/C-2"), ids(res));
    }

    @Test
    void notLinkedFindsSprintWithoutProject() {
        Map<String, Object> res = find(req("type", "sprint", "not_linked", req("rels", List.of("BELONGS_TO_PROJECT"))));
        assertEquals(List.of("SP_D"), ids(res));
    }

    @Test
    void linksToRecordByRelAndDepth() {
        // Кто зависит от A-1 (вход DEPENDS_ON): A-4.
        Map<String, Object> res = find(req("type", "task",
            "links_to", req("id", "task:SP_A/A-1", "rels", List.of("DEPENDS_ON"), "dir", "out")));
        assertEquals(List.of("SP_A/A-4"), ids(res));
        // Задачи проекта на глубине 2 по явным рёбрам: задача → спринт → проект.
        Map<String, Object> d2 = find(req("type", "task",
            "links_to", req("id", "project:o/p2", "rels", List.of("PART_OF", "BELONGS_TO_PROJECT"), "depth", 2, "dir", "out")));
        assertEquals(List.of("SP_C/C-1", "SP_C/C-2"), ids(d2));
    }

    @Test
    void idInSortFieldsAndLimit() {
        Map<String, Object> res = find(req("type", "task",
            "id_in", List.of("SP_A/A-1", "SP_A/A-4", "SP_C/C-1", "x' OR 1=1 --"),
            "sort", List.of(Map.of("field", "effort_days", "dir", "desc")),
            "fields", List.of("effort_days", "sprint_id"),
            "limit", 2));
        assertEquals(List.of("SP_C/C-1", "SP_A/A-4"), ids(res));
        @SuppressWarnings("unchecked")
        Map<String, Object> first = ((List<Map<String, Object>>) res.get("rows")).get(0);
        assertEquals("SP_C", first.get("sprint_id"));
        assertNotNull(first.get("title"));
        assertEquals(Boolean.TRUE, meta(res).get("truncated"));
        assertEquals(2, meta(res).get("capped_at"));
        assertEquals(Boolean.FALSE, meta(res).get("complete"));
        assertEquals(3, meta(res).get("total"));
    }

    @Test
    void changedWithinDays() {
        // NOW − 5 дней = 2026-11-15T12:00Z: A-1 (15-го в 10:00) уже за чертой.
        Map<String, Object> res = find(req("type", "task", "changed_within_days", 5));
        assertEquals(List.of("SP_A/A-2", "SP_A/A-4", "SP_C/C-1"), ids(res));
    }

    @Test
    void valuesAreBoundNotSpliced() {
        Map<String, Object> a = find(req("type", "task", "id_in", List.of("SP_A/A-1")));
        Map<String, Object> b = find(req("type", "task", "id_in", List.of("x' OR '1'='1")));
        assertEquals(meta(a).get("sql_hash"), meta(b).get("sql_hash"), "значение не попадает в текст SQL");
        assertTrue(ids(b).isEmpty());
    }

    @Test
    void unknownFieldOpTypeAndCapsAre400() {
        LoreGraphBuilder.GraphException f = assertThrows(LoreGraphBuilder.GraphException.class,
            () -> find(req("type", "task", "where", List.of(cond("nope", "=", "x")))));
        assertEquals(400, f.status());
        assertTrue(f.getMessage().contains("effort_days"), "список допустимых полей: " + f.getMessage());
        assertThrows(LoreGraphBuilder.GraphException.class,
            () -> find(req("type", "task", "where", List.of(cond("title", "~", "x")))));
        assertThrows(LoreGraphBuilder.GraphException.class, () -> find(req("type", "nope")));
        assertThrows(LoreGraphBuilder.GraphException.class, () -> find(req("type", "task", "limit", 2001)));
        assertThrows(LoreGraphBuilder.GraphException.class,
            () -> find(req("type", "task", "links_to", req("id", "component:COMP1", "rels", List.of("drop table")))));
        LoreGraphBuilder.GraphException later = assertThrows(LoreGraphBuilder.GraphException.class,
            () -> find(req("type", "task", "neighbors", List.of(Map.of("as", "x")))));
        assertEquals("NOT_IMPLEMENTED", later.code());
        LoreGraphBuilder.GraphException missing = assertThrows(LoreGraphBuilder.GraphException.class,
            () -> find(req("type", "task", "links_to", req("id", "component:NOPE"))));
        assertEquals(404, missing.status());
    }

    @Test
    void sameRequestSameAnswer() {
        Map<String, Object> r = req("type", "task", "where", List.of(cond("title", "contains", "граф")));
        Map<String, Object> a = find(r);
        Map<String, Object> b = find(r);
        assertEquals(a.get("rows"), b.get("rows"));
        assertFalse(ids(a).isEmpty());
    }

    // ── историчные связи (edge_history): закрытое ребро — не «текущее» ───────

    /** A-1: фаза PH-OLD закрыта (valid_to), PH-NEW открыта; SP_A: веха M-OLD снята, открытой нет. */
    private void historicEdges() {
        db.transaction(() -> {
            cmd("INSERT INTO KnowPhase SET phase_uid = 'PH-OLD'");
            cmd("INSERT INTO KnowPhase SET phase_uid = 'PH-NEW'");
            cmd("INSERT INTO KnowMilestone SET milestone_id = 'M-OLD', label = 'старая веха'");
            db.command("sql", "CREATE EDGE IN_PHASE FROM (SELECT FROM KnowTask WHERE task_uid = 'SP_A/A-1') TO "
                + "(SELECT FROM KnowPhase WHERE phase_uid = 'PH-OLD') SET valid_from = '2026-11-01', valid_to = '2026-11-10'");
            db.command("sql", "CREATE EDGE IN_PHASE FROM (SELECT FROM KnowTask WHERE task_uid = 'SP_A/A-1') TO "
                + "(SELECT FROM KnowPhase WHERE phase_uid = 'PH-NEW') SET valid_from = '2026-11-10'");
            db.command("sql", "CREATE EDGE IN_PHASE FROM (SELECT FROM KnowTask WHERE task_uid = 'SP_A/A-2') TO "
                + "(SELECT FROM KnowPhase WHERE phase_uid = 'PH-OLD') SET valid_from = '2026-11-01', valid_to = '2026-11-10'");
            db.command("sql", "CREATE EDGE TARGETS_MILESTONE FROM (SELECT FROM KnowSprint WHERE sprint_id = 'SP_A') TO "
                + "(SELECT FROM KnowMilestone WHERE milestone_id = 'M-OLD') SET valid_from = '2026-11-01', valid_to = '2026-11-05'");
        });
    }

    @Test
    void closedHistoricEdgeIsNotCurrentInProjection() {
        historicEdges();
        Map<String, Object> res = find(req("type", "task", "id_in", List.of("SP_A/A-1", "SP_A/A-2"),
            "fields", List.of("phase_uid")));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rows = (List<Map<String, Object>>) res.get("rows");
        assertEquals("PH-NEW", rows.get(0).get("phase_uid"), "фаза — по открытому ребру IN_PHASE");
        assertEquals(null, rows.get(1).get("phase_uid"), "закрытое ребро IN_PHASE — фазы сейчас нет");
    }

    @Test
    void closedHistoricEdgeDoesNotLink() {
        historicEdges();
        Map<String, Object> linked = find(req("type", "task",
            "links_to", req("id", "milestone:M-OLD", "rels", List.of("PART_OF", "TARGETS_MILESTONE"), "depth", 2, "dir", "out")));
        assertTrue(ids(linked).isEmpty(), "веха снята со спринта — задачи с ней не связаны: " + ids(linked));
        Map<String, Object> inOld = find(req("type", "task",
            "links_to", req("id", "phase:PH-OLD", "rels", List.of("IN_PHASE"), "dir", "out")));
        assertTrue(ids(inOld).isEmpty(), "из фазы PH-OLD все задачи ушли: " + ids(inOld));
        Map<String, Object> unlinked = find(req("type", "sprint", "not_linked", req("rels", List.of("TARGETS_MILESTONE"))));
        assertTrue(ids(unlinked).contains("SP_A"), "закрытое ребро — связи нет: " + ids(unlinked));
    }

    // ── граф и путь на настоящей базе ────────────────────────────────────────

    @Test
    void sprintNeighborhoodWithExplicitPartOfReturnsItsTasks() {
        // Проба владелицы 19.11.2026: спринт с types=task дал 1 узел и 0 рёбер.
        LoreGraphResource.DbSource src = new LoreGraphResource.DbSource(sql);
        String rid = src.resolve(LoreGraphResource.byType("sprint"), "SP_A");
        LoreGraphBuilder.Result r = LoreGraphBuilder.build(LoreGraphBuilder.Query.neighborhood(rid, 1, Set.of("PART_OF"),
            Set.of("task"), Set.of("task"), "in", false, 500, null), src);
        assertEquals(List.of("SP_A", "SP_A/A-1", "SP_A/A-2", "SP_A/A-3", "SP_A/A-4"), LoreGraphBuilderTest.ids(r));
    }

    @Test
    void pathFromTaskToProjectOverStructuralRels() {
        LoreGraphPath.Result r = LoreGraphResource.runPath(new LoreGraphResource.DbSource(sql),
            LoreGraphResource.RecordRef.parse("from", "task:SP_A/A-4"), LoreGraphResource.RecordRef.parse("to", "project:o/p1"),
            Set.of("PART_OF", "BELONGS_TO_PROJECT"), Set.of(), "out", false, 4, 1, null);
        assertEquals(Boolean.TRUE, r.meta().get("found"));
        assertEquals(2, r.paths().get(0).get("length"));
        LoreGraphPath.Result none = LoreGraphResource.runPath(new LoreGraphResource.DbSource(sql),
            LoreGraphResource.RecordRef.parse("from", "task:SP_A/A-4"), LoreGraphResource.RecordRef.parse("to", "project:o/p2"),
            Set.of("PART_OF", "BELONGS_TO_PROJECT"), Set.of(), "out", false, 4, 1, null);
        assertEquals("no_path", none.meta().get("reason"));
        assertThrows(LoreGraphBuilder.GraphException.class, () -> LoreGraphResource.runPath(new LoreGraphResource.DbSource(sql),
            LoreGraphResource.RecordRef.parse("from", "task:SP_A/A-4"), LoreGraphResource.RecordRef.parse("to", "task:NOPE"),
            Set.of(), Set.of(), "both", false, 4, 1, null));
    }
}
