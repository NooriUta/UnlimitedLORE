package studio.seer.heimdall.lore.news;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S7A_NEWS/S7A-11 — блок «Динамика» новостей: чистая агрегация фактов
 * (закрыто/заведено задач, закрыто спринтов, релизы, принято ADR и решений) в ряды
 * по ISO-неделям или месяцам UTC, с Δ и % к прошлому периоду. Без БД.
 *
 * <p>Слово владелицы 14.11.2026: «показатель неделя к неделе, месяц к месяцу».
 * Считает сервер (S7A-09) — веб и miniLORE только рисуют.
 */
class NewsDynamicsTest {

    /** Четверг 2026-11-12 10:00 UTC — ISO-неделя 2026-W46 (пн 09.11 – вс 15.11). */
    static final Instant NOW = Instant.parse("2026-11-12T10:00:00Z");

    static NewsDynamics.Fact fact(String metric, String type, String id, String at, String... projects) {
        return new NewsDynamics.Fact(metric, type, id, at == null ? null : Instant.parse(at), List.of(projects),
            List.of(), null, List.of(), null);
    }

    static NewsDynamics.Fact excluded(String metric, String id, String at, String reason) {
        return new NewsDynamics.Fact(metric, "task", id, at == null ? null : Instant.parse(at), List.of("lore"),
            List.of(), null, List.of(), reason);
    }

