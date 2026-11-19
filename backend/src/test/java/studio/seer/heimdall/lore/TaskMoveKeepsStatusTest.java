package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/** MT-TASK-MV-HISTORY: перенос задачи сохраняет её статус, а не сбрасывает в PLANNED. */
class TaskMoveKeepsStatusTest {

    @Test
    void openStatusIsCarried() {
        assertEquals("🟡 PARTIAL", LoreSprintTaskResource.carriedStatus("🟡 PARTIAL"));
        assertEquals("🔄 IN PROGRESS", LoreSprintTaskResource.carriedStatus(" 🔄 IN PROGRESS "));
    }

    @Test
    void missingStatusFallsBackToFirstStatusBacklog() {
        // MT-MCP-TRUTH Б5 · MDL-11 / ST-08: пустого статуса у задачи не бывает; не назван — первый статус, бэклог
        // (TaskCreateStatus.DEFAULT). Перенос — то же создание, поэтому тот же первый статус, а не прежний PLANNED.
        assertEquals("🟣 BACKLOG", LoreSprintTaskResource.carriedStatus(null));
        assertEquals("🟣 BACKLOG", LoreSprintTaskResource.carriedStatus("  "));
        assertEquals(TaskCreateStatus.raw(null), LoreSprintTaskResource.carriedStatus(null), "одно правило с созданием");
    }
}
