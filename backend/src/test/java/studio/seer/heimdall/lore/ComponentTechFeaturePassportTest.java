package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S4_UI_SHELL_LISTS/S4-V2-SECTIONS, серверная часть (заметка kit 09.11):
 * паспорта компонента, технологии и фичи — последние три типа разделов v2 (только чтение),
 * и срез всех уровней сценариев без обязательного параметра («US разделом»).
 */
class ComponentTechFeaturePassportTest {

    @Test
    void elevenPassportTypesInKitOrder() {
        assertEquals(List.of("sprint", "task", "adr", "spec", "decision", "question", "milestone", "release",
            "component", "tech", "feature"), LoreRecordRegistry.TYPES);
    }

    @Test
    @SuppressWarnings("unchecked")
    void newTypesAreReadOnlyWithSourceAndGraph() {
        Map<String, String[]> want = Map.of(
            "component", new String[]{"component", "LoreComponent", "component_id"},
            "tech", new String[]{"tech_by_id", "KnowSpec", "spec_id"},
            "feature", new String[]{"uc_by_id", "KnowUseCase", "uc_id"});
        for (Map.Entry<String, String[]> e : want.entrySet()) {
            String t = e.getKey();
            assertTrue(LoreRecordRegistry.READ_ONLY.contains(t), t + " — только чтение");
            Map<String, Object> s = LoreRecordRegistry.schemaJson(t);
            assertNotNull(s, t + ": тип не заведён в реестре");
            for (Map<String, Object> f : (List<Map<String, Object>>) s.get("fields"))
                assertEquals(false, f.get("editable"), t + "." + f.get("key") + " не правится");
            LoreRecordResource.Source src = LoreRecordResource.sourceOf(t);
            assertNotNull(src, t + ": нет главного среза");
            assertEquals(e.getValue()[0], src.slice(), t);
            assertEquals("id", src.param(), t);
            assertNotNull(LoreSlices.get(src.slice()), t + ": срез " + src.slice() + " не зарегистрирован");
            LoreModelTypes.Graph g = LoreModelTypes.GRAPH.get(t);
            assertNotNull(g, t + ": нет вершины в модели");
            assertEquals(e.getValue()[1], g.vertex(), t);
            assertNull(g.hist(), t + ": истории SCD2 у паспорта нет");
            assertEquals(e.getValue()[2], g.key(), t);
        }
    }

    @Test
    void componentValuesFromComponentSlice() {
        Map<String, Object> row = new HashMap<>();
        row.put("component_id", "LORE");
        row.put("full_name", "Хранилище знаний");
        row.put("area", "core");
        row.put("parent_id", "AIDA");
        row.put("owner", "arharaga");
        row.put("team", "seidr");
        row.put("game_icon", "book-cover");
        row.put("sub_components", List.of("LORE-UI", "LORE-MCP"));
        row.put("tech", List.of("quarkus"));
        row.put("adrs", List.of("ADR-LORE-048"));
        row.put("specs", List.of("SPEC-X"));
        Map<String, Object> v = LoreRecordValues.component(row);
        assertEquals("Хранилище знаний", v.get("title"));
        assertEquals("LORE", v.get("code"));
        assertEquals("core", v.get("area"));
        assertEquals("AIDA", v.get("parent"));
        assertEquals("arharaga", v.get("owner"));
        assertEquals("seidr", v.get("team"));
        assertEquals("book-cover", v.get("icon"));
        assertEquals(List.of("LORE-UI", "LORE-MCP"), v.get("children"));
        assertEquals(List.of("quarkus"), v.get("tech"));
        row.remove("full_name");
        assertEquals("LORE", LoreRecordValues.component(row).get("title"), "без имени — код");
    }

