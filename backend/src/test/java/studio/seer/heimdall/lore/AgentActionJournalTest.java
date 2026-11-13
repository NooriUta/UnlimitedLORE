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
        assertTrue(sql.contains("FROM AgentActionLog"), sql);
        assertTrue(sql.contains("ORDER BY ts DESC"), sql);
    }

    @Test
    void sliceFiltersByEntityAndCaller() {
        String sql = LoreSlices.compose("agent_actions",
            Map.of("entity_id", "SPRINT_X/T1", "caller", "full")).sql();
        assertTrue(sql.contains("object_id = :entity_id"), sql);
        assertTrue(sql.contains("source = :caller"), sql);
    }

    // SPRINT_UXR_S7B_ADMIN/S7B-02: журнал действий админки — тот же ряд lore.action,
    // но только админские семейства; фильтр по семейству и по вызывающему.
    @Test
    void adminJournalReadsOnlyAdminFamilies() {
        String sql = LoreSlices.compose("admin_actions", Map.of()).sql();
        assertTrue(sql.contains("FROM AgentActionLog"), sql);
        for (String f : LoreSlices.ADMIN_FAMILIES)
            assertTrue(sql.contains("'" + f + "'"), "семейство " + f + " в журнале админки: " + sql);
        assertFalse(sql.contains("'task'") || sql.contains("'sprint'"), "рабочие семейства не админка: " + sql);
        assertTrue(sql.contains("ORDER BY ts DESC"), sql);
        assertTrue(LoreSlices.ADMIN_FAMILIES.containsAll(java.util.List.of("dict", "kc", "admin", "user", "project")));
    }

    @Test
    void adminJournalFiltersByFamilyAndCaller() {
        String sql = LoreSlices.compose("admin_actions", Map.of("family", "dict", "caller", "omiloreadmin")).sql();
        assertTrue(sql.contains("object_type = :family"), sql);
        assertTrue(sql.contains("source = :caller"), sql);
        assertEquals(1, sql.toUpperCase().split(" WHERE ", -1).length - 1, "один WHERE: " + sql);
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

    /**
     * SPRINT_UXR_POLISH_UAT_1113/PU-03: у админских правок в ответе нет *_id — роль
     * отвечает {kc_sub, project}, словарь {dict_type, code}. Журнал писал путь
     * (/lore/user/role, /lore/dict/entry) — «куда звали» вместо «что изменили».
     * Правило: нет id — естественный ключ объекта; составной важнее одиночного.
     */
    @Test
    void naturalKeyNamesTheObjectWhenThereIsNoId() {
        java.util.Map<String, Object> role = new java.util.LinkedHashMap<>();
        role.put("ok", true); role.put("kc_sub", "u-1"); role.put("project", "UnlimitedLORE"); role.put("role", "admin");
        assertEquals("u-1/UnlimitedLORE", LoreAuditLogFilter.entityIdOf(role));
        assertEquals("task_status/uat",
            LoreAuditLogFilter.entityIdOf(Map.of("ok", true, "dict_type", "task_status", "code", "uat")));
        // dry_run пачки ролей: batch_id ещё нет — объект всё равно человек
        assertEquals("u-1", LoreAuditLogFilter.entityIdOf(Map.of("ok", true, "kc_sub", "u-1", "dry_run", true)));
        assertEquals("UnlimitedLORE", LoreAuditLogFilter.entityIdOf(Map.of("ok", true, "slug", "UnlimitedLORE")));
        // id по-прежнему важнее естественного ключа
        assertEquals("rb-1", LoreAuditLogFilter.entityIdOf(Map.of("batch_id", "rb-1", "kc_sub", "u-1")));
        assertNull(LoreAuditLogFilter.entityIdOf(Map.of("ok", true)));
    }
}
