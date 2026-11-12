package studio.seer.heimdall.lore.news;

import org.junit.jupiter.api.Test;
import studio.seer.heimdall.lore.news.NewsV2.*;

import java.time.Instant;
import java.time.LocalDate;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static studio.seer.heimdall.lore.news.NewsV2EngineFixtureTest.*;

/**
 * SPRINT_UXR_S7A_NEWS/S7A-09 — в каждом счётном ведре объект считается по своему
 * ПОСЛЕДНЕМУ статусу в границах ведра (слова владелицы 11.11.2026: «считается
 * последний актуальный статус по объекту, а не промежуточный за день»; «последний
 * статус диапазона: аналитика за месяц — последний статус за месяц, если он не
 * разбит по дням»). Плюс: у каждой группы и подгруппы — те же метрики, что у дня
 * («все важные метрики должны быть посчитаны и отображены для этой группы —
 * считает сервер, отображает kit»). Чистый юнит: без БД, без Quarkus.
 *
 * <ul>
 *   <li>X — 03.11 за один день: в работе → к выкатке → закрыта;</li>
 *   <li>Y — 03.11 к выкатке и так осталась (контроль: «к выкатке» не пропадает);</li>
 *   <li>Z — 03.11 к выкатке, 06.11 закрыта: день 03.11 — «к выкатке», период — «закрыта»;</li>
 *   <li>W — в спринте S2 (проект P2), заведена 03.11 и не тронута — для «заведено» и групп.</li>
 * </ul>
 * Лента («что происходило») показывает все переходы — §1 спеки; счёт называет своё
 * правило ключом {@code rule} и отдаёт отброшенное в {@code intermediate}.
 */
class NewsV2DayLastStatusTest {

    static final String DAY = "2026-11-03", FRI = "2026-11-06";

