package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S4_UI_SHELL_LISTS/S4-30, серверная часть: {@code meta.data_state} —
 * по каждому прочитанному источнику «проверено / не смогли / нет прав / обрезано».
 * Форма согласована с kit-сессией 08.11: {@code {source, part?, state, reason?, total?, has_more?}};
 * {@code forbidden} — отдельное состояние, НЕ {@code error} с причиной «403»
 * (при ошибке ждут починки, при запрете — просят доступ).
 */
class LoreRecordDataStateTest {

    private static LoreRecordResource.Read ok(int n) {
        return new LoreRecordResource.Read(java.util.Collections.nCopies(n, Map.of()), "ok", null, null);
    }

    @Test
    void okSourceIsOkWithoutReason() {
        Map<String, Object> e = LoreRecordDataState.entry("tasks_of_sprint", "tasks", ok(3));
        assertEquals("tasks_of_sprint", e.get("source"));
        assertEquals("tasks", e.get("part"));
        assertEquals("ok", e.get("state"));
        assertFalse(e.containsKey("reason"));
    }

    @Test
    void failedSliceIsErrorWithReason() {
        Map<String, Object> e = LoreRecordDataState.entry("phases_of_sprint", "phases",
            new LoreRecordResource.Read(List.of(), "error", "phases_of_sprint: timeout", new RuntimeException()));
        assertEquals("error", e.get("state"));
        assertEquals("phases_of_sprint: timeout", e.get("reason"));
    }

    @Test
    void scopeDenialIsForbiddenNotError() {
        Map<String, Object> e = LoreRecordDataState.entry("adrs_of_task", "adrs",
            new LoreRecordResource.Read(List.of(), "denied", "проектный скоуп пуст", null));
        assertEquals("forbidden", e.get("state"), "отказ скоупа — forbidden, а не error");
        assertEquals("проектный скоуп пуст", e.get("reason"));
    }

    @Test
    void sourceWithoutPartOmitsPart() {
        Map<String, Object> e = LoreRecordDataState.entry("sprint_by_id", null, ok(1));
        assertFalse(e.containsKey("part"), "нет части — ключа нет, а не null");
    }

    @Test
    void truncatedOnlyWhenSourceSaysSoAndTotalNeverInvented() {
        Map<String, Object> withTotal = LoreRecordDataState.truncated("tasks_of_sprint", "tasks", 50, 120L);
        assertEquals("truncated", withTotal.get("state"));
        assertEquals(true, withTotal.get("has_more"));
        assertEquals(120L, withTotal.get("total"));
        Map<String, Object> noTotal = LoreRecordDataState.truncated("tasks_of_sprint", "tasks", 50, null);
        assertFalse(noTotal.containsKey("total"), "сколько всего — неизвестно; число не выдумываем");
        // обычное чтение без признака обрезки не помечается truncated, даже если строк много
        assertEquals("ok", LoreRecordDataState.entry("tasks_of_sprint", "tasks", ok(500)).get("state"));
    }

    @Test
    void versionFailureIsVisible() {
        Map<String, Object> e = LoreRecordDataState.version("boom");
        assertEquals("version", e.get("source"));
        assertEquals("error", e.get("state"));
        assertEquals("boom", e.get("reason"));
        assertEquals("ok", LoreRecordDataState.version(null).get("state"));
        assertNull(LoreRecordDataState.version(null).get("reason"));
    }

    @Test
    void unknownReadStateIsNotSilentlyOk() {
        Map<String, Object> e = LoreRecordDataState.entry("x", null,
            new LoreRecordResource.Read(List.of(), "weird", null, null));
        assertEquals("error", e.get("state"));
        assertTrue(String.valueOf(e.get("reason")).contains("weird"));
    }
}
