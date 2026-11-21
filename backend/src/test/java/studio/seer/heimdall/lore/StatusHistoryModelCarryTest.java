package studio.seer.heimdall.lore;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MIG-03 · новая версия на базе из модели. Проба на копии migration_dst_linux: смена
 * статуса упала «Duplicated key … index KnowTaskHist[mig_src_rid]» — версия переносила служебное поле переноса
 * (ключ происхождения строки, уникальный). Правило: поля происхождения переноса (mig_*) принадлежат своей строке
 * и в новую версию не идут; на базе из модели не переносятся и прежний код статуса (status) и его хвост (status_note).
 */
class StatusHistoryModelCarryTest {

    @AfterEach
    void off() { ModelSchemaAdapter.enable(false); }

    private static Map<String, Object> openRow() {
        Map<String, Object> r = new HashMap<>();
        r.put("@rid", "#1:1"); r.put("state_uid", "u0"); r.put("note_md", "заметка"); r.put("effort_days", 1.0);
        r.put("mig_src_rid", "#91:33100"); r.put("status", "PLANNED"); r.put("status_note", "хвост");
        return r;
    }

    @Test
    void смена_статуса_не_несёт_поля_переноса_и_прежний_статус() {
        ModelSchemaAdapter.enable(true);
        String sql = StatusHistoryService.plan(StatusHistoryService.KINDS.get("task"), "S/T-1", openRow(), "🔄 IN PROGRESS", null,
            null, "2026-11-18T12:00:00Z", "u1").script();
        assertFalse(sql.contains("mig_src_rid"), sql);
        assertFalse(sql.contains("status = :c_status"), sql);
        assertFalse(sql.contains("status_note = :c_status_note"), sql);
        assertTrue(sql.contains("note_md = :c_note_md"), "обычные поля по-прежнему переносятся: " + sql);
    }

    @Test
    void правка_текста_не_несёт_поля_переноса() {
        String sql = StatusHistoryService.textPlan(StatusHistoryService.KINDS.get("task"), "S/T-1", openRow(), Map.of("note_md", "новая"),
            null, "2026-11-18T12:00:00Z", "u1").script();
        assertFalse(sql.contains("mig_src_rid"), sql);
        assertTrue(sql.contains("status = :c_status"), "статус при правке текста остаётся прежним: " + sql);
    }
}
