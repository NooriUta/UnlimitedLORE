package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;
import studio.seer.heimdall.lore.news.NewsV2;

import java.time.Instant;
import java.time.ZoneId;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * S7A-01/S7A-07: сборщик новостей v2 на подставных строках — без БД и без Quarkus.
 * Проверяет нормализацию SCD2-строк и честность сбоев: упавший источник попадает
 * в errors[], а не превращается в «ничего не было».
 */
class LoreNewsV2CollectorTest {

    static final Instant T0 = Instant.parse("2026-10-31T21:00:00Z"), T1 = Instant.parse("2026-11-07T21:00:00Z");

    @Test
    void taskHistoryFailureIsReportedAsCriticalSourceError() {
        LoreNewsV2Collector c = new LoreNewsV2Collector((sql, p) -> {
            if (sql.equals(LoreNewsV2Collector.SQL_TASK_HIST)) throw new IllegalStateException("upstream 502");
            return List.of();
        });
        NewsV2.Input in = c.collect(T0, T1, T1, ZoneId.of("Europe/Moscow"), null);
        assertTrue(in.errors().stream().anyMatch(e -> e.source().equals("task_history") && e.critical()), String.valueOf(in.errors()));
    }

    @Test
    void historyRowsBecomeTaskChainsAndSprintReleaseLinks() {
        LoreNewsV2Collector c = new LoreNewsV2Collector((sql, p) -> {
            if (sql.equals(LoreNewsV2Collector.SQL_TASK_HIST)) return List.of(
                row("task_uid", "S1/T-1", "valid_from", "2026-10-20T10:00:00.000Z", "status_raw", "📋 PLANNED"),
                row("task_uid", "S1/T-1", "valid_from", "2026-11-03T10:00:00.000Z", "status_raw", "🚀 READY FOR DEPLOY"));
            if (sql.contains("FROM KnowSprint")) return List.of(row("sprint_id", "S1", "name", "S1",
                "git_projects", List.of("P1"), "release_ids", List.of("v2"), "release_dates", List.of("2026-11-04"),
                "created_date", "2026-11-01T09:00:00.000Z"));
            if (sql.contains("FROM KnowTask") && !sql.contains("Hist")) return List.of(row("task_uid", "S1/T-1", "sprint_id", "S1",
                "title", "T-1", "status_raw", "🚀 READY FOR DEPLOY"));
            if (sql.equals(LoreNewsV2Collector.SQL_RELEASES)) return List.of(row("release_id", "v2", "release_uid", "P1#v2",
                "release_date", "2026-11-04", "projects", List.of("P1")));
            return List.of();
        });
        NewsV2.Input in = c.collect(T0, T1, T1, ZoneId.of("Europe/Moscow"), null);
        assertEquals(List.of(), in.errors());
        NewsV2.TaskRecord t = in.tasks().get(0);
        assertEquals("S1/T-1", t.uid());
        assertEquals(2, t.versions().size());
        assertEquals("🚀 READY FOR DEPLOY", t.snapshotStatus());
        assertEquals("P1", in.sprints().get("S1").projects().get(0));
        assertEquals("2026-11-04", in.sprints().get("S1").releases().get(0).date().toString());
        assertTrue(in.otherEvents().stream().anyMatch(e -> e.type().equals("release") && e.at() == null
            && e.day().toString().equals("2026-11-04")), "релиз — только дата, время не выдумывается");
        assertTrue(in.otherEvents().stream().anyMatch(e -> e.type().equals("sprint") && e.kind().equals("created")));
    }

    @Test
    void instantParsesIsoZAndRenderedFormButNotDateOnly() {
        assertEquals(Instant.parse("2026-11-03T10:00:00Z"), LoreNewsV2Collector.instant("2026-11-03T10:00:00.000Z"));
        assertEquals(Instant.parse("2026-11-03T10:00:00Z"), LoreNewsV2Collector.instant("2026-11-03 10:00:00"));
        assertNull(LoreNewsV2Collector.instant("2026-11-03"));
    }

    @Test
    void periodDefaultsToSevenLocalDaysEndingNow() {
        ZoneId msk = ZoneId.of("Europe/Moscow");
        Instant now = Instant.parse("2026-11-07T17:30:00Z");
        Instant[] p = LoreNewsV2Resource.period(null, null, null, msk, now);
        assertEquals(Instant.parse("2026-10-31T21:00:00Z"), p[0]);
        assertEquals(now, p[1]);
        Instant[] d = LoreNewsV2Resource.period("2026-11-01", "2026-11-07", null, msk, now);
        assertEquals(Instant.parse("2026-10-31T21:00:00Z"), d[0]);
        assertEquals(Instant.parse("2026-11-07T21:00:00Z"), d[1], "день в to — до конца дня");
        assertNull(LoreNewsV2Resource.period("2026-11-07", "2026-11-01", null, msk, now));
    }

    static Map<String, Object> row(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put(String.valueOf(kv[i]), kv[i + 1]);
        return m;
    }
}
