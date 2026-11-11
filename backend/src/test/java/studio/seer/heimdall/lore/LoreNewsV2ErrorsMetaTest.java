package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;
import studio.seer.heimdall.lore.news.NewsV2;
import studio.seer.heimdall.lore.news.NewsV2Engine;

import java.time.Instant;
import java.time.ZoneId;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S10_SEIDR_KIT_2/K2-FEED-VIEW §6: {@code meta.errors[]} ленты различает
 * «нет прав» и «не смогли прочитать» и говорит, К КАКОМУ ВРЕМЕНИ относится провал.
 *
 * <p>kit рисует пропуск в ленте своим местом по времени ({@code at}) и словами
 * «нет прав» ({@code forbidden}) — но только если сервер это назвал: по тексту
 * причины признак не угадывается. Оба поля необязательные: старый ответ без них
 * остаётся валидным, и у обычного сбоя {@code forbidden} не появляется вовсе.
 */
class LoreNewsV2ErrorsMetaTest {

    static final Instant T0 = Instant.parse("2026-10-31T21:00:00Z"), T1 = Instant.parse("2026-11-07T21:00:00Z");
    static final Instant NOW = Instant.parse("2026-11-07T20:15:00Z");
    static final ZoneId MSK = ZoneId.of("Europe/Moscow");

    private static NewsV2.SourceError errorOf(NewsV2.Input in, String source) {
        return in.errors().stream().filter(e -> e.source().equals(source)).findFirst()
            .orElseThrow(() -> new AssertionError("нет ошибки источника " + source + ": " + in.errors()));
    }

    @Test
    void refusalByRightsIsForbiddenAndCarriesTheMomentOfTheRead() {
        LoreNewsV2Collector c = new LoreNewsV2Collector((sql, p) -> {
            if (sql.equals(LoreNewsV2Collector.SQL_TASK_HIST))
                throw new IllegalStateException("[LORE QUERY] denied", new LoreExceptions.Forbidden("нет прав на историю задач"));
            return List.of();
        });
        NewsV2.SourceError e = errorOf(c.collect(T0, T1, NOW, MSK, null), "task_history");
        assertTrue(e.forbidden(), "отказ по правам — forbidden");
        assertEquals(NOW, e.at(), "провал относится к моменту чтения");
    }

    @Test
    void http403FromUpstreamIsForbiddenToo() {
        LoreNewsV2Collector c = new LoreNewsV2Collector((sql, p) -> {
            if (sql.equals(LoreNewsV2Collector.SQL_RELEASES))
                throw new IllegalStateException("[LORE QUERY] 403",
                    new jakarta.ws.rs.WebApplicationException(jakarta.ws.rs.core.Response.status(403).build()));
            return List.of();
        });
        assertTrue(errorOf(c.collect(T0, T1, NOW, MSK, null), "releases").forbidden());
    }

    @Test
    void ordinaryFailureIsNotForbidden() {
        LoreNewsV2Collector c = new LoreNewsV2Collector((sql, p) -> {
            if (sql.equals(LoreNewsV2Collector.SQL_TASK_HIST)) throw new IllegalStateException("upstream 502");
            return List.of();
        });
        NewsV2.SourceError e = errorOf(c.collect(T0, T1, NOW, MSK, null), "task_history");
        assertFalse(e.forbidden(), "сбой — не «нет прав»");
        assertEquals(NOW, e.at());
    }

    @Test
    @SuppressWarnings("unchecked")
    void metaErrorsCarryForbiddenAndAtOnlyWhenKnown() {
        NewsV2.Input in = new NewsV2.Input(T0, T1, NOW, MSK, List.of(), Map.of(), List.of(), List.of(),
            List.of(new NewsV2.SourceError("task_history", "нет прав", true, true, NOW),
                    new NewsV2.SourceError("releases", "upstream 502", false)), null);
        Map<String, Object> meta = (Map<String, Object>) new NewsV2Engine(in, null, null).compute(NewsV2.Query.none()).get("meta");
        List<Map<String, Object>> errs = (List<Map<String, Object>>) meta.get("errors");
        assertEquals(2, errs.size(), String.valueOf(errs));
        assertEquals(Boolean.TRUE, errs.get(0).get("forbidden"));
        assertEquals(NOW.toString(), errs.get(0).get("at"));
        // Старая форма — без новых ключей: необязательные поля не выдумываются.
        assertFalse(errs.get(1).containsKey("forbidden"), String.valueOf(errs.get(1)));
        assertFalse(errs.get(1).containsKey("at"), String.valueOf(errs.get(1)));
        assertEquals("upstream 502", errs.get(1).get("error"));
    }
}
