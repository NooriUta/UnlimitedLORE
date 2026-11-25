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
        return new LoreQgResource.QGMetricEntry(key, 1.0, "count", 0.0, status, "test", null, null, null);
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
            "x", null, null, null, "NOT_MEASURED", "test", "source_missing", null, null);
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

    // ── QG-15 остаток: суждение под потолком расхода, поле model в прогоне ─────────

    /** Рутина с аналитиком: просит суждение по своим нормализованным метрикам (И-3). */
    private static QgRoutine analysedRoutine(List<LoreQgResource.QGMetricEntry> metrics) {
        QgRoutine base = routine(QgRoutine.Precondition.ok(), List.of(), metrics, null);
        return new QgRoutine() {
            public String name() { return base.name(); }
            public Duration cadence() { return base.cadence(); }
            public Precondition check() { return base.check(); }
            public List<RawFact> collect() { return base.collect(); }
            public List<LoreQgResource.QGMetricEntry> normalize(List<RawFact> r) { return base.normalize(r); }
            @Override public java.util.Optional<studio.seer.heimdall.lore.llm.LlmRequest> analystRequest(
                    List<LoreQgResource.QGMetricEntry> ms) {
                return java.util.Optional.of(studio.seer.heimdall.lore.llm.LlmRequest.of(
                    "инструкция", "метрик: " + ms.size(), 500));
            }
        };
    }

    private static studio.seer.heimdall.lore.llm.BudgetedModelCall analyst(
            studio.seer.heimdall.lore.llm.LlmAnswer answer, studio.seer.heimdall.lore.llm.LlmBudget budget,
            java.util.Optional<studio.seer.heimdall.lore.llm.LlmPrice> price) {
        return new studio.seer.heimdall.lore.llm.BudgetedModelCall(r -> answer, budget, price);
    }

    private static final studio.seer.heimdall.lore.llm.LlmAnswer QWEN_OK = studio.seer.heimdall.lore.llm.LlmAnswer.of(
        "всё в порядке", "Qwen3.5-122B-A10B", new studio.seer.heimdall.lore.llm.LlmUsage(300, 0, 200));

    @Test
    void budgetExhaustedJudgmentKeepsMetricsAndNamesTheReason() {
        Sink s = new Sink();
        // цена модели неизвестна — суждение не вызывается вовсе (умолчание 1 спеки §4)
        String st = QgAttemptRunner.run(analysedRoutine(List.of(m("a", "WARN"))), s, NOW,
            analyst(QWEN_OK, new studio.seer.heimdall.lore.llm.LlmBudget(1000L, null), java.util.Optional.empty()));
        assertEquals("WARN", st, "статус — по метрикам: бюджет обрывает только суждение");
        LoreQgResource.QGRunRequest done = s.written.get(1);
        assertEquals(2, done.metrics().size(), "метрики записаны, плюс строка суждения");
        LoreQgResource.QGMetricEntry j = done.metrics().get(1);
        assertEquals(QgAttemptRunner.JUDGMENT_KEY, j.key());
        assertEquals("NOT_MEASURED", j.status());
        assertEquals("budget_exhausted", j.not_measured_reason());
        assertTrue(done.flags() != null && done.flags().contains("price_unknown"), done.flags());
        assertNull(done.model(), "модель не отвечала — модели в прогоне нет");
    }

    @Test
    void answeredJudgmentWritesTheModelThatActuallyAnswered() {
        Sink s = new Sink();
        String st = QgAttemptRunner.run(analysedRoutine(List.of(m("a", "PASS"))), s, NOW,
            analyst(QWEN_OK, new studio.seer.heimdall.lore.llm.LlmBudget(10_000L, null),
                java.util.Optional.of(new studio.seer.heimdall.lore.llm.LlmPrice(0, 0, 0))));
        assertEquals("PASS", st, "суждение не меняет статус по метрикам");
        LoreQgResource.QGRunRequest done = s.written.get(1);
        assertEquals("Qwen3.5-122B-A10B", done.model(), "поле model прогона — та модель, что ответила");
        LoreQgResource.QGMetricEntry j = done.metrics().get(1);
        assertEquals(QgAttemptRunner.JUDGMENT_KEY, j.key());
        assertEquals(500.0, j.value(), "значение строки суждения — израсходованные токены");
        assertEquals("Qwen3.5-122B-A10B", j.model());
    }

    @Test
    void unavailableModelIsSourceUnreachableNotBudget() {
        Sink s = new Sink();
        QgAttemptRunner.run(analysedRoutine(List.of(m("a", "PASS"))), s, NOW,
            analyst(studio.seer.heimdall.lore.llm.LlmAnswer.unavailable("модель вне окна 21:00–08:00"),
                new studio.seer.heimdall.lore.llm.LlmBudget(10_000L, null),
                java.util.Optional.of(new studio.seer.heimdall.lore.llm.LlmPrice(0, 0, 0))));
        LoreQgResource.QGMetricEntry j = s.written.get(1).metrics().get(1);
        assertEquals("NOT_MEASURED", j.status());
        assertEquals("source_unreachable", j.not_measured_reason());
    }

    @Test
    void routineWithoutAnalystNeverCallsTheModelAndLeavesModelEmpty() {
        Sink s = new Sink();
        int[] calls = {0};
        studio.seer.heimdall.lore.llm.BudgetedModelCall a = new studio.seer.heimdall.lore.llm.BudgetedModelCall(
            r -> { calls[0]++; return QWEN_OK; },
            new studio.seer.heimdall.lore.llm.LlmBudget(10_000L, null),
            java.util.Optional.of(new studio.seer.heimdall.lore.llm.LlmPrice(0, 0, 0)));
        QgAttemptRunner.run(routine(QgRoutine.Precondition.ok(), List.of(), List.of(m("a", "PASS")), null), s, NOW, a);
        assertEquals(0, calls[0]);
        assertEquals(1, s.written.get(1).metrics().size(), "строки суждения нет — суждения не было по замыслу");
        assertNull(s.written.get(1).model(), "пустое поле model осмысленно: у рутины нет аналитика");
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
