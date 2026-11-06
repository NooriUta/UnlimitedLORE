package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_BRAGI_ARCHIVE_V2/V2-05: инсайт, зафиксированный со строки ретро, несёт
 * subject_id (вариация или публикация), и срез отдаёт его — по нему строка
 * находит свой чип «инсайт → INS-xx» точным равенством, а не разбором текста
 * обоснования.
 */
class BragiInsightSubjectTest {

    @Test
    void insightsSliceCarriesSubject() {
        String sql = LoreSlices.compose("bragi_insights", Map.of()).sql();
        assertTrue(sql.contains("subject_id"), sql);
    }

    @Test
    void requestCarriesSubject() {
        var r = new LoreBragiResource.BragiInsightRequest("INS-09", "s", "2026-11-05", "e", "VAR-1");
        assertEquals("VAR-1", r.subject_id());
    }
}
