package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;
import studio.seer.heimdall.lore.news.NewsV2;

import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Дефект 28.11.2026: лента теряла свежие закрытия — выдача истории обрезалась потолком базы (20 000 строк),
 * а порядок строк был порядком хранилища: отрезались как раз самые свежие версии. Слово владелицы:
 * «и order обратным выдай, а то мы самые свежие отрезаем; ладно хвост, хотя не хорошо».
 * <ul>
 *   <li>история читается от свежих к старым — при любом усечении теряется старый хвост, а не сегодняшний день;</li>
 *   <li>выдача ровно в потолок — не «всё прочитано», а явная ошибка источника в meta.errors[] («не смогли», а не тишина).</li>
 * </ul>
 */
class LoreNewsV2HistoryCapTest {
    static final Instant T0 = Instant.parse("2026-11-27T21:00:00Z"), T1 = Instant.parse("2026-11-28T21:00:00Z");
    static final Instant NOW = Instant.parse("2026-11-28T11:00:00Z");
    static final ZoneId MSK = ZoneId.of("Europe/Moscow");

    @Test
    void historyIsReadNewestFirst() {
        for (String sql : List.of(LoreNewsV2Collector.SQL_TASK_HIST, LoreNewsV2Collector.SQL_ADR_HIST, LoreNewsV2Collector.SQL_SPEC_HIST))
            assertTrue(sql.replaceAll("\s+", " ").endsWith("ORDER BY valid_from DESC"), "свежие версии — первыми: " + sql);
    }

    @Test
    void outputAtTheServerCapIsReportedNotSilent() {
        List<Map<String, Object>> capped = new ArrayList<>();
        for (int i = 0; i < LoreNewsV2Collector.SERVER_ROW_CAP; i++) {
            Map<String, Object> r = new HashMap<>();
            r.put("task_uid", "S/T-" + i);
            r.put("valid_from", "2026-11-28T10:00:00Z");
            r.put("status_raw", "🔄 IN PROGRESS");
            capped.add(r);
        }
        LoreNewsV2Collector c = new LoreNewsV2Collector((sql, p) ->
            sql.equals(LoreNewsV2Collector.SQL_TASK_HIST) ? capped : List.of());
        NewsV2.Input in = c.collect(T0, T1, NOW, MSK, null);
        NewsV2.SourceError e = in.errors().stream().filter(x -> x.source().equals("task_history")).findFirst()
            .orElseThrow(() -> new AssertionError("выдача ровно в потолок обязана стать ошибкой источника: " + in.errors()));
        assertTrue(e.error().contains(String.valueOf(LoreNewsV2Collector.SERVER_ROW_CAP)), e.error());
        assertFalse(e.forbidden());
    }

    @Test
    void belowTheCapIsNotAnError() {
        LoreNewsV2Collector c = new LoreNewsV2Collector((sql, p) -> List.of());
        assertTrue(c.collect(T0, T1, NOW, MSK, null).errors().isEmpty());
    }
}