    @Test
    void techValuesFromTechSlice() {
        Map<String, Object> row = new HashMap<>();
        row.put("spec_id", "SPEC-TECH-LORE-QUARKUS");
        row.put("tech_name", "Quarkus");
        row.put("version", "3.15.1");
        row.put("checked_at", "2026-11-01");
        row.put("component_id", "LORE");
        row.put("content_md", "- license: Apache-2.0");
        Map<String, Object> v = LoreRecordValues.tech(row);
        assertEquals("Quarkus", v.get("title"));
        assertEquals("SPEC-TECH-LORE-QUARKUS", v.get("code"));
        assertEquals("3.15.1", v.get("version"));
        assertEquals("2026-11-01", v.get("checked_at"));
        assertEquals("LORE", v.get("component"));
        assertEquals("- license: Apache-2.0", v.get("content_md"));
        assertEquals("- license: Apache-2.0", v.get("body_md"));
    }

    @Test
    void featureValuesFromUcByIdAnyLevel() {
        Map<String, Object> row = new HashMap<>();
        row.put("uc_id", "UC-7");
        row.put("title", "Открыть паспорт");
        row.put("status", "in_rework");
        row.put("goal_level", "sea-level");
        row.put("parent_uc_id", "FEAT-1");
        row.put("component_ids", List.of("LORE"));
        row.put("projects", List.of("NooriUta/UnlimitedLORE"));
        row.put("body_md", "тело");
        row.put("scenario_md", "шаги");
        row.put("acceptance_md", "критерий");
        row.put("child_uc_ids", List.of("UC-8"));
        row.put("task_uids", List.of("S/T-1"));
        Map<String, Object> v = LoreRecordValues.feature(row);
        assertEquals("Открыть паспорт", v.get("title"));
        assertEquals("UC-7", v.get("code"));
        assertEquals("sea-level", v.get("goal_level"));
        assertEquals("FEAT-1", v.get("parent"));
        assertEquals(List.of("LORE"), v.get("components"));
        assertEquals(List.of("NooriUta/UnlimitedLORE"), v.get("projects"));
        assertEquals("шаги", v.get("scenario_md"));
        assertEquals("критерий", v.get("acceptance_md"));
        assertEquals("тело", v.get("body_md"));
    }

    @Test
    void techByIdIsSharedAndOnlyTechSpecs() {
        LoreSlices.SliceDef d = LoreSlices.get("tech_by_id");
        assertNotNull(d, "срез tech_by_id не зарегистрирован");
        assertEquals(List.of("id"), d.required());
        String sql = LoreSlices.compose("tech_by_id", Map.of("id", "SPEC-TECH-A-B")).sql();
        assertTrue(sql.contains("spec_id = :id") && sql.contains("SPEC-TECH-"), sql);
        assertEquals(LoreSlices.SHARED_SLICES.containsKey("tech_registry"), LoreSlices.SHARED_SLICES.containsKey("tech_by_id"),
            "паспорт технологии скоупится как реестр технологий");
    }

    /** «US разделом»: все уровни шкалы Коберна, без обязательного параметра. */
    @Test
    void useCasesSliceAllLevelsNoRequiredParam() {
        LoreSlices.SliceDef d = LoreSlices.get("use_cases");
        assertNotNull(d, "срез use_cases не зарегистрирован");
        assertEquals(List.of(), d.required(), "без обязательного параметра");
        String sql = LoreSlices.compose("use_cases", Map.of()).sql();
        assertFalse(sql.contains("goal_level IN"), "уровни не режутся: " + sql);
        assertTrue(sql.contains("goal_level") && sql.contains("parent_uc_id") && sql.contains("FROM KnowUseCase"), sql);
        assertFalse(sql.contains("body_md"), "тела в списке не нужны — вес выдачи");
        String byLevel = LoreSlices.compose("use_cases", Map.of("goal_level", "sea-level")).sql();
        assertTrue(byLevel.contains("goal_level = :goal_level"), byLevel);
        String byComp = LoreSlices.compose("use_cases", Map.of("component", "LORE")).sql();
        assertTrue(byComp.contains("out('BELONGS_TO').component_id CONTAINS :component"), byComp);
        assertEquals(LoreSlices.UC_INHERITED_SCOPE, LoreSlices.PROJECT_SCOPED.get("use_cases"),
            "проект сценария наследуется от корня — как у use_cases_of_feature");
    }
}
