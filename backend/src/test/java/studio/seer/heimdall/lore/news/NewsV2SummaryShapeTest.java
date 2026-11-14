package studio.seer.heimdall.lore.news;

import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_MINILORE_POLISH/PL-4 — форма GET /lore/news/summary: только {@code metrics} (с дельтой
 * к прошлому периоду) и {@code meta} из того же {@link NewsV2Engine#compute}, без своих подсчётов.
 */
class NewsV2SummaryShapeTest {

    @Test
    void толькоMetricsИMeta_изТогоЖеДвижка() {
        Map<String, Object> full = NewsV2EngineFixtureTest.engine().compute(NewsV2DaysContractTest.query("project", 6, null));
        Map<String, Object> s = NewsV2Engine.summary(full, "week");
        assertEquals(Set.of("metrics", "meta"), s.keySet(), "events/groups/days/matrix в сводке не отдаются");
        assertSame(full.get("metrics"), s.get("metrics"), "metrics — ровно те, что у v2, без пересчёта");
        @SuppressWarnings("unchecked") Map<String, Object> metrics = (Map<String, Object>) s.get("metrics");
        assertTrue(metrics.containsKey("delta"), "дельта к прошлому периоду");
        @SuppressWarnings("unchecked") Map<String, Object> meta = (Map<String, Object>) s.get("meta");
        assertEquals(NewsV2Engine.FORM_VERSION, meta.get("form_version"));
        assertEquals("week", meta.get("summary_period"));
        assertTrue(meta.containsKey("period"), "границы окна — как у v2");
    }
}
