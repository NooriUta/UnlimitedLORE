package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Дефект препрода 21.11.2026 (8877957a): паспорт релиза открылся по ссылке «v1.17.25» — «запись не найдена».
 * Ключ записи релиза — release_uid «проект#тег», а ссылки на релиз из спринта и ADR несли release_id — голый тег.
 * Два слоя: ссылки несут release_uid (подпись — тег); сервер записи принимает и голый тег — однозначный открывает,
 * неоднозначный отвечает списком кандидатов.
 */
class ReleaseLinkUidTest {

    private static final String UID = "NooriUta/UnlimitedLORE#v1.17.25";

    @Test
    void sprintReleasesAreChipsByUidLabelledByTag() {
        Map<String, Object> row = new HashMap<>();
        row.put("sprint_id", "S");
        row.put("release_uids", List.of(UID, "AIDA/aida-root#v2.0.0"));
        row.put("release_ids", List.of("v1.17.25", "v2.0.0"));
        Object v = LoreRecordValues.values("sprint", row).get("releases");
        assertEquals(2, ((List<?>) v).size());
        @SuppressWarnings("unchecked") Map<String, Object> first = ((List<Map<String, Object>>) v).get(0);
        assertEquals(UID, first.get("id"));
        assertEquals("v1.17.25", first.get("label"));
    }

    @Test
    void adrReleaseLinkCarriesUidAndTagTitle() {
        Map<String, Object> row = new HashMap<>();
        row.put("release_uids", List.of(UID));
        Map<String, Object> link = LoreRecordValues.rowLinks("adr", row).stream()
            .filter(l -> "release".equals(l.get("type"))).findFirst().orElseThrow();
        assertEquals(UID, link.get("id"));
        assertEquals("v1.17.25", link.get("title"), "подпись — тег, не ключ целиком");
    }

    /** Сторож: ни одна связь вида release не берёт значение из колонки тегов (release_id). */
    @Test
    void noReleaseLinkReadsTagColumn() {
        for (Map.Entry<String, List<LoreRecordFrom.LinkFrom>> e : LoreRecordFrom.ROW_LINKS.entrySet())
            for (LoreRecordFrom.LinkFrom l : e.getValue())
                if ("release".equals(l.type()))
                    assertTrue(l.column().contains("uid"), e.getKey() + ": связь с релизом из колонки " + l.column());
        for (Map.Entry<String, List<LoreRecordFrom.SliceLink>> e : LoreRecordFrom.SLICE_LINKS.entrySet())
            for (LoreRecordFrom.SliceLink s : e.getValue())
                if ("release".equals(s.type()))
                    assertEquals("release_uid", s.id().columns().get(0), e.getKey() + "." + s.key());
        for (String slice : List.of("sprints", "sprint_tree", "adr", "component_sprints"))
            assertTrue(LoreSlices.get(slice).baseSql().contains("release_uid AS release_uids"), slice + ": ключи релизов для ссылок");
    }

    @Test
    void bareTagIsAllowedAndResolved() {
        assertTrue(LoreRecordResource.idAllowed("release", "v1.17.25"), "старые ссылки и закладки с голым тегом");
        assertTrue(LoreRecordResource.idAllowed("release", UID));
        assertFalse(LoreRecordResource.idAllowed("release", "v1' OR 1=1"));
        LoreRecordResource.TagMatch one = LoreRecordResource.releaseByTag(List.of(Map.of("release_uid", UID)));
        assertEquals(UID, one.uid());
        LoreRecordResource.TagMatch many = LoreRecordResource.releaseByTag(List.of(
            Map.of("release_uid", UID), Map.of("release_uid", "AIDA/aida-root#v1.17.25")));
        assertNull(many.uid());
        assertEquals(List.of(UID, "AIDA/aida-root#v1.17.25"), many.candidates());
        LoreRecordResource.TagMatch none = LoreRecordResource.releaseByTag(List.of());
        assertNull(none.uid());
        assertEquals(List.of(), none.candidates());
    }
}
