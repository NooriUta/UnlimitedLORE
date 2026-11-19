package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Причина статуса и адресат ожидания принадлежат СВОЕМУ статусу. Аудит 19.11.2026: у задач, давно вышедших из
 * блокировки (S8-02, S8-05, MD-02, QG-01), срезы и MCP по-прежнему показывали «Ждёт владелицу…» — новая версия
 * копировала status_reason прежней. Паспорт это уже прятал (LoreRecordValues.dropLeftoversOfOtherStatuses), а
 * запись — нет. Правило записи то же, что у паспорта: причина переносится, только если статус тот же и у него
 * причина — смысл (REASON_STATUSES); «ждём» — только у той же ждущей.
 */
class StatusReasonCarryTest {

    private static Map<String, Object> open(String raw) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("@rid", "#1:1");
        r.put("status_raw", raw);
        r.put("status_reason", "Ждёт владелицу: старая причина");
        r.put("waiting_for", "omiloreadmin");
        r.put("note_md", "заметка");
        return r;
    }

    private static String script(String from, String to) {
        return StatusHistoryService.plan(StatusHistoryService.KINDS.get("task"), "S/T-1", open(from), to, null,
            ChangeAuthor.UNKNOWN, "2026-11-19T12:00:00Z", "nsid").script();
    }

    @Test
    void из_блокировки_в_работу_причина_и_адресат_не_переносятся() {
        String s = script("🔴 BLOCKED", "🔄 IN PROGRESS");
        assertFalse(s.contains("status_reason"), s);
        assertFalse(s.contains("waiting_for"), s);
        assertTrue(s.contains("note_md"), "заметка — часть задачи, переносится: " + s);
    }

    @Test
    void тот_же_статус_в_работе_тоже_без_остатка_прежней_блокировки() {
        String s = script("🔄 IN PROGRESS", "🔄 IN PROGRESS");
        assertFalse(s.contains("status_reason"), s);
    }

    @Test
    void та_же_блокировка_причину_сохраняет() {
        assertTrue(script("🔴 BLOCKED", "🔴 BLOCKED").contains("status_reason"));
        assertTrue(script("⏳ WAITING", "⏳ WAITING").contains("waiting_for"));
    }
}
