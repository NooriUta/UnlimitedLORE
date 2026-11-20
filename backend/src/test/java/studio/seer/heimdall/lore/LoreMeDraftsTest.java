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
        assertNull(LoreMeDrafts.error("task", "SPRINT_X/T-1", "note_md", "текст", "2026-11-09T02:45:27.453349250Z"),
            "версия записи — строка record.version из /lore/record");
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
        assertNotNull(LoreMeDrafts.error("task", "S/T", "note_md", "x", "v".repeat(LoreMeDrafts.VERSION_MAX + 1)),
            "версия записи — короткая метка, не тело");
    }

    @Test
    void outputHidesOwnerAndCarriesWhenItWasSaved() {
        Map<String, Object> row = new HashMap<>();
        row.put("owner_sub", "kc-sub-123");
        row.put("ref_type", "task");
        row.put("ref_id", "S/T");
        row.put("field", "note_md");
        row.put("body_md", "черновик");
        row.put("base_record_version", "2026-11-09T02:45:27.453349250Z");
        row.put("base_version", 7);
        row.put("saved_at", "2026-11-08T23:50:00.000000Z");
        row.put("@rid", "#1:2");
        Map<String, Object> out = LoreMeDrafts.out(row);
        assertFalse(out.containsKey("owner_sub"), "kc_sub наружу не отдаётся");
        assertFalse(out.keySet().stream().anyMatch(k -> k.startsWith("@")), "системные поля наружу не идут");
        assertEquals("черновик", out.get("body_md"));
        assertEquals("2026-11-08T23:50:00.000000Z", out.get("saved_at"), "«Восстановить черновик от HH:MM» — время сохранения");
        assertEquals("2026-11-09T02:45:27.453349250Z", out.get("base_version"),
            "версия записи, от которой начата правка, — строкой, как record.version (S5-08 сравнивает на равенство)");
    }

    @Test
    void schemaIsAdditiveOnly() {
        for (String ddl : LoreMeDrafts.SCHEMA_SQL)
            assertTrue(ddl.contains("IF NOT EXISTS") && ddl.contains("KnowUserDraft"),
                "только новый тип и его свойства/индексы: " + ddl);
    }

    /** Kit 09.11: record.version — строка, base_version был INTEGER; S5-08 упирался в тип. */
    @Test
    void recordVersionIsStoredAsStringInANewAdditiveProperty() {
        assertTrue(LoreMeDrafts.SCHEMA_SQL_V74.stream()
                .anyMatch(d -> d.equals("CREATE PROPERTY KnowUserDraft.base_record_version IF NOT EXISTS STRING")),
            "строковая версия — новым свойством, аддитивно: " + LoreMeDrafts.SCHEMA_SQL_V74);
        assertTrue(LoreSchemaMigrations.STEPS.stream().anyMatch(s -> s.version() == 74),
            "шаг V74 зарегистрирован");
    }

    /**
     * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-08 (владелица 20.11.2026: «а) снять base_version при переносе 1.18»):
     * версия-основа черновика хранится только в base_record_version. Наружу — по-прежнему ключом
     * base_version, строкой (это имя поля API, не свойства в базе).
     */
    @Test
    void recordVersionDrivesConflictCheck() {
        Map<String, Object> row = new HashMap<>();
        row.put("ref_type", "task");
        row.put("base_record_version", "2026-11-09T02:45:27.453349250Z");
        assertEquals("2026-11-09T02:45:27.453349250Z", LoreMeDrafts.out(row).get("base_version"),
            "черновик с base_record_version отдаёт версию — клиент ловит конфликт по равенству, как раньше");
    }

    @Test
    void draftWithoutVersionHasNullVersion() {
        Map<String, Object> row = new HashMap<>();
        row.put("ref_type", "task");
        assertTrue(LoreMeDrafts.out(row).containsKey("base_version"), "ключ на месте");
        assertNull(LoreMeDrafts.out(row).get("base_version"), "версии нет — null, а не придуманная");
    }

    /** MDL-08: прежнее целое свойство base_version (в проде 0 из 3) больше не читается запасным вариантом. */
    @Test
    void legacyIntegerPropertyIsNotRead() {
        Map<String, Object> row = new HashMap<>();
        row.put("ref_type", "task");
        row.put("base_version", 7);
        assertNull(LoreMeDrafts.out(row).get("base_version"), "запасного чтения base_version больше нет");
    }

    /** MDL-08: сервер не пишет (null) и не выбирает KnowUserDraft.base_version. */
    @Test
    void resourceNeitherWritesNorSelectsLegacyProperty() throws java.io.IOException {
        String src = java.nio.file.Files.readString(java.nio.file.Path.of(
            "src", "main", "java", "studio", "seer", "heimdall", "lore", "LoreMeResource.java"),
            java.nio.charset.StandardCharsets.UTF_8);
        assertFalse(src.contains("base_version=null"), "UPDATE KnowUserDraft не пишет base_version");
        assertFalse(src.contains("body_md, base_version,"), "SELECT черновиков не читает base_version");
    }
}