    static NewsDynamics.Input input(List<NewsDynamics.Fact> facts) {
        return new NewsDynamics.Input(facts, List.of(), null);
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> metric(Map<String, Object> out, String id) {
        for (Map<String, Object> m : (List<Map<String, Object>>) out.get("metrics"))
            if (id.equals(m.get("id"))) return m;
        throw new AssertionError("нет метрики " + id);
    }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> buckets(Map<String, Object> out) {
        return (List<Map<String, Object>>) out.get("buckets");
    }

    // ── периоды ──

    @Test
    void неделя_12ИсоНедельПоUtc_последняяТекущаяИНеполная() {
        List<NewsDynamics.Bucket> b = NewsDynamics.buckets(NewsDynamics.Period.WEEK, NOW);
        assertEquals(12, b.size());
        NewsDynamics.Bucket last = b.get(11);
        assertEquals("2026-W46", last.key());
        assertEquals(Instant.parse("2026-11-09T00:00:00Z"), last.from(), "понедельник 00:00 UTC");
        assertEquals(Instant.parse("2026-11-16T00:00:00Z"), last.to());
        assertEquals("2026-W35", b.get(0).key());
        for (int i = 1; i < b.size(); i++) assertEquals(b.get(i - 1).to(), b.get(i).from(), "периоды стык в стык");
    }

    @Test
    void неделя_наСтыкеГода_ключПоИсоГоду() {
        // Пт 01.01.2027 — ещё ISO-неделя 2026-W53.
        List<NewsDynamics.Bucket> b = NewsDynamics.buckets(NewsDynamics.Period.WEEK, Instant.parse("2027-01-01T12:00:00Z"));
        assertEquals("2026-W53", b.get(11).key());
        assertEquals(Instant.parse("2026-12-28T00:00:00Z"), b.get(11).from());
    }

    @Test
    void месяц_6КалендарныхМесяцевUtc() {
        List<NewsDynamics.Bucket> b = NewsDynamics.buckets(NewsDynamics.Period.MONTH, NOW);
        assertEquals(6, b.size());
        assertEquals("2026-06", b.get(0).key());
        assertEquals("2026-11", b.get(5).key());
        assertEquals(Instant.parse("2026-11-01T00:00:00Z"), b.get(5).from());
        assertEquals(Instant.parse("2026-12-01T00:00:00Z"), b.get(5).to());
    }

    @Test
    void periodParse_неизвестноеЗначение_null() {
        assertEquals(NewsDynamics.Period.WEEK, NewsDynamics.Period.parse(null));
        assertEquals(NewsDynamics.Period.WEEK, NewsDynamics.Period.parse(" Week "));
        assertEquals(NewsDynamics.Period.MONTH, NewsDynamics.Period.parse("month"));
        assertNull(NewsDynamics.Period.parse("day"));
    }

    // ── ряды, Δ и % ──

    @Test
    void рядыПоНеделям_текущаяПротивПрошлой_дельтаИПроцент() {
        List<NewsDynamics.Fact> f = List.of(
            fact("tasks_closed", "task", "S/T-1", "2026-11-10T08:00:00Z", "lore"),
            fact("tasks_closed", "task", "S/T-2", "2026-11-11T23:59:59Z", "lore"),
            fact("tasks_closed", "task", "S/T-3", "2026-11-12T09:00:00Z", "lore"),
            fact("tasks_closed", "task", "S/T-4", "2026-11-03T09:00:00Z", "lore"),
            fact("tasks_closed", "task", "S/T-5", "2026-11-08T23:59:59Z", "lore"),   // вс прошлой недели
            fact("tasks_closed", "task", "S/T-6", "2026-08-01T09:00:00Z", "lore"));  // до окна — не в ряду
        Map<String, Object> out = NewsDynamics.compute(input(f), NewsDynamics.Filter.NONE, NewsDynamics.Period.WEEK, NOW);
        Map<String, Object> m = metric(out, "tasks_closed");
        assertEquals("ok", m.get("state"));
        @SuppressWarnings("unchecked") List<Integer> s = (List<Integer>) m.get("series");
        assertEquals(12, s.size());
        assertEquals(3, s.get(11));
        assertEquals(2, s.get(10));
        assertEquals(5, s.stream().mapToInt(Integer::intValue).sum(), "факт до окна в ряд не входит");
        assertEquals(3, m.get("value"));
        assertEquals(2, m.get("previous"));
        assertEquals(1, m.get("delta"));
        assertEquals(50.0, m.get("pct"));
    }

    @Test
    void прошлыйПериодНоль_процентаНет_толькоДельта() {
        Map<String, Object> out = NewsDynamics.compute(input(List.of(
            fact("releases", "release", "v1", "2026-11-10T08:00:00Z", "lore"))),
            NewsDynamics.Filter.NONE, NewsDynamics.Period.WEEK, NOW);
        Map<String, Object> m = metric(out, "releases");
        assertEquals(1, m.get("value"));
        assertEquals(0, m.get("previous"));
        assertEquals(1, m.get("delta"));
        assertNull(m.get("pct"), "прошлый ноль — процент не считается");
        assertTrue(m.containsKey("pct"), "ключ есть, значение null — «не считается», а не «забыли»");
    }

    @Test
    void честныйНоль_метрикаOkСНулями() {
        Map<String, Object> out = NewsDynamics.compute(input(List.of()), NewsDynamics.Filter.NONE, NewsDynamics.Period.MONTH, NOW);
        for (String id : NewsDynamics.METRICS) {
            Map<String, Object> m = metric(out, id);
            assertEquals("ok", m.get("state"), id);
            assertEquals(0, m.get("value"));
            assertEquals(0, m.get("delta"));
            assertNull(m.get("pct"));
            @SuppressWarnings("unchecked") List<Integer> s = (List<Integer>) m.get("series");
            assertEquals(6, s.size());
        }
    }

    @Test
    void порядокМетрик_какУВладелицы() {
        assertEquals(List.of("tasks_closed", "tasks_created", "sprints_closed", "releases", "accepted"), NewsDynamics.METRICS);
    }

    @Test
    void месяцКМесяцу_сравнение() {
        Map<String, Object> out = NewsDynamics.compute(input(List.of(
            fact("sprints_closed", "sprint", "S1", "2026-10-05T08:00:00Z", "lore"),
            fact("sprints_closed", "sprint", "S2", "2026-10-31T23:59:59Z", "lore"),
            fact("sprints_closed", "sprint", "S3", "2026-11-01T00:00:00Z", "lore"))),
            NewsDynamics.Filter.NONE, NewsDynamics.Period.MONTH, NOW);
        Map<String, Object> m = metric(out, "sprints_closed");
        assertEquals(1, m.get("value"));
        assertEquals(2, m.get("previous"));
        assertEquals(-1, m.get("delta"));
        assertEquals(-50.0, m.get("pct"));
        @SuppressWarnings("unchecked") Map<String, Object> meta = (Map<String, Object>) out.get("meta");
        assertEquals("month_over_month", meta.get("compare"));
        assertEquals("UTC", meta.get("tz"));
    }

    @Test
    void текущийПериодПомеченНеполным() {
        Map<String, Object> out = NewsDynamics.compute(input(List.of()), NewsDynamics.Filter.NONE, NewsDynamics.Period.WEEK, NOW);
        List<Map<String, Object>> b = buckets(out);
        assertEquals(Boolean.TRUE, b.get(11).get("current"));
        assertEquals(Boolean.TRUE, b.get(11).get("partial"));
        assertEquals(Boolean.FALSE, b.get(10).get("partial"));
        assertEquals("2026-11-09T00:00:00Z", b.get(11).get("from"));
        assertEquals("W46", b.get(11).get("label"));
    }

    // ── «принято»: ADR и решения одной метрикой, раскладка по типу ──

    @Test
    void принято_ADRИРешения_суммаИРаскладка() {
        Map<String, Object> out = NewsDynamics.compute(input(List.of(
            fact("accepted", "adr", "ADR-1", "2026-11-10T08:00:00Z", "lore"),
            fact("accepted", "decision", "D-1", "2026-11-10T09:00:00Z", "lore"),
            fact("accepted", "decision", "D-2", "2026-11-11T09:00:00Z", "lore"))),
            NewsDynamics.Filter.NONE, NewsDynamics.Period.WEEK, NOW);
        Map<String, Object> m = metric(out, "accepted");
        assertEquals(3, m.get("value"));
        @SuppressWarnings("unchecked") Map<String, List<Integer>> by = (Map<String, List<Integer>>) m.get("by_type");
        assertEquals(1, by.get("adr").get(11));
        assertEquals(2, by.get("decision").get(11));
    }

    // ── исключённое называется числом ──

    @Test
    void исключённые_неВРяду_ноНазваныЧислом() {
        Map<String, Object> out = NewsDynamics.compute(input(List.of(
            fact("tasks_closed", "task", "S/T-1", "2026-11-10T08:00:00Z", "lore"),
            excluded("tasks_closed", "S/T-2", "2026-11-10T08:00:00Z", "bookkeeping"),
            excluded("tasks_closed", "S/T-3", "2026-11-10T08:00:00Z", "born_done"),
            excluded("tasks_closed", "S/T-4", null, "moment_unknown"),
            excluded("tasks_closed", "S/T-5", "2026-01-10T08:00:00Z", "bookkeeping"))),   // вне окна — не считается и тут
            NewsDynamics.Filter.NONE, NewsDynamics.Period.WEEK, NOW);
        Map<String, Object> m = metric(out, "tasks_closed");
        assertEquals(1, m.get("value"));
        @SuppressWarnings("unchecked") Map<String, Integer> ex = (Map<String, Integer>) m.get("excluded");
        assertEquals(Map.of("bookkeeping", 1, "born_done", 1, "moment_unknown", 1), ex);
    }

    // ── «не смогли посчитать» ≠ ноль ──

    @Test
    void источникУпал_метрикаНеСмоглиПосчитать_сПричиной() {
        NewsDynamics.Input in = new NewsDynamics.Input(List.of(
            fact("releases", "release", "v1", "2026-11-10T08:00:00Z", "lore")),
            List.of(new NewsV2.SourceError("tasks", "timeout", true)), null);
        Map<String, Object> out = NewsDynamics.compute(in, NewsDynamics.Filter.NONE, NewsDynamics.Period.WEEK, NOW);
        Map<String, Object> closed = metric(out, "tasks_closed");
        assertEquals("unavailable", closed.get("state"));
        assertNull(closed.get("value"), "не ноль — значения нет");
        assertNull(closed.get("series"));
        assertTrue(String.valueOf(closed.get("reason")).contains("timeout"));
        assertEquals("unavailable", metric(out, "tasks_created").get("state"));
        assertEquals("ok", metric(out, "releases").get("state"), "чужой источник метрику релизов не роняет");
        @SuppressWarnings("unchecked") Map<String, Object> meta = (Map<String, Object>) out.get("meta");
        assertEquals("partial", meta.get("state"));
    }

    @Test
    void отказПоПравам_помеченForbidden() {
        NewsDynamics.Input in = new NewsDynamics.Input(List.of(),
            List.of(new NewsV2.SourceError("releases", "403", true, true, null)), null);
        Map<String, Object> m = metric(NewsDynamics.compute(in, NewsDynamics.Filter.NONE, NewsDynamics.Period.WEEK, NOW), "releases");
        assertEquals("unavailable", m.get("state"));
        assertEquals(Boolean.TRUE, m.get("forbidden"));
    }

    // ── фильтры и скоуп — как у ленты ──

    @Test
    void фильтрПроекта_какУЛенты_безПроекта_ключNoProject() {
        List<NewsDynamics.Fact> f = List.of(
            fact("tasks_closed", "task", "A/T-1", "2026-11-10T08:00:00Z", "lore"),
            fact("tasks_closed", "task", "B/T-1", "2026-11-10T08:00:00Z", "mini"),
            fact("tasks_closed", "task", "C/T-1", "2026-11-10T08:00:00Z", "lore", "mini"),
            fact("tasks_closed", "task", "D/T-1", "2026-11-10T08:00:00Z"));
        NewsDynamics.Filter onlyLore = new NewsDynamics.Filter(null, Set.of("lore"), null, null, null);
        assertEquals(2, metric(NewsDynamics.compute(input(f), onlyLore, NewsDynamics.Period.WEEK, NOW), "tasks_closed").get("value"));
        NewsDynamics.Filter noProj = new NewsDynamics.Filter(null, Set.of(NewsV2Engine.NOPROJ), null, null, null);
        assertEquals(1, metric(NewsDynamics.compute(input(f), noProj, NewsDynamics.Period.WEEK, NOW), "tasks_closed").get("value"));
    }

    @Test
    void фильтрКомпонентаСпринтаВехи() {
        NewsDynamics.Fact withAll = new NewsDynamics.Fact("tasks_closed", "task", "S/T-1",
            Instant.parse("2026-11-10T08:00:00Z"), List.of("lore"), List.of("lore-news"), "S", List.of("M1"), null);
        NewsDynamics.Fact bare = fact("tasks_closed", "task", "X/T-1", "2026-11-10T08:00:00Z", "lore");
        NewsDynamics.Input in = input(List.of(withAll, bare));
        assertEquals(1, metric(NewsDynamics.compute(in, new NewsDynamics.Filter(null, null, Set.of("lore-news"), null, null),
            NewsDynamics.Period.WEEK, NOW), "tasks_closed").get("value"));
        assertEquals(1, metric(NewsDynamics.compute(in, new NewsDynamics.Filter(null, null, null, Set.of("S"), null),
            NewsDynamics.Period.WEEK, NOW), "tasks_closed").get("value"));
        assertEquals(1, metric(NewsDynamics.compute(in, new NewsDynamics.Filter(null, null, null, null, Set.of(NewsV2Engine.NOMS)),
            NewsDynamics.Period.WEEK, NOW), "tasks_closed").get("value"));
    }

    @Test
    void скоуп_чужойПроектНеВиден_общийВидимПоСвоейЧасти() {
        List<NewsDynamics.Fact> f = List.of(
            fact("releases", "release", "v1", "2026-11-10T08:00:00Z", "lore"),
            fact("releases", "release", "v2", "2026-11-10T08:00:00Z", "mini"),
            fact("releases", "release", "v3", "2026-11-10T08:00:00Z", "lore", "mini"),
            fact("releases", "release", "v4", "2026-11-10T08:00:00Z"));
        NewsDynamics.Input in = new NewsDynamics.Input(f, List.of(), Set.of("lore"));
        assertEquals(2, metric(NewsDynamics.compute(in, NewsDynamics.Filter.NONE, NewsDynamics.Period.WEEK, NOW), "releases").get("value"),
            "под скоупом — только записи разрешённых проектов; ничьи скрыты, как в ленте");
        NewsDynamics.Filter mini = new NewsDynamics.Filter(null, Set.of("mini"), null, null, null);
        assertEquals(0, metric(NewsDynamics.compute(in, mini, NewsDynamics.Period.WEEK, NOW), "releases").get("value"),
            "фильтр по чужому проекту под скоупом ничего не открывает");
    }

    @Test
    void фильтрТипа_метрикаДругогоТипаНеПрименима_неНоль() {
        NewsDynamics.Filter onlyAdr = new NewsDynamics.Filter(Set.of("adr"), null, null, null, null);
        Map<String, Object> out = NewsDynamics.compute(input(List.of(
            fact("accepted", "adr", "ADR-1", "2026-11-10T08:00:00Z", "lore"),
            fact("accepted", "decision", "D-1", "2026-11-10T08:00:00Z", "lore"))), onlyAdr, NewsDynamics.Period.WEEK, NOW);
        assertEquals("filtered_out", metric(out, "tasks_closed").get("state"));
        assertNull(metric(out, "tasks_closed").get("value"));
        assertEquals("ok", metric(out, "accepted").get("state"));
        assertEquals(1, metric(out, "accepted").get("value"), "решения сняты фильтром типа, ADR остались");
    }

    @Test
    void повторныйВызов_тотЖеОтвет() {
        List<NewsDynamics.Fact> f = List.of(
            fact("tasks_created", "task", "S/T-1", "2026-11-10T08:00:00Z", "lore"),
            fact("tasks_created", "task", "S/T-2", "2026-10-10T08:00:00Z", "lore"));
        assertEquals(NewsDynamics.compute(input(f), NewsDynamics.Filter.NONE, NewsDynamics.Period.WEEK, NOW),
            NewsDynamics.compute(input(new ArrayList<>(f).reversed()), NewsDynamics.Filter.NONE, NewsDynamics.Period.WEEK, NOW));
    }
}