    static NewsV2Engine engine() {
        Map<String, Sprint> sp = new TreeMap<>();
        sp.put("S1", new Sprint("S1", "S1", List.of("P1"), List.of("C1"), List.of(), null, null,
            List.of(new Release("P1#v9", LocalDate.parse("2026-11-20")))));
        sp.put("S2", new Sprint("S2", "S2", List.of("P2"), List.of("C2"), List.of(), null, null, List.of()));
        List<TaskRecord> tasks = List.of(
            new TaskRecord("S1/X", "S1", "X", null, List.of(v("2026-10-20T10:00", PL), v("2026-11-03T10:00", WIP),
                v("2026-11-03T12:00", RFD), v("2026-11-03T15:00", DONE)), DONE),
            new TaskRecord("S1/Y", "S1", "Y", null, List.of(v("2026-10-20T10:00", PL), v("2026-11-03T11:00", RFD)), RFD),
            new TaskRecord("S1/Z", "S1", "Z", null, List.of(v("2026-10-20T10:00", PL), v("2026-11-03T11:30", RFD),
                v("2026-11-06T10:00", DONE)), DONE),
            new TaskRecord("S2/W", "S2", "W", null, List.of(v("2026-11-03T09:00", PL)), PL));
        Input in = new Input(T0, T1, Instant.parse("2026-11-07T20:00:00Z"), MSK, tasks, sp, List.of(), List.of(), List.of(), null);
        return new NewsV2Engine(in, AuthorResolver.UNKNOWN, KnowledgeStatusHistory.NONE);
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> m(Object o, String k) { return (Map<String, Object>) ((Map<String, Object>) o).get(k); }
    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> l(Object o, String k) { return (List<Map<String, Object>>) ((Map<String, Object>) o).get(k); }
    static int n(Object o, String k) { return ((Number) ((Map<?, ?>) o).get(k)).intValue(); }
    static int f(Map<String, Object> by, String kind, String field) { return by.containsKey(kind) ? n(by.get(kind), field) : 0; }
    static Map<String, Object> key(List<Map<String, Object>> list, String k) {
        return list.stream().filter(g -> k.equals(g.get("key"))).findFirst().orElseThrow(() -> new AssertionError("нет группы " + k + " в " + list));
    }

    static Map<String, Object> out(String groupBy, String sub) {
        return engine().compute(new NewsV2.Query(null, null, null, null, null, null, null, null, groupBy, sub, 6, null, null, null));
    }
    static Map<String, Object> out(String groupBy) { return out(groupBy, null); }

    @Test
    void feedStillShowsEveryTransition() {
        List<Map<String, Object>> ev = l(out("project"), "events");
        assertEquals(List.of("closed", "ready", "status"),
            ev.stream().filter(r -> "S1/X".equals(r.get("el"))).map(r -> (String) r.get("kind")).sorted().toList(), "лента — все переходы (§1)");
        assertEquals(List.of("closed", "ready"),
            ev.stream().filter(r -> "S1/Z".equals(r.get("el"))).map(r -> (String) r.get("kind")).sorted().toList());
    }

    @Test
    void dayBucketTakesTheLastStatusOfTheDay() {
        Map<String, Object> o = out("project");
        List<Map<String, Object>> days = NewsV2DaysContractTest.days(o);
        Map<String, Object> d = NewsV2DaysContractTest.day(days, DAY);
        Map<String, Object> byKind = m(d, "by_kind");
        assertEquals(1, f(byKind, "closed", "rows"), "X закрыта к концу дня: " + byKind);
        assertEquals(2, f(byKind, "ready", "rows"), "к выкатке за день — Y и Z, X не считается: " + byKind);
        assertEquals(2, f(byKind, "ready", "elements"), byKind.toString());
        assertEquals(0, f(byKind, "status", "rows"), "промежуточное «в работе» X в счёт дня не идёт: " + byKind);
        Map<String, Object> task = m(m(d, "by_type"), "task");
        assertEquals(List.of(4, 4, 4), List.of(n(task, "events"), n(task, "elements"), n(task, "rows")), "X, Y, Z, W — по одному разу");
        assertEquals(1, f(m(task, "by_kind"), "closed", "rows"));
        assertEquals(4, n(d, "rows"));
        assertEquals(List.of(4, 4), List.of(n(d.get("total"), "events"), n(d.get("total"), "elements")));
        assertEquals("last_status_of_day", d.get("rule"), "счёт дня называет своё правило");
        Map<String, Object> inter = m(d, "intermediate");
        assertEquals(List.of(2, 2), List.of(n(inter, "events"), n(inter, "rows")), "отброшено: X «в работе» и «к выкатке»");
        Map<String, Object> p1 = key(l(d, "groups"), "P1");
        assertEquals(List.of(3, 3, 3), List.of(n(p1, "events"), n(p1, "elements"), n(p1, "rows")));
        // Z закрыта в пятницу — в своём дне она «закрыта»
        assertEquals(1, f(m(NewsV2DaysContractTest.day(days, FRI), "by_kind"), "closed", "rows"));
        // матрица — тоже ведро «день»: итог строки = итог дня
        Map<String, Object> mr = l(m(o, "matrix"), "rows").stream().filter(r -> DAY.equals(r.get("day"))).findFirst().orElseThrow();
        assertEquals(d.get("total"), mr.get("total"));
    }

    @Test
    void periodBucketTakesTheLastStatusOfThePeriod() {
        Map<String, Object> o = out("project");
        Map<String, Object> counts = m(m(o, "metrics"), "counts");
        Map<String, Object> byKind = m(counts, "by_kind");
        assertEquals(2, f(byKind, "closed", "events"), "X и Z закрыты к концу периода: " + byKind);
        assertEquals(2, f(byKind, "closed", "elements"));
        assertEquals(1, f(byKind, "ready", "events"), "к выкатке за период — только Y (Z потом закрыта): " + byKind);
        assertEquals(0, f(byKind, "status", "events"), byKind.toString());
        assertEquals(List.of(4, 4), List.of(n(counts.get("total"), "events"), n(counts.get("total"), "elements")));
        assertEquals(4, n(m(counts, "by_type").get("task"), "events"));
        assertEquals("last_status_of_period", counts.get("rule"));
        assertEquals(3, n(m(counts, "intermediate"), "events"), "X «в работе», «к выкатке»; Z «к выкатке»");
        Map<String, Object> groups = m(o, "groups");
        assertEquals(List.of(4, 4), List.of(n(groups.get("total"), "events"), n(groups.get("total"), "elements")));
        assertEquals("last_status_of_period", groups.get("rule"));
    }

    @Test
    void groupsByDayUseTheDayBucket() {
        Map<String, Object> groups = m(out("day"), "groups");
        Map<String, Object> d = key(l(groups, "list"), DAY);
        assertEquals(4, n(d, "events"), "03.11: X закрыта, Y и Z к выкатке, W заведена");
        assertEquals("last_status_of_day", groups.get("rule"));
    }

    @Test
    void waitingForDeployIsStateAtTheEndOfTheBucket() {
        Map<String, Object> tasks = m(m(out("project"), "metrics"), "tasks");
        List<Map<String, Object>> days = l(tasks, "days");
        Map<String, Object> d = days.stream().filter(x -> DAY.equals(x.get("day_local"))).findFirst().orElseThrow();
        assertEquals(2, n(d, "waiting_end"), "на конец 03.11 ждут выкатки Y и Z");
        Map<String, Object> fri = days.stream().filter(x -> FRI.equals(x.get("day_local"))).findFirst().orElseThrow();
        assertEquals(1, n(fri, "waiting_end"), "на конец 06.11 ждёт только Y");
        assertEquals(1, n(m(tasks, "all"), "waiting_t1"), "на конец периода ждёт только Y");
        assertEquals(2, n(m(tasks, "all"), "closed"), "сгорание: X и Z закрыты");
    }

    // ───────── метрики группы и подгруппы (день и период) ─────────

    /** Общая форма метрик ведра: та же, что у дня; пустое — нулями, а не пропажей поля. */
    static void assertFigures(Map<String, Object> g) {
        for (String k : List.of("events", "elements", "total", "rows", "agent_events", "agent_elements",
                "by_kind", "by_type", "burn", "ship", "balance"))
            assertTrue(g.containsKey(k), "у группы " + g.get("key") + " нет «" + k + "»: " + g.keySet());
        assertEquals(List.of(n(g, "events"), n(g, "elements")), List.of(n(g.get("total"), "events"), n(g.get("total"), "elements")),
            "total группы — её собственный");
        for (String kind : List.of("closed", "created", "ready", "reactivated", "released", "changed")) {
            assertTrue(m(g, "by_kind").containsKey(kind), "вид " + kind + " — нулём, а не пропажей: " + g.get("key"));
            for (String f : List.of("events", "elements", "rows")) assertTrue(m(m(g, "by_kind"), kind).containsKey(f));
        }
        assertTrue(m(g, "by_type").containsKey("task"), "задачи — нулём, а не пропажей");
        assertTrue(m(m(g, "by_type"), "task").containsKey("by_kind"));
        for (String f : List.of("open_start", "open_end", "burn")) assertTrue(m(g, "burn").containsKey(f), f);
        assertEquals(n(m(g, "burn"), "open_start") - n(m(g, "burn"), "open_end"), n(m(g, "burn"), "burn"));
        for (String f : List.of("waiting", "ship_unknown", "shipped")) assertTrue(m(g, "ship").containsKey(f), f);
        for (String f : List.of("closed", "created")) assertTrue(m(g, "balance").containsKey(f), f);
    }

    static List<Integer> burn(Map<String, Object> g) {
        Map<String, Object> b = m(g, "burn");
        return List.of(n(b, "open_start"), n(b, "open_end"), n(b, "burn"));
    }

    @Test
    void dayGroupAndSubgroupCarryTheDayFigures() {
        Map<String, Object> d = NewsV2DaysContractTest.day(NewsV2DaysContractTest.days(out("project", "sprint")), DAY);
        assertTrue(m(d, "ship") != null && m(d, "balance") != null, "у дня — «к выкатке» и баланс");
        assertEquals(2, n(m(d, "ship"), "waiting"));
        assertEquals(List.of(1, 1), List.of(n(m(d, "balance"), "closed"), n(m(d, "balance"), "created")));
        Map<String, Object> p1 = key(l(d, "groups"), "P1");
        assertFigures(p1);
        assertEquals(1, f(m(p1, "by_kind"), "closed", "rows"));
        assertEquals(2, f(m(p1, "by_kind"), "ready", "rows"));
        assertEquals(2, n(m(p1, "ship"), "waiting"), "P1 на конец дня: ждут Y и Z");
        assertEquals(List.of(1, 0), List.of(n(m(p1, "balance"), "closed"), n(m(p1, "balance"), "created")));
        // сгорание группы за день (§7.2a: готовая без выкатки — открыта): 03.11 начали X, Y, Z, кончили Y, Z
        assertEquals(List.of(3, 2, 1), burn(p1));
        assertEquals(0, n(p1, "agent_events"));
        Map<String, Object> p2 = key(l(d, "groups"), "P2");
        assertFigures(p2);
        assertEquals(List.of(0, 1), List.of(n(m(p2, "balance"), "closed"), n(m(p2, "balance"), "created")));
        assertEquals(0, n(m(p2, "ship"), "waiting"));
        assertEquals(List.of(0, 1, -1), burn(p2), "W заведена 03.11 — открытой работы стало больше");
        assertEquals(0, f(m(p2, "by_kind"), "closed", "rows"), "пустой вид — нулём");
        Map<String, Object> sub = m(p1, "sub");
        assertEquals("sprint", sub.get("axis"));
        Map<String, Object> s1 = key(l(sub, "groups"), "S1");
        assertFigures(s1);
        assertEquals(List.of(3, 3, 3), List.of(n(s1, "events"), n(s1, "elements"), n(s1, "rows")));
        assertEquals(2, n(m(s1, "ship"), "waiting"));
        assertEquals(List.of(3, 2, 1), burn(s1));
        assertEquals(3, n(m(m(s1, "by_type"), "task"), "rows"));
    }

    @Test
    void dayFiguresAgreeWithTaskDaysOnTheContractFixture() {
        Map<String, Object> o = NewsV2EngineFixtureTest.engine().compute(NewsV2DaysContractTest.query("project", null, null));
        List<Map<String, Object>> td = l(m(m(o, "metrics"), "tasks"), "days");
        for (Map<String, Object> d : NewsV2DaysContractTest.days(o)) {
            Map<String, Object> t = td.stream().filter(x -> d.get("day").equals(x.get("day_local"))).findFirst().orElseThrow();
            assertEquals(n(t, "waiting_end"), n(m(d, "ship"), "waiting"), "ждут выкатки на конец " + d.get("day"));
            assertEquals(n(t, "shipped"), n(m(d, "ship"), "shipped"), "доехало " + d.get("day"));
            assertEquals(n(t, "burn"), n(m(d, "burn"), "burn"), "сгорание " + d.get("day"));
            for (Map<String, Object> g : l(d, "groups")) assertFigures(g);
        }
        for (Map<String, Object> g : l(m(o, "groups"), "list")) assertFigures(g);
    }

    @Test
    void periodGroupAndSubgroupCarryThePeriodFigures() {
        Map<String, Object> groups = m(out("project", "sprint"), "groups");
        Map<String, Object> p1 = key(l(groups, "list"), "P1");
        assertFigures(p1);
        assertEquals(2, f(m(p1, "by_kind"), "closed", "rows"), "период: X и Z закрыты");
        assertEquals(1, f(m(p1, "by_kind"), "ready", "rows"), "период: к выкатке только Y");
        assertEquals(1, n(m(p1, "ship"), "waiting"), "на конец периода в P1 ждёт Y");
        assertEquals(List.of(2, 0), List.of(n(m(p1, "balance"), "closed"), n(m(p1, "balance"), "created")));
        // сгорание периода = то же, что tasks.by_axis.project (одна формула §7.2)
        assertEquals(List.of(3, 1, 2), burn(p1));
        Map<String, Object> tp1 = key(l(m(m(m(m(out("project", "sprint"), "metrics"), "tasks"), "by_axis"), "project"), "groups"), "P1");
        assertEquals(List.of(n(m(tp1, "total"), "open_t0"), n(m(tp1, "total"), "open_t1"), n(m(tp1, "total"), "burn")), burn(p1));
        Map<String, Object> s1 = key(l(m(p1, "sub"), "groups"), "S1");
        assertFigures(s1);
        assertEquals(List.of(3, 1, 2), burn(s1));
        assertEquals(1, n(m(s1, "ship"), "waiting"));
        assertEquals(2, f(m(s1, "by_kind"), "closed", "rows"));
        // прежние ключи подгруппы на месте
        assertTrue(s1.containsKey("multi"));
    }
}
