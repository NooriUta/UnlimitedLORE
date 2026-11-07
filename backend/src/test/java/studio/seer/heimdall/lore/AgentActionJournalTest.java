package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_AGENT_OBSERVABILITY/AO-01: журнал мутирующих действий — точки
 * metric='lore.action' в MetricSnapshot (TIMESERIES), читаются срезом
 * agent_actions. Без живой базы: форма записи и срез.
 */
class AgentActionJournalTest {

    @Test
    void sliceReadsTheActionSeriesNewestFirst() {
        String sql = LoreSlices.compose("agent_actions", Map.of()).sql();
        assertTrue(sql.contains("metric = 'lore.action'"), sql);
        assertTrue(sql.contains("ORDER BY ts DESC"), sql);
    }

    @Test
    void sliceFiltersByEntityAndCaller() {
        String sql = LoreSlices.compose("agent_actions",
            Map.of("entity_id", "SPRINT_X/T1", "caller", "full")).sql();
        assertTrue(sql.contains("object_id = :entity_id"), sql);
        assertTrue(sql.contains("source = :caller"), sql);
    }

    @Test
    void readsAreNotJournalled() {
        assertFalse(LoreRequestStats.isJournalled("GET"));
        assertFalse(LoreRequestStats.isJournalled("HEAD"));
        assertTrue(LoreRequestStats.isJournalled("POST"));
        assertTrue(LoreRequestStats.isJournalled("DELETE"));
    }

    @Test
    void entityIdComesFromTheResponseEcho() {
        assertEquals("SPRINT_X/T1", LoreAuditLogFilter.entityIdOf(Map.of("ok", true, "task_uid", "SPRINT_X/T1")));
        assertNull(LoreAuditLogFilter.entityIdOf("not a map"));
    }

    /** Стенд 07.11: status_set отвечает record'ом — в журнал попал путь /lore/status вместо id задачи. */
    record Echo(boolean ok, String entity_type, String id, String old_status) {}
    record NoId(boolean ok, String note) {}

    @Test
    void entityIdComesFromARecordResponseToo() {
        assertEquals("SPRINT_X/T1", LoreAuditLogFilter.entityIdOf(new Echo(true, "task", "SPRINT_X/T1", "📋 PLANNED")));
        assertNull(LoreAuditLogFilter.entityIdOf(new NoId(true, "x")));
    }
}
