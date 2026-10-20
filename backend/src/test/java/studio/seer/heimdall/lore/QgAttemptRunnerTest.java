package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPEC-QG-JOB-CONTRACT §3 (task:SPRINT_QG_REBUILD/QG-11, шаг 1): попытка пишется
 * ДО работы и закрывается одной из концовок. Корень исходного дефекта — рутина,
 * которая не стартовала или упала, не оставляла следа; тишина читалась как
 * зелень 56 дней.
 *
 * <p>Каждая записанная строка обязана проходить контракт записи
 * ({@link LoreQgRunWriter#validate}) — иначе обёртка писала бы то, что сервер
 * отвергнет, и попытка исчезала бы снова, только уже на нашей стороне.
 */
class QgAttemptRunnerTest {

    private static final Instant NOW = Instant.parse("2026-10-20T10:00:00Z");

    private static final class Sink implements QgAttemptRunner.Sink {
        final List<LoreQgResource.QGRunRequest> written = new ArrayList<>();
        @Override public void write(LoreQgResource.QGRunRequest r) {
            assertNull(LoreQgRunWriter.validate(r), "обёртка записала то, что сервер отвергнет: " + r);
            written.add(r);
        }
    }

    private static QgRoutine routine(QgRoutine.Precondition pre, List<QgRoutine.RawFact> raw,
                                     List<LoreQgResource.QGMetricEntry> metrics, RuntimeException boom) {
        return new QgRoutine() {
            public String name() { return "qg-probe"; }
            public Duration cadence() { return Duration.ofDays(1); }
            public Precondition check() { return pre; }
            public List<RawFact> collect() { if (boom != null) throw boom; return raw; }
            public List<LoreQgResource.QGMetricEntry> normalize(List<RawFact> r) { return metrics; }
        };
    }

    private static LoreQgResource.QGMetricEntry m(String key, String status) {
        return new LoreQgResource.QGMetricEntry(key, 1.0, "count", 0.0, status, "test", null, null);
    }

    @Test
    void attemptIsWrittenBeforeWorkAndClosedWithWorstMeasuredStatus() {
        Sink s = new Sink();
        String st = QgAttemptRunner.run(routine(QgRoutine.Precondition.ok(), List.of(),
            List.of(m("a", "PASS"), m("b", "WARN"), m("c", "PASS")), null), s, NOW);
        assertEquals("WARN", st);
        assertEquals(2, s.written.size());
        assertEquals("RUNNING", s.written.get(0).status(), "первой записью идёт попытка");
        assertEquals("app_job", s.written.get(0).channel());
        assertEquals(s.written.get(0).run_id(), s.written.get(1).run_id(), "закрывается та же попытка");
        assertEquals("WARN", s.written.get(1).status());
        assertEquals(3, s.written.get(1).metrics().size());
    }

    @Test
    void notMeasuredMetricsDoNotSoftenTheVerdict() {
        Sink s = new Sink();
        LoreQgResource.QGMetricEntry nm = new LoreQgResource.QGMetricEntry(
            "x", null, null, null, "NOT_MEASURED", "test", "source_missing", null);
        String st = QgAttemptRunner.run(routine(QgRoutine.Precondition.ok(), List.of(),
            List.of(m("a", "FAIL"), nm), null), s, NOW);
        assertEquals("FAIL", st, "худший среди ИЗМЕРЕННЫХ");
    }

    @Test
    void nothingMeasuredIsNotMeasuredNotPass() {
        Sink s = new Sink();
        String st = QgAttemptRunner.run(routine(QgRoutine.Precondition.ok(), List.of(), List.of(), null), s, NOW);
        assertEquals("NOT_MEASURED", st, "ноль метрик — не зелень");
    }

    @Test
    void failedPreconditionIsNotMeasuredWithTypedReason() {
        Sink s = new Sink();
        String st = QgAttemptRunner.run(routine(QgRoutine.Precondition.notMeasured("source_unreachable"),
            null, null, null), s, NOW);
        assertEquals("NOT_MEASURED", st);
        LoreQgResource.QGMetricEntry pre = s.written.get(1).metrics().get(0);
        assertEquals("precondition", pre.key());
        assertEquals("source_unreachable", pre.not_measured_reason());
    }

    @Test
    void exceptionClosesTheAttemptAsFailWithClassAndFirstLine() {
        Sink s = new Sink();
        String st = QgAttemptRunner.run(routine(QgRoutine.Precondition.ok(), null, null,
            new IllegalStateException("база не ответила\nвторая строка")), s, NOW);
        assertEquals("FAIL", st);
        String flags = s.written.get(1).flags();
        assertTrue(flags.contains("IllegalStateException") && flags.contains("база не ответила"), flags);
        assertTrue(!flags.contains("вторая строка"), "в флаги идёт только первая строка: " + flags);
    }

    @Test
    void supervisorAbortsOnlyRunsOlderThanTwoCadences() {
        List<Map<String, Object>> running = List.of(
            Map.of("run_id", "old", "routine_name", "qg-probe", "started_at", "2026-10-18T09:00:00Z"),
            Map.of("run_id", "fresh", "routine_name", "qg-probe", "started_at", "2026-10-19T12:00:00Z"),
            Map.of("run_id", "orphan", "routine_name", "qg-gone", "started_at", "2026-10-17T00:00:00Z"));
        List<String> abort = QgAttemptRunner.hungRuns(running,
            Map.of("qg-probe", Duration.ofDays(1)), NOW);
        assertEquals(List.of("old", "orphan"), abort,
            "старше 2× каденции — зависла; рутины больше нет — по умолчанию 48 ч");
    }
}
