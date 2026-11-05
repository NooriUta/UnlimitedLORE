package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-SPRINT-DONE-GUARD (владелец 05.11.2026): в Völva два
 * спринта числились DONE и держали 11 открытых задач — task_new брал sprint_id строкой
 * и не смотрел на статус. Отказ, а не предупреждение: предупреждение рядом с ok:true
 * агент проглатывает. Чистая функция решения — без базы.
 */
class SprintDoneGuardTest {

    @Test
    void doneAndCancelledSprintsRefuse() {
        String m = LoreSprintTaskResource.closedSprintRefusal("SPRINT_X", "✅ DONE", "2026-08-24T10:00:00Z");
        assertNotNull(m);
        assertTrue(m.contains("SPRINT_X") && m.contains("DONE") && m.contains("2026-08-24"), m);
        assertNotNull(LoreSprintTaskResource.closedSprintRefusal("SPRINT_X", "🚫 CANCELLED", null));
        assertNotNull(LoreSprintTaskResource.closedSprintRefusal("SPRINT_X", "ЗАВЕРШЁН", null));
    }

    @Test
    void openStatusesPass() {
        for (String s : new String[]{"📋 PLANNED", "🔄 IN PROGRESS", "🟡 PARTIAL", "🔴 BLOCKED", "🚀 READY FOR DEPLOY", "⬜ TODO"})
            assertNull(LoreSprintTaskResource.closedSprintRefusal("S", s, null), s);
    }

    @Test
    void unknownStatusIsNotTreatedAsClosed() {
        // нет строки статуса — не повод отказывать: «не знаем» ≠ «закрыт»
        assertNull(LoreSprintTaskResource.closedSprintRefusal("S", null, null));
    }

    @Test
    void messageSaysWhatToDo() {
        String m = LoreSprintTaskResource.closedSprintRefusal("SPRINT_X", "✅ DONE", null);
        assertTrue(m.contains("открытый спринт") || m.contains("переоткрыть"), m);
    }
}
