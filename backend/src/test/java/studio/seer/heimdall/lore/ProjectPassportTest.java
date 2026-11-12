package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S4_UI_SHELL_LISTS/S4-29, решение 53а (D-2026-UXR-OWNER-DELEGATED-ANSWERS-10-11):
 * паспорт проекта. Тип {@code project} в реестре паспорта и в модели, вкладки по смыслу —
 * Спринты · Компоненты · ADR · Релизы · Люди и агенты; каждая вкладка читается своим срезом с
 * честной полнотой (без потолка, страница — общими limit/offset, фасад отдаёт первую порцию и
 * сверх неё — {@code data_state truncated} с total). Контракт {@code lore.record/1} прежний.
 */
class ProjectPassportTest {

    /**
     * 53а — первые шесть. Слово владелицы 11.11 («у проекта всё показывать, что связано напрямую»):
     * за ними — всё, что связано с проектом ребром BELONGS_TO_PROJECT напрямую.
     */
    private static final List<String> TABS = List.of("sprints", "components", "adrs", "releases", "people", "agents",
        "specs", "decisions", "questions", "features", "docs", "runbooks", "actors", "boundAgents", "files", "prs");

    /** Вкладка → срез (у новых — по имени сущности, не по ключу вкладки). */
    private static final Map<String, String> SLICE = new LinkedHashMap<>();
    static {
        for (String k : List.of("sprints", "components", "adrs", "releases", "people", "agents",
            "specs", "decisions", "questions", "features", "docs", "runbooks", "actors", "files", "prs"))
            SLICE.put(k, "project_" + k);
        SLICE.put("boundAgents", "project_bound_agents");
    }

    /** Новые вкладки 11.11: прямое ребро BELONGS_TO_PROJECT → тип цели. */
    private static final Map<String, String> DIRECT = new LinkedHashMap<>();
    static {
        DIRECT.put("specs", "spec");
        DIRECT.put("decisions", "decision");
        DIRECT.put("questions", "question");
        DIRECT.put("features", "feature");
        DIRECT.put("docs", "doc");
        DIRECT.put("runbooks", "runbook");
        DIRECT.put("actors", "actor");
        DIRECT.put("boundAgents", "agent");
        DIRECT.put("files", "file");
        DIRECT.put("prs", "pr");
    }

    @Test
    void projectIsAPassportTypeReadOnly() {
        assertEquals("project", LoreRecordRegistry.TYPES.get(LoreRecordRegistry.TYPES.size() - 1),
            "проект — последним, после фичи");
        assertTrue(LoreRecordRegistry.READ_ONLY.contains("project"), "путей записи у проекта в фасаде нет");
        Map<String, Object> s = LoreRecordRegistry.schemaJson("project");
        assertNotNull(s, "тип project не заведён в реестре");
        @SuppressWarnings("unchecked") List<Map<String, Object>> fields = (List<Map<String, Object>>) s.get("fields");
        for (Map<String, Object> f : fields)
            assertEquals(false, f.get("editable"), "project." + f.get("key") + " не правится");
    }

    @Test
    void sourceSliceAndGraph() {
        LoreRecordResource.Source src = LoreRecordResource.sourceOf("project");
        assertNotNull(src, "у проекта нет главного среза");
        assertEquals("project_by_id", src.slice());
        assertEquals("project", src.param());
        LoreSlices.SliceDef d = LoreSlices.get("project_by_id");
        assertNotNull(d, "срез project_by_id не зарегистрирован");
        assertEquals(List.of("project"), d.required());
        assertTrue(d.baseSql().contains("FROM KnowGitProject") && d.baseSql().contains("slug = :project"), d.baseSql());
        assertEquals("=slug", LoreSlices.PROJECT_SCOPED.get("project_by_id"),
            "паспорт проекта режется скоупом по самому slug — как выпадающий список git_projects");
        LoreModelTypes.Graph g = LoreModelTypes.GRAPH.get("project");
        assertNotNull(g, "нет вершины проекта в модели");
        assertEquals("KnowGitProject", g.vertex());
        assertNull(g.hist(), "истории SCD2 у проекта нет");
        assertEquals("slug", g.key());
    }

    @Test
    void valuesFromProjectRow() {
        Map<String, Object> row = new HashMap<>();
        row.put("slug", "NooriUta/UnlimitedLORE");
        row.put("name", "UnlimitedLORE");
        row.put("default_branch", "develop");
        row.put("is_private", true);
        Map<String, Object> v = LoreRecordValues.values("project", row);
        assertEquals("UnlimitedLORE", v.get("title"));
        assertEquals("NooriUta/UnlimitedLORE", v.get("code"));
        assertEquals("develop", v.get("default_branch"));
        assertEquals("Да", v.get("is_private"));
        row.remove("name");
        assertEquals("NooriUta/UnlimitedLORE", LoreRecordValues.values("project", row).get("title"), "без имени — slug");
    }

