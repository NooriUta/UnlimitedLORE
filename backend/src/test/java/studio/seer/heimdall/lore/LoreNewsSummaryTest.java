package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_MINILORE_POLISH/PL-4 — «дверь» для сервера miniLORE: GET /lore/news/summary.
 * Параметры двери: period → окно v2 (day=1, week=7, month=30), чужой проект — 404.
 * Форма ответа — {@code news/NewsV2SummaryShapeTest}.
 */
class LoreNewsSummaryTest {

    @Test
    void periodМаппитсяНаОкноV2() {
        assertEquals(1, LoreNewsV2Resource.summaryDays("day"));
        assertEquals(7, LoreNewsV2Resource.summaryDays("week"));
        assertEquals(30, LoreNewsV2Resource.summaryDays("month"));
        assertEquals(7, LoreNewsV2Resource.summaryDays(null), "без period — окно v2 по умолчанию (неделя)");
        assertEquals(7, LoreNewsV2Resource.summaryDays(" WEEK "));
    }

    @Test
    void неизвестныйPeriod_нетОкна_значит400() {
        assertNull(LoreNewsV2Resource.summaryDays("year"));
        assertNull(LoreNewsV2Resource.summaryDays("7"));
        assertNull(LoreNewsV2Resource.summaryDays(""));
    }

    @Test
    void проектВнеСкоупа_404КакНеНайдено() {
        assertFalse(LoreNewsV2Resource.projectVisible(Set.of("lore"), "mini"), "чужой проект");
        assertTrue(LoreNewsV2Resource.projectVisible(Set.of("lore"), "lore"));
        assertTrue(LoreNewsV2Resource.projectVisible(null, "lore"), "скоупа нет — видно всё");
        assertTrue(LoreNewsV2Resource.projectVisible(Set.of("lore"), null), "без project — весь скоуп");
    }
}
