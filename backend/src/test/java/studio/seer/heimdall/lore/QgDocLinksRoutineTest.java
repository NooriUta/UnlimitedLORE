package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_QG_REBUILD/QG-STALE-DOCS, механический уровень (без LLM): битые ссылки в документах
 * (ADR, спеки, доки, ранбуки, решения) — метрика рутины, а не только экран админки.
 *
 * <p>Источник — та же проверка, что «Привести в порядок» (PU-20, MdRefCheck): у вопроса «есть ли
 * битые ссылки» не должно быть двух ответов. Скрытое владелицей («не ссылка») не считается.
 */
class QgDocLinksRoutineTest {

    private static final Instant NOW = Instant.parse("2026-11-15T12:00:00Z");

    private static Map<String, Object> row(String type, String id, Map<String, Integer> byKind) {
        return Map.of("type", type, "id", id, "by_kind", byKind);
    }

    @Test
    void считаютсяЗаписиСБитымиСсылками_поТипу_неместа() {
        Map<String, Object> body = Map.of("manual", Map.of("rows", List.of(
            row("KnowADR", "ADR-1", Map.of("broken", 3)),
            row("KnowADR", "ADR-2", Map.of("broken", 1, "unknown", 2)),
            row("KnowADR", "ADR-3", Map.of("unknown", 1)),       // «неизвестное» — не битая ссылка
            row("KnowSpec", "SPEC-1", Map.of("broken", 1)),
            row("KnowTask", "S/T-1", Map.of("broken", 5)))));     // задачи — не документы
        Map<String, Integer> by = QgDocLinksRoutine.brokenRecordsByType(body);
        assertEquals(2, by.get("KnowADR"), "записей, а не мест: " + by);
        assertEquals(1, by.get("KnowSpec"));
        assertEquals(0, by.get("KnowDoc"), "тип без находок — ноль, а не отсутствие");
        assertFalse(by.containsKey("KnowTask"), "задачи в этой рутине не меряются");
    }

    @Test
    void нольPass_естьWarn_неОтветилаNotMeasured() {
        List<LoreQgResource.QGMetricEntry> ms = QgDocLinksRoutine.normalizeFacts(List.of(
            new QgRoutine.RawFact("KnowADR", 0, "tidy:KnowADR"),
            new QgRoutine.RawFact("KnowSpec", 4, "tidy:KnowSpec"),
            new QgRoutine.RawFact("KnowDoc", null, "tidy:KnowDoc")));
        assertEquals("PASS", ms.get(0).status());
        assertEquals("doc_broken_refs_adr", ms.get(0).key());
        assertEquals("WARN", ms.get(1).status());
        assertEquals(4.0, ms.get(1).value());
        assertEquals("NOT_MEASURED", ms.get(2).status(), "упавшая проверка — не ноль битых ссылок");
        assertEquals("source_unreachable", ms.get(2).not_measured_reason());
        assertNull(ms.get(2).value());
    }

    @Test
    void каждыйТипРутиныЕстьВПроверкеСсылок() {
        assertFalse(QgDocLinksRoutine.TYPES.isEmpty());
        for (String t : QgDocLinksRoutine.TYPES)
            assertTrue(LoreTidyResource.TARGETS.stream().anyMatch(x -> x.type().equals(t)),
                "рутина меряет тип " + t + ", которого проверка ссылок не читает (QG-01: ссылка на несуществующее)");
    }

    @Test
    void контрактРутиныИЗаписьПрогона() {
        QgDocLinksRoutine r = new QgDocLinksRoutine();
        assertEquals("qg-doc-links", r.name());
        assertEquals(Duration.ofDays(1), r.cadence());
        List<LoreQgResource.QGRunRequest> written = new ArrayList<>();
        QgRoutine probe = new QgRoutine() {
            public String name() { return r.name(); }
            public Duration cadence() { return r.cadence(); }
            public Precondition check() { return Precondition.ok(); }
            public List<RawFact> collect() {
                return List.of(new RawFact("KnowADR", 0, "tidy:KnowADR"), new RawFact("KnowSpec", 2, "tidy:KnowSpec"));
            }
            public List<LoreQgResource.QGMetricEntry> normalize(List<RawFact> raw) { return r.normalize(raw); }
        };
        String st = QgAttemptRunner.run(probe, req -> {
            assertNull(LoreQgRunWriter.validate(req), "сервер отверг бы запись: " + req);
            written.add(req);
        }, NOW);
        assertEquals("WARN", st);
        assertNotNull(written.isEmpty() ? null : written.get(0));
    }
}
