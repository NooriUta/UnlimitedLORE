package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-10 (D-2026-LORE-FREE-FIELDS-SHOWN): значение записи, которого нет
 * среди полей модели, не теряется и не прячется — паспорт отдаёт его блоком {@code unmodeled}.
 * Здесь — отбор: что из свойств вершины считается «вне модели».
 */
class LoreRecordUnmodeledTest {

    static Map<String, Object> vertex(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    @Test
    void propertyOutsideModelIsReturnedWithItsValue() {
        Map<String, Object> u = LoreRecordUnmodeled.of("sprint", vertex(
            "sprint_id", "SPRINT_X", "name", "Спринт", "wow_factor", 7, "legacy_note", "осталось от старой доски"));
        assertEquals(7, u.get("wow_factor"));
        assertEquals("осталось от старой доски", u.get("legacy_note"));
    }

    @Test
    void modelFieldsKeyServiceAndInternalPropertiesAreNotUnmodeled() {
        Map<String, Object> u = LoreRecordUnmodeled.of("sprint", vertex(
            "@rid", "#1:2", "@type", "KnowSprint",
            "sprint_id", "SPRINT_X",            // ключ записи
            "name", "Спринт",                   // поле модели title через псевдоним
            "content_hash", "abc", "state_uid", "s1", "valid_to", null, // служебные
            "changed_by", "кто-то", "status_category", "active", "source_commit", "deadbeef", // внутренние
            "something_uid", "x",               // внутренний ключ
            "wow_factor", 7));
        assertEquals(List.of("wow_factor"), List.copyOf(u.keySet()), "положительный контроль: осталось только настоящее «вне модели»");
    }

    @Test
    void serviceFieldsOfTheApprovedListNeverAppear() {
        // Находка со стенда 16.11.2026: у любого спринта на вершине есть updated_at — блок показал бы его
        // у каждой записи. По решению служебные поля в блок не попадают.
        Map<String, Object> props = vertex("sprint_id", "SPRINT_X", "branch_ref", "feature/x");
        for (String s : LoreRecordUnmodeled.SERVICE) props.put(s, "2026-11-16T00:00:00Z");
        // KREG-10 (владелец 25.11.2026): перечень теперь — service_fields модели, единый список служебных колонок;
        // утверждённые 19 (четырнадцать 15.11 + сессия, harness с пометкой сверки и машина правки 16.11 + причина
        // правки WK-01 20.11) обязаны в нём остаться — размер больше не закрепляется.
        for (String approved : List.of("valid_from", "valid_to", "state_uid", "content_hash", "changed_by", "changed_by_kind",
                "changed_by_session", "changed_by_harness", "changed_by_harness_note", "changed_by_machine", "change_reason",
                "status_category", "status_known_from", "status_backfilled", "source_commit", "hist_for", "created_at",
                "updated_at", "origin"))
            assertTrue(LoreRecordUnmodeled.SERVICE.contains(approved), "утверждённое служебное поле выпало из списка: " + approved);
        assertEquals(List.of("branch_ref"), List.copyOf(LoreRecordUnmodeled.of("sprint", props).keySet()));
    }

    @Test
    void emptyValuesAreSkippedAndKeysAreSorted() {
        Map<String, Object> u = LoreRecordUnmodeled.of("sprint", vertex(
            "zeta", "z", "alpha", "a", "empty_text", "  ", "empty_list", List.of(), "nothing", null));
        assertEquals(List.of("alpha", "zeta"), List.copyOf(u.keySet()));
    }

    @Test
    void longTextIsCutSoThatPassportDoesNotCarryABody() {
        Map<String, Object> u = LoreRecordUnmodeled.of("sprint", vertex("old_body_md", "я".repeat(5000)));
        String v = (String) u.get("old_body_md");
        assertTrue(v.length() <= LoreRecordUnmodeled.MAX_TEXT + 1 && v.endsWith("…"), "длинный текст обрезан: " + v.length());
    }

    @Test
    void typesAboutPeopleAreNotRead() {
        // У человека, агента и роли вне модели могут лежать персональные сведения: блок для них не отдаётся,
        // пока видимость на уровне поля не описана в модели.
        for (String t : List.of("user", "agent", "actor")) {
            assertFalse(LoreRecordUnmodeled.reads(t), t);
            assertTrue(LoreRecordUnmodeled.of(t, vertex("email", "a@b.c")).isEmpty(), t);
        }
        assertTrue(LoreRecordUnmodeled.reads("sprint"));
    }

    @Test
    void queryReadsTheVertexOfTheTypeByItsKey() {
        assertEquals("SELECT FROM KnowSprint WHERE sprint_id = :id LIMIT 1", LoreRecordUnmodeled.sql("sprint"));
        assertNull(LoreRecordUnmodeled.sql("user"), "тип не читается — запроса нет");
    }

    @Test
    void legacyRoleStringsOfTaskStayInternal() {
        Map<String, Object> props = vertex("task_uid", "S/T1", "wow", 1);
        for (String legacy : LoreModelTypes.LEGACY_ROLE_STRINGS) props.put(legacy, "кто-то");
        assertFalse(LoreModelTypes.LEGACY_ROLE_STRINGS.isEmpty(), "положительный контроль: старые строки ролей в модели названы");
        assertEquals(List.of("wow"), List.copyOf(LoreRecordUnmodeled.of("task", props).keySet()));
    }
}
