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

    /**
     * B9: версия, общая у двух задач (S2-11), попадает в таймлайн КАЖДОЙ, а события
     * «изменено» у ADR и «версия» у спек ставятся каждому владельцу — не только
     * первому ([0] — порядок хранилища, не приоритет). «Первая версия» у каждого
     * владельца своя: общая версия, единственная у владельца, — начальное состояние,
     * не правка.
     */
    @Test
    void sharedVersionReachesTimelineAndChangedEventsOfEveryOwner() {
        LoreNewsV2Collector c = new LoreNewsV2Collector((sql, p) -> {
            if (sql.equals(LoreNewsV2Collector.SQL_TASK_HIST)) return List.of(
                row("task_uid", "S9/A-1", "task_uids", List.of("S9/A-1", "S9/B-1"),
                    "valid_from", "2026-10-20T10:00:00.000Z", "status_raw", "📋 PLANNED"));
            if (sql.equals(LoreNewsV2Collector.SQL_ADR_HIST)) return List.of(
                row("adr_id", "ADR-A", "adr_uids", List.of("ADR-A"),
                    "valid_from", "2026-10-25T10:00:00.000Z", "projects", List.of("P1")),
                row("adr_id", "ADR-B", "adr_uids", List.of("ADR-B"),
                    "valid_from", "2026-10-26T10:00:00.000Z", "projects", List.of("P1")),
                row("adr_id", "ADR-A", "adr_uids", List.of("ADR-A", "ADR-B"),
                    "valid_from", "2026-11-03T10:00:00.000Z", "projects", List.of("P1")));
            if (sql.equals(LoreNewsV2Collector.SQL_SPEC_HIST)) return List.of(
                row("spec_id", "SPEC-A", "spec_uids", List.of("SPEC-A"),
                    "valid_from", "2026-10-25T10:00:00.000Z", "projects", List.of("P1")),
                row("spec_id", "SPEC-B", "spec_uids", List.of("SPEC-B"),
                    "valid_from", "2026-10-26T10:00:00.000Z", "projects", List.of("P1")),
                row("spec_id", "SPEC-A", "spec_uids", List.of("SPEC-A", "SPEC-B"),
                    "valid_from", "2026-11-03T10:00:00.000Z", "projects", List.of("P1")));
            return List.of();
        });
        NewsV2.Input in = c.collect(T0, T1, T1, ZoneId.of("Europe/Moscow"), null);
        NewsV2.TaskRecord ta = in.tasks().stream().filter(t -> t.uid().equals("S9/A-1")).findFirst().orElseThrow();
        NewsV2.TaskRecord tb = in.tasks().stream().filter(t -> t.uid().equals("S9/B-1")).findFirst().orElseThrow();
        assertEquals(1, ta.versions().size(), "переход — владельцу A, не дублируется");
        assertEquals(1, tb.versions().size(), "переход — и владельцу B, а не только первому ([0])");
        assertTrue(in.otherEvents().stream().anyMatch(e -> e.type().equals("adr") && e.el().equals("ADR-A") && e.kind().equals("changed")));
        assertTrue(in.otherEvents().stream().anyMatch(e -> e.type().equals("adr") && e.el().equals("ADR-B") && e.kind().equals("changed")),
            "событие «изменено» — каждому владельцу общей версии");
        assertTrue(in.otherEvents().stream().anyMatch(e -> e.type().equals("spec") && e.el().equals("SPEC-A") && e.kind().equals("version")));
        assertTrue(in.otherEvents().stream().anyMatch(e -> e.type().equals("spec") && e.el().equals("SPEC-B") && e.kind().equals("version")));
    }

    /**
     * S7A-01, новые типы §1: вопросы в ленте — «открыт» по opened_date, «закрыт» по closed_date,
     * только в окне. Читается лёгкая проекция без body_md (SPEC-LORE-KIT-CONTRACT-CONDITIONS,
     * условие 9: срез questions везёт 576 КБ тел, ленте они не нужны).
     */
    @Test
    void questionsBecomeOpenedAndClosedEventsWithoutBodies() {
        List<String> seen = new ArrayList<>();
        LoreNewsV2Collector c = new LoreNewsV2Collector((sql, p) -> {
            seen.add(sql);
            if (sql.equals(LoreNewsV2Collector.SQL_QUESTIONS)) return List.of(
                row("question_id", "Q-1", "title", "Открыт в окне", "status", "open",
                    "opened_date", "2026-11-03T10:00:00.000Z", "projects", List.of("P1")),
                row("question_id", "Q-2", "title", "Закрыт в окне", "status", "closed",
                    "opened_date", "2026-10-01T10:00:00.000Z", "closed_date", "2026-11-05", "projects", List.of("P1")),
                row("question_id", "Q-3", "title", "Вне окна", "status", "open",
                    "opened_date", "2026-09-01T10:00:00.000Z", "projects", List.of("P1")));
            return List.of();
        });
        NewsV2.Input in = c.collect(T0, T1, T1, ZoneId.of("Europe/Moscow"), null);
        List<NewsV2.Event> q = in.otherEvents().stream().filter(e -> e.type().equals("question")).toList();
        assertTrue(q.stream().anyMatch(e -> e.el().equals("Q-1") && e.kind().equals("created")), String.valueOf(q));
        assertTrue(q.stream().anyMatch(e -> e.el().equals("Q-2") && e.kind().equals("closed") && e.at() == null
            && e.day().toString().equals("2026-11-05")), "закрытие — только дата, время не выдумывается: " + q);
        assertFalse(q.stream().anyMatch(e -> e.el().equals("Q-2") && e.kind().equals("created")), "открыт до окна");
        assertFalse(q.stream().anyMatch(e -> e.el().equals("Q-3")), "вне окна");
        assertFalse(LoreNewsV2Collector.SQL_QUESTIONS.contains("body_md"), "тела вопросов ленте не нужны");
    }

    /**
     * S7A-01, новые типы §1: вехи и компоненты в ленте. Источник времени появился —
     * у вехи история цели KnowMilestoneHist (первая версия = заведение, следующие =
     * правка) и updated_at вершины (#1146), у компонента — только updated_at (#1153).
     * Без источника времени события нет: ни даты, ни истории — веха и компонент
     * в ленте не появляются, время не выдумывается.
     */
    @Test
    void milestonesAndComponentsBecomeEventsOnlyFromRealTimeSources() {
        List<String> seen = new ArrayList<>();
        LoreNewsV2Collector c = new LoreNewsV2Collector((sql, p) -> {
            seen.add(sql);
            if (sql.equals(LoreNewsV2Collector.SQL_MILESTONES)) return List.of(
                // заведена в окне (первая версия), цель сменена позже — правка
                row("milestone_id", "M-NEW", "label", "Новая веха",
                    "hist_from", List.of("2026-11-02T10:00:00.000Z", "2026-11-04T12:00:00.000Z")),
                // заведена до окна, правка полей вершины в окне — updated_at
                row("milestone_id", "M-OLD", "label", "Старая веха",
                    "hist_from", List.of("2026-09-01T10:00:00.000Z"), "updated_at", "2026-11-05T08:00:00.000Z"),
                // ни истории, ни отметки правки — события нет
                row("milestone_id", "M-NONE", "label", "Без времени"));
            if (sql.equals(LoreNewsV2Collector.SQL_COMPONENTS)) return List.of(
                row("component_id", "FORSETI", "full_name", "Forseti", "updated_at", "2026-11-03T09:00:00.000Z",
                    "git_projects", List.of("P1")),
                row("component_id", "OLD", "full_name", "Вне окна", "updated_at", "2026-09-03T09:00:00.000Z"),
                row("component_id", "NONE", "full_name", "Без отметки"));
            return List.of();
        });
        NewsV2.Input in = c.collect(T0, T1, T1, ZoneId.of("Europe/Moscow"), null);
        assertEquals(List.of(), in.errors());
        List<NewsV2.Event> m = in.otherEvents().stream().filter(e -> e.type().equals("milestone")).toList();
        assertTrue(m.stream().anyMatch(e -> e.el().equals("M-NEW") && e.kind().equals("created")
            && e.at().equals(Instant.parse("2026-11-02T10:00:00Z"))), "заведение — первая версия истории: " + m);
        assertTrue(m.stream().anyMatch(e -> e.el().equals("M-NEW") && e.kind().equals("changed")
            && e.at().equals(Instant.parse("2026-11-04T12:00:00Z"))), "следующая версия — правка: " + m);
        assertTrue(m.stream().anyMatch(e -> e.el().equals("M-OLD") && e.kind().equals("changed")
            && e.at().equals(Instant.parse("2026-11-05T08:00:00Z"))), "правка полей — updated_at: " + m);
        assertFalse(m.stream().anyMatch(e -> e.el().equals("M-OLD") && e.kind().equals("created")), "заведена до окна");
        assertFalse(m.stream().anyMatch(e -> e.el().equals("M-NONE")), "без источника времени события нет");
        assertTrue(m.stream().allMatch(e -> e.milestones().contains(e.el())), "веха — в своей оси «веха»");

        List<NewsV2.Event> comp = in.otherEvents().stream().filter(e -> e.type().equals("component")).toList();
        assertEquals(1, comp.size(), String.valueOf(comp));
        NewsV2.Event f = comp.get(0);
        assertEquals("FORSETI", f.el());
        assertEquals("changed", f.kind(), "у компонента только отметка правки — «изменено», не «появилось»");
        assertEquals(List.of("FORSETI"), f.components());
        assertEquals(List.of("P1"), f.projects());
        assertEquals("Forseti", f.title());

        for (String sql : List.of(LoreNewsV2Collector.SQL_MILESTONES, LoreNewsV2Collector.SQL_COMPONENTS)) {
            assertFalse(sql.contains("goal_md") || sql.contains("decisions_md"), "тела вех ленте не нужны: " + sql);
            assertTrue(seen.contains(sql), "источник прочитан: " + sql);
        }
    }

    @Test
    void milestoneAndComponentSourceFailuresAreReportedNotSilent() {
        LoreNewsV2Collector c = new LoreNewsV2Collector((sql, p) -> {
            if (sql.equals(LoreNewsV2Collector.SQL_MILESTONES) || sql.equals(LoreNewsV2Collector.SQL_COMPONENTS))
                throw new IllegalStateException("upstream 502");
            return List.of();
        });
        NewsV2.Input in = c.collect(T0, T1, T1, ZoneId.of("Europe/Moscow"), null);
        assertTrue(in.errors().stream().anyMatch(e -> e.source().equals("milestones") && !e.critical()), String.valueOf(in.errors()));
        assertTrue(in.errors().stream().anyMatch(e -> e.source().equals("components") && !e.critical()), String.valueOf(in.errors()));
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
