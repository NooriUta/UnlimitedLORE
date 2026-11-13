package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_POLISH_UAT_1113/PU-17 — в модели роли задачи (автор, исполнитель, принимающий) — рёбра
 * ROLE_HELD_BY, а не строковые свойства вершины. Строки author/executor/reviewer_agent после TR-05
 * не пишутся; модель, называвшая их источником поля (CONFIRMS), обещала то, чего нет.
 */
class TaskRolesModelTest {

    @Test
    @SuppressWarnings("unchecked")
    void taskRoleFieldsAreBackedByEdgeNotByVertexStrings() {
        Map<String, Object> types = (Map<String, Object>) LoreModelGoldenTest.modelDoc().get("types");
        Map<String, Object> task = (Map<String, Object>) types.get("task");
        List<Map<String, Object>> fields = (List<Map<String, Object>>) task.get("fields");
        for (String key : List.of("author", "executor", "reviewer")) {
            Map<String, Object> f = fields.stream().filter(x -> key.equals(x.get("key"))).findFirst().orElseThrow();
            assertNull(f.get("property"), key + ": роль не читается из строки вершины");
            assertEquals("EDGE", f.get("source"), key + ": источник роли — ребро");
            assertEquals("ROLE_HELD_BY", f.get("edge"), key);
            assertNotNull(f.get("options"), key + ": правка роли — только выбором");
        }
        List<String> unclassified = (List<String>) task.get("unclassified");
        for (String legacy : List.of("author_agent", "executor_agent", "reviewer_agent"))
            assertFalse(unclassified.contains(legacy), legacy + ": легаси-строка роли не выдаётся за неописанное поле");
    }
}
