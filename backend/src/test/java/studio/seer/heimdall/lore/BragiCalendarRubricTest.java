package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_BRAGI_ARCHIVE_V2/V2-06: ретро группируется по рубрике, а рубрика живёт
 * на публикации (IN_RUBRIC), не на вариации — срез календаря обязан её отдавать.
 */
class BragiCalendarRubricTest {
    @Test
    void calendarCarriesPublicationRubric() {
        String sql = LoreSlices.compose("bragi_calendar", Map.of()).sql();
        assertTrue(sql.contains("in('HAS_VARIANT').out('IN_RUBRIC').name AS rubric_names"), sql);
    }
}
