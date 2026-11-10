package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.*;
import java.util.function.BiFunction;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S7A_NEWS/S7A-09 — бюджет запросов ленты /lore/news/v2 (ревью 10.11).
 *
 * <p>Боль: на одну ленту уходило 30 SQL, и тяжёлые из них — без фильтра периода:
 * срез {@code all_tasks} вёз {@code note_md} всех задач корпуса, {@code sprints} —
 * {@code context_md}; история статуса читалась по всем 6 типам целиком, индекс
 * авторов — по всем 12 Hist-цепочкам целиком, хотя ленте нужны только версии
 * окна [начало предыдущего периода, t1) и только типы, у которых есть события.
 *
 * <p>Что держит тест (без БД, на записывающей функции запроса):
 * <ul>
 *   <li>сборщик не читает тела (note_md, context_md) и роли задач;</li>
 *   <li>история статуса и индекс авторов читают только типы ленты и только окно;</li>
 *   <li>окно = начало предыдущего периода (дельта §7.5), то же, что у сборщика;</li>
 *   <li>всего запросов на ленту — не больше 23 (было 30).</li>
 * </ul>
 *
 * <p>История задач (KnowTaskHist) остаётся целиком намеренно: возраст ожидания
 * (§7.2, эпизоды READY) и сверка §10.2 требуют версий до окна и после t1.
 */
class LoreNewsV2QueryBudgetTest {

    static final Instant T0 = Instant.parse("2026-10-31T21:00:00Z"), T1 = Instant.parse("2026-11-07T21:00:00Z");
    static final ZoneId ZONE = ZoneId.of("Europe/Moscow");

    record Call(String sql, Map<String, Object> params) {}

    static BiFunction<String, Map<String, Object>, List<Map<String, Object>>> recorder(List<Call> calls) {
        return (sql, p) -> { calls.add(new Call(sql, p == null ? Map.of() : p)); return List.of(); };
    }

    static String histOf(String sql) {
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("FROM (Know\\w+Hist)").matcher(sql);
        return m.find() ? m.group(1) : null;
    }

    @Test
    void collectorDoesNotReadBodiesOrRoles() {
        List<Call> calls = new ArrayList<>();
        new LoreNewsV2Collector(recorder(calls)).collect(T0, T1, T1, ZONE, null);
        for (Call c : calls) {
            assertFalse(c.sql().contains("note_md"), "лента не читает note_md задач: " + c.sql());
            assertFalse(c.sql().contains("context_md"), "лента не читает context_md спринтов: " + c.sql());
            assertFalse(c.sql().contains("ROLE_HELD_BY"), "лента не читает роли задач: " + c.sql());
        }
    }

    @Test
    void windowStartsAtThePreviousPeriod() {
        // 7 дней → предыдущие 7 дней; сутки и короче → неделя назад (§7.5); 3 дня → 3 дня назад
        assertEquals(T0.minus(Duration.ofDays(7)), LoreNewsV2Collector.windowStart(T0, T1));
        Instant d0 = Instant.parse("2026-11-07T21:00:00Z"), d1 = Instant.parse("2026-11-08T21:00:00Z");
        assertEquals(d0.minus(Duration.ofDays(7)), LoreNewsV2Collector.windowStart(d0, d1));
        Instant e0 = Instant.parse("2026-11-04T21:00:00Z");
        assertEquals(e0.minus(Duration.ofDays(3)), LoreNewsV2Collector.windowStart(e0, T1));
    }

    @Test
    void statusTimelineReadsOnlyFeedTypesAndOnlyTheWindow() {
        List<Call> calls = new ArrayList<>();
        Instant from = LoreNewsV2Collector.windowStart(T0, T1);
        StatusHistoryTimeline.load(recorder(calls), LoreNewsV2Resource.FEED_TYPES, from, T1);
        Set<String> hist = new TreeSet<>();
        for (Call c : calls) {
            hist.add(histOf(c.sql()));
            assertTrue(c.sql().contains("date(:from)") && c.sql().contains("date(:to)"), "окно в SQL: " + c.sql());
            assertEquals(from.toString(), c.params().get("from"), "начало окна — параметром: " + c.params());
            assertEquals(T1.toString(), c.params().get("to"), "конец окна — параметром: " + c.params());
        }
        assertEquals(new TreeSet<>(List.of("KnowADRHist", "KnowDecisionHist", "KnowSpecHist", "KnowSprintHist", "KnowTaskHist")),
            hist, "фазы в ленте нет — их история не читается");
    }

    @Test
    void authorIndexReadsOnlyFeedChainsAndOnlyTheWindowWithTolerance() {
        List<Call> calls = new ArrayList<>();
        Instant from = LoreNewsV2Collector.windowStart(T0, T1);
        HistAuthorIndex.load(recorder(calls), LoreNewsV2Resource.FEED_TYPES, from, T1);
        Set<String> hist = new TreeSet<>();
        for (Call c : calls) {
            hist.add(histOf(c.sql()));
            assertTrue(c.sql().contains("valid_from >= date(:from)") && c.sql().contains("valid_from <= date(:to)"),
                "окно в SQL: " + c.sql());
            assertEquals(from.minusMillis(HistAuthorIndex.TOLERANCE_MS).toString(), c.params().get("from"));
            assertEquals(T1.plusMillis(HistAuthorIndex.TOLERANCE_MS).toString(), c.params().get("to"));
        }
        assertEquals(new TreeSet<>(List.of("KnowADRHist", "KnowDecisionHist", "KnowReleaseHist", "KnowSpecHist",
            "KnowSprintHist", "KnowTaskHist")), hist, "доки, находки, вехи, фазы, ранбуки, словарь — не события ленты");
    }

    @Test
    void windowedIndexStillAttributesAnEventInsideTheWindow() {
        Instant at = Instant.parse("2026-11-03T10:00:00Z");
        HistAuthorIndex idx = HistAuthorIndex.load((sql, p) -> sql.contains("KnowTaskHist")
            ? List.of(Map.of("ref_id", "S1/T-1", "valid_from", "2026-11-03T10:00:00.400Z",
                "changed_by", "sub-1", "changed_by_kind", ChangeAuthor.KIND_HUMAN))
            : List.of(), LoreNewsV2Resource.FEED_TYPES, LoreNewsV2Collector.windowStart(T0, T1), T1);
        assertEquals("sub-1", idx.authorOf("task", "S1/T-1", at).by());
        assertEquals(Boolean.FALSE, idx.authorOf("task", "S1/T-1", at).agent());
    }

    @Test
    void oneFeedCostsAtMost23Queries() {
        List<Call> calls = new ArrayList<>();
        Instant from = LoreNewsV2Collector.windowStart(T0, T1);
        new LoreNewsV2Collector(recorder(calls)).collect(T0, T1, T1, ZONE, null);
        StatusHistoryTimeline.load(recorder(calls), LoreNewsV2Resource.FEED_TYPES, from, T1);
        HistAuthorIndex.load(recorder(calls), LoreNewsV2Resource.FEED_TYPES, from, T1);
        assertTrue(calls.size() <= 23, "запросов на ленту: " + calls.size() + " (было 30)");
    }
}
