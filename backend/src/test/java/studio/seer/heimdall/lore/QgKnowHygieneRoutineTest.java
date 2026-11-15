package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * task:SPRINT_QG_REBUILD/QG-11, шаг 2 (SPEC-QG-JOB-CONTRACT §8): первая рутина
 * канала 2 — универсальная KNOW, гигиена записей из готовых срезов, без внешних
 * источников и без аналитика. Проверяет весь путь записи без модели.
 *
 * <p>Главное, что здесь сторожится: срез, который не ответил, — это «не измерено»
 * с причиной, а не PASS с нулём находок. Ноль, полученный из упавшего запроса,
 * и есть тот самый молчаливый SKIP, против которого перестраивается QG.
 */
class QgKnowHygieneRoutineTest {

    private static final Instant NOW = Instant.parse("2026-11-14T12:00:00Z");

    private static QgRoutine.RawFact fact(String slice, Integer findings) {
        return new QgRoutine.RawFact(slice, findings, "slice:" + slice);
    }

    private static LoreQgResource.QGMetricEntry metric(List<LoreQgResource.QGMetricEntry> ms, String key) {
        return ms.stream().filter(m -> m.key().equals(key)).findFirst().orElse(null);
    }

    @Test
    void zeroFindingsIsPassAndFindingsAreWarnWithTheirCount() {
        List<LoreQgResource.QGMetricEntry> ms = QgKnowHygieneRoutine.normalizeFacts(List.of(
            fact("history_hygiene", 0), fact("scope_orphans", 3)));

        LoreQgResource.QGMetricEntry clean = metric(ms, "know_history_hygiene");
        assertNotNull(clean, "метрика называется know_<срез>: " + ms);
        assertEquals("PASS", clean.status());
        assertEquals(0.0, clean.value());
        assertEquals(0.0, clean.target(), "цель гигиены — ноль находок");
        assertEquals("slice:history_hygiene", clean.source());

        LoreQgResource.QGMetricEntry dirty = metric(ms, "know_scope_orphans");
        assertEquals("WARN", dirty.status());
        assertEquals(3.0, dirty.value(), "в метрике число находок, а не только факт их наличия");
    }

    @Test
    void unansweredSliceIsNotMeasuredWithReasonAndNeverPass() {
        List<LoreQgResource.QGMetricEntry> ms = QgKnowHygieneRoutine.normalizeFacts(List.of(
            fact("entities_without_project", null)));
        LoreQgResource.QGMetricEntry m = metric(ms, "know_entities_without_project");
        assertEquals("NOT_MEASURED", m.status(), "упавший срез не может стать нулём находок");
        assertEquals("source_unreachable", m.not_measured_reason());
        assertNull(m.value(), "нет измерения — нет числа");
    }

    @Test
    void everyDeclaredSliceIsARegisteredSlice() {
        assertFalse(QgKnowHygieneRoutine.SLICES.isEmpty());
        for (String id : QgKnowHygieneRoutine.SLICES)
            assertNotNull(LoreSlices.get(id), "рутина ссылается на несуществующий срез " + id
                + " — ровно та болезнь, из-за которой перестраивается QG (QG-01)");
    }

    @Test
    void routineContractAndWriterAcceptEveryOutcome() {
        QgKnowHygieneRoutine r = new QgKnowHygieneRoutine();
        assertEquals("qg-know-hygiene", r.name());
        assertEquals(Duration.ofDays(1), r.cadence());

        // Полный путь записи через обёртку попытки: каждая строка проходит контракт сервера.
        List<LoreQgResource.QGRunRequest> written = new ArrayList<>();
        QgRoutine probe = new QgRoutine() {
            public String name() { return r.name(); }
            public Duration cadence() { return r.cadence(); }
            public Precondition check() { return Precondition.ok(); }
            public List<RawFact> collect() {
                return List.of(fact("history_hygiene", 0), fact("scope_orphans", 2), fact("question_hygiene", null));
            }
            public List<LoreQgResource.QGMetricEntry> normalize(List<RawFact> raw) { return r.normalize(raw); }
        };
        String st = QgAttemptRunner.run(probe, req -> {
            assertNull(LoreQgRunWriter.validate(req), "сервер отверг бы запись: " + req);
            written.add(req);
        }, NOW);
        assertEquals("WARN", st, "худший среди измеренных; неизмеренное статус не смягчает и не портит");
        assertTrue(written.size() >= 2, "попытка RUNNING и закрытие: " + written);
    }
}
