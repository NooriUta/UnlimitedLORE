package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S5_RECORD_TASKS/S5-09 — черновик правки на сервере. Чистая часть:
 * проверка запроса, форма ответа, DDL (только новый тип — аддитивно для v1).
 */
class LoreMeDraftsTest {

    @Test
    void validRequestPasses() {
        assertNull(LoreMeDrafts.error("task", "SPRINT_X/T-1", "note_md", "текст", 3));
        assertNull(LoreMeDrafts.error("adr", "ADR-LORE-048", "decision_md", "", null),
            "пустой черновик допустим — человек мог стереть всё");
    }

    @Test
    void badFieldsAreRefusedWithReason() {
        assertNotNull(LoreMeDrafts.error("task", "S/T", "note md; DROP", "x", null), "имя поля — идентификатор");
        assertNotNull(LoreMeDrafts.error("task", "S/T", null, "x", null));
        assertNotNull(LoreMeDrafts.error("task", "S/T", "note_md", null, null), "тело обязательно (пусть пустое)");
        assertNotNull(LoreMeDrafts.error("bad type!", "S/T", "note_md", "x", null));
        String big = "a".repeat(LoreMeDrafts.BODY_MAX + 1);
        String err = LoreMeDrafts.error("task", "S/T", "note_md", big, null);
        assertNotNull(err);
        assertTrue(err.contains(String.valueOf(LoreMeDrafts.BODY_MAX)), "причина называет предел: " + err);
        assertNotNull(LoreMeDrafts.error("task", "S/T", "note_md", "x", -1), "версия записи не отрицательна");
    }

    @Test
    void outputHidesOwnerAndCarriesWhenItWasSaved() {
        Map<String, Object> row = new HashMap<>();
        row.put("owner_sub", "kc-sub-123");
        row.put("ref_type", "task");
        row.put("ref_id", "S/T");
        row.put("field", "note_md");
        row.put("body_md", "черновик");
        row.put("base_version", 7);
        row.put("saved_at", "2026-11-08T23:50:00.000000Z");
        row.put("@rid", "#1:2");
        Map<String, Object> out = LoreMeDrafts.out(row);
        assertFalse(out.containsKey("owner_sub"), "kc_sub наружу не отдаётся");
        assertFalse(out.keySet().stream().anyMatch(k -> k.startsWith("@")), "системные поля наружу не идут");
        assertEquals("черновик", out.get("body_md"));
        assertEquals("2026-11-08T23:50:00.000000Z", out.get("saved_at"), "«Восстановить черновик от HH:MM» — время сохранения");
        assertEquals(7, out.get("base_version"), "версия записи, от которой начата правка");
    }

    @Test
    void schemaIsAdditiveOnly() {
        for (String ddl : LoreMeDrafts.SCHEMA_SQL)
            assertTrue(ddl.contains("IF NOT EXISTS") && ddl.contains("KnowUserDraft"),
                "только новый тип и его свойства/индексы: " + ddl);
    }
}