    @Test
    void tabsAreLinkTabsReadBySliceEachPaged() {
        LoreRecordRegistry.TypeDef d = LoreRecordRegistry.get("project");
        Map<String, String> target = new LinkedHashMap<>(Map.of("sprints", "sprint", "components", "component", "adrs", "adr",
            "releases", "release", "people", "user", "agents", "agent"));
        target.putAll(DIRECT);
        for (String k : DIRECT.keySet()) {
            LoreRecordRegistry.Relation r = d.relations().stream().filter(x -> x.key().equals(k)).findFirst().orElse(null);
            assertNotNull(r, "у паспорта проекта нет вкладки " + k);
            assertEquals("BELONGS_TO_PROJECT", r.rel(), k + ": связано с проектом напрямую");
        }
        for (String k : TABS) {
            LoreRecordRegistry.Relation r = d.relations().stream().filter(x -> x.key().equals(k)).findFirst().orElse(null);
            assertNotNull(r, "у паспорта проекта нет вкладки " + k);
            assertEquals("link_tab", r.place(), k);
            assertEquals("in", r.dir(), k);
            assertEquals(target.get(k), r.targetType(), k);
            assertFalse(r.manageable(), k + ": пути привязки у проекта нет");
        }
        assertEquals(SLICE, LoreRecordValues.READ_BY_SLICE.get("project"));
        for (LoreRecordFrom.SliceLink sl : LoreRecordFrom.SLICE_LINKS.get("project")) {
            assertTrue(sl.paged(), sl.key() + ": первая порция + truncated с total, а не всё подряд");
            assertEquals("project", sl.param(), sl.key());
        }
    }

    @Test
    void tabSlicesAreHonest_noCap_ordered_scoped() {
        for (String k : TABS) {
            String id = SLICE.get(k);
            LoreSlices.SliceDef def = LoreSlices.get(id);
            assertNotNull(def, "среза " + id + " нет");
            assertEquals(List.of("project"), def.required(), id);
            String sql = (def.baseSql() + " " + def.suffix()).replaceAll("\\s+", " ");
            assertFalse(sql.toUpperCase().contains("LIMIT"), id + ": молчаливый потолок: " + sql);
            assertTrue(sql.toUpperCase().contains("ORDER BY"), id + ": без порядка страницы не стыкуются: " + sql);
            boolean scoped = LoreSlices.PROJECT_SCOPED.containsKey(id);
            boolean shared = LoreSlices.SHARED_SLICES.containsKey(id);
            assertTrue(scoped ^ shared, id + ": ровно одно — скоупный или общий с причиной");
        }
        for (String id : List.of("project_sprints", "project_adrs", "project_releases",
                "project_specs", "project_decisions", "project_questions", "project_features",
                "project_docs", "project_runbooks", "project_files", "project_prs")) {
            assertEquals("out('BELONGS_TO_PROJECT').slug", LoreSlices.PROJECT_SCOPED.get(id), id);
            assertTrue(LoreSlices.get(id).baseSql().contains("out('BELONGS_TO_PROJECT').slug CONTAINS :project"), id);
        }
        // 11.11: роли продукта и агенты, привязанные к проекту напрямую, — своим ребром, а не через
        // владельца; видны всем (AL-106), как actors и project_agents.
        for (String id : List.of("project_actors", "project_bound_agents")) {
            assertTrue(LoreSlices.SHARED_SLICES.containsKey(id), id + ": общий с причиной (AL-106)");
            assertTrue(LoreSlices.get(id).baseSql().contains("out('BELONGS_TO_PROJECT').slug CONTAINS :project"), id);
        }
        assertTrue(LoreSlices.get("project_components").baseSql()
            .contains("in('BELONGS_TO')[sprint_id IS NOT NULL].out('BELONGS_TO_PROJECT').slug CONTAINS :project"),
            "компонент принадлежит проекту через свои спринты — тем же путём, что git_projects у components");
        assertTrue(LoreSlices.get("project_people").baseSql().contains("FROM HAS_PROJECT_ROLE"),
            "люди — по назначению роли в проекте (источник истины о правах — граф)");
        assertTrue(LoreSlices.get("project_agents").baseSql().contains("kind = 'agent'"), "агенты — акторы-агенты");
    }

    @Test
    void sliceRowsBecomeLinks() {
        Map<String, Object> person = new HashMap<>();
        person.put("kc_sub", "sub-1");
        person.put("display_name", "Владелица");
        person.put("role", "owner");
        Map<String, Object> l = LoreRecordValues.sliceLink("project", "people", person);
        assertEquals("HAS_PROJECT_ROLE", l.get("rel"));
        assertEquals("in", l.get("dir"));
        assertEquals("sub-1", l.get("id"));
        assertEquals("user", l.get("type"));
        assertEquals("Владелица", l.get("title"));
        Map<String, Object> rel = new HashMap<>();
        rel.put("release_uid", "NooriUta/UnlimitedLORE#v1.17.12");
        rel.put("version", "1.17.12");
        Map<String, Object> rl = LoreRecordValues.sliceLink("project", "releases", rel);
        assertEquals("NooriUta/UnlimitedLORE#v1.17.12", rl.get("id"), "ключ паспорта релиза — release_uid");
        assertEquals("release", rl.get("type"));
    }

    @Test
    void surfaceOrderIsOwnersMeaning() {
        @SuppressWarnings("unchecked") Map<String, Object> t = (Map<String, Object>) LorePassportSurface.build().get("project");
        assertEquals(true, t.get("decided"));
        @SuppressWarnings("unchecked") List<Map<String, Object>> sections = (List<Map<String, Object>>) t.get("sections");
        List<String> keys = new ArrayList<>();
        for (Map<String, Object> m : sections) keys.add((String) m.get("key"));
        assertEquals(TABS, keys, "Спринты · Компоненты · ADR · Релизы · Люди и агенты (53а), затем прямые связи (11.11)");
        for (Map<String, Object> m : sections) {
            Object g = m.get("group");
            if (List.of("people", "agents").contains(m.get("key"))) {
                assertNotNull(g, m.get("key") + ": в группе «Люди и агенты»");
                @SuppressWarnings("unchecked") Map<String, Object> gm = (Map<String, Object>) g;
                assertEquals("Люди и агенты", gm.get("label"));
            } else {
                assertNull(g, m.get("key") + ": своя вкладка");
            }
        }
    }
}
