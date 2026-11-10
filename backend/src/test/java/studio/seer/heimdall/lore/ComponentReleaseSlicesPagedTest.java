package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S4_UI_SHELL_LISTS/S4-29: срезы детей релиза и компонента — честные.
 *
 * <p>Было: {@code release_sprints} резал на 50 строк ({@code LIMIT 50} без ORDER BY — даже не
 * «первые 50», а произвольные), {@code component_sprints} — {@code LIMIT 30} и подбор по имени
 * ({@code sprint_id LIKE '%ключ%'}). Об обрезке ответ не говорил ничего — 50 читалось как «все».
 * Сторож {@code SliceCapAndCardParityTest} их не ловил: у одного нет ORDER BY, у другого он DESC.
 *
 * <p>Стало: потолка нет, страница — общими limit/offset (SE-01, {@code page.total/has_more}),
 * порядок детерминирован, компонент подбирается по ребру. Срез задач компонента — по ребру
 * TAGGED_WITH, тем же правилом.
 */
class ComponentReleaseSlicesPagedTest {

    private static String all(String id) {
        LoreSlices.SliceDef def = LoreSlices.get(id);
        assertNotNull(def, "среза " + id + " нет");
        return (def.baseSql() + " " + def.suffix()).replaceAll("\\s+", " ");
    }

    @Test
    void childSlicesCarryNoCap_andHaveDeterministicOrder() {
        for (String id : List.of("release_sprints", "release_sprints_by_tag", "component_sprints", "component_tasks")) {
            String sql = all(id);
            assertFalse(sql.toUpperCase().contains("LIMIT"), id + ": молчаливый потолок — страница только limit/offset: " + sql);
            assertTrue(sql.toUpperCase().contains("ORDER BY"), id + ": без порядка страницы limit/offset не стыкуются: " + sql);
        }
    }

    @Test
    void componentSprints_byEdgeOnly() {
        String sql = all("component_sprints");
        assertEquals(List.of("cid"), LoreSlices.get("component_sprints").required(), "компонент — по ключу, имя не нужно");
        assertFalse(sql.contains("LIKE"), "подбор по имени снят: " + sql);
        assertTrue(sql.contains("out('BELONGS_TO').component_id CONTAINS :cid"), sql);
    }

    @Test
    void componentTasks_byEdge_andScoped() {
        String sql = all("component_tasks");
        assertEquals(List.of("cid"), LoreSlices.get("component_tasks").required());
        assertTrue(sql.contains("out('TAGGED_WITH').component_id CONTAINS :cid"), sql);
        for (String col : List.of("task_uid", "title", " AS status_raw", " AS sprint_id"))
            assertTrue(sql.contains(col), "component_tasks: нет " + col + ": " + sql);
        assertTrue(LoreSlices.PROJECT_SCOPED.containsKey("component_tasks"), "задачи компонента режутся скоупом через спринт");
    }

    @Test
    void componentPassport_hasTasksAndSprintsTabs_readBySlice() {
        LoreRecordRegistry.TypeDef d = LoreRecordRegistry.get("component");
        for (String[] t : List.of(new String[]{"tasks", "TAGGED_WITH", "task"}, new String[]{"sprints", "BELONGS_TO", "sprint"})) {
            LoreRecordRegistry.Relation r = d.relations().stream().filter(x -> x.key().equals(t[0])).findFirst().orElse(null);
            assertNotNull(r, "у паспорта компонента нет вкладки " + t[0]);
            assertEquals("link_tab", r.place());
            assertEquals(t[1], r.rel());
            assertEquals("in", r.dir());
            assertEquals(t[2], r.targetType());
        }
        assertEquals(Map.of("tasks", "component_tasks", "sprints", "component_sprints"),
            LoreRecordValues.READ_BY_SLICE.get("component"));
    }
}
