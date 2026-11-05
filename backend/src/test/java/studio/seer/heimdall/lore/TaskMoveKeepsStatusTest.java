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
    void missingStatusFallsBackToPlannedAsBefore() {
        assertEquals("📋 PLANNED", LoreSprintTaskResource.carriedStatus(null));
        assertEquals("📋 PLANNED", LoreSprintTaskResource.carriedStatus("  "));
    }
}
