package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Владелица 21.11.2026 (канал): «внеси пожалуйста в ограничение добавки новых задач в спринт наличие в спринте
 * 35 задач — у нас пухнут мега спринты». Тот же сторож, что MT-SPRINT-DONE-GUARD: отказ, а не предупреждение.
 * Чистая функция решения — без базы.
 */
class SprintFullGuardTest {

    private static List<String> statuses(int n, String st) {
        String[] a = new String[n];
        Arrays.fill(a, st);
        return Arrays.asList(a);
    }

    @Test
    void limitIs35() {
        assertEquals(35, LoreSprintTaskResource.SPRINT_TASK_LIMIT);
    }

    @Test
    void thirtyFourTasksStillAcceptOne() {
        assertNull(LoreSprintTaskResource.fullSprintRefusal("SPRINT_X", statuses(34, "📋 PLANNED")));
    }

    @Test
    void thirtyFiveTasksRefuseWithWhatToDo() {
        String m = LoreSprintTaskResource.fullSprintRefusal("SPRINT_X", statuses(35, "✅ DONE"));
        assertNotNull(m);
        assertTrue(m.contains("SPRINT_X") && m.contains("35"), m);
        assertTrue(m.contains("новый спринт"), m);
    }

    @Test
    void cancelledTasksDoNotCount() {
        List<String> s = new java.util.ArrayList<>(statuses(34, "🔄 IN PROGRESS"));
        s.addAll(statuses(10, "🚫 CANCELLED"));
        assertNull(LoreSprintTaskResource.fullSprintRefusal("SPRINT_X", s));
    }

    @Test
    void unknownStatusCounts() {
        // строки статуса нет — задача всё равно лежит в спринте: «не знаем статус» ≠ «её нет»
        List<String> s = new java.util.ArrayList<>(statuses(34, "📋 PLANNED"));
        s.add(null);
        assertNotNull(LoreSprintTaskResource.fullSprintRefusal("SPRINT_X", s));
    }
}
