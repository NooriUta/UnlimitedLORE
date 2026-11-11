package studio.seer.heimdall.lore.news;

import org.junit.jupiter.api.Test;
import studio.seer.heimdall.lore.news.NewsV2.*;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPEC-LORE-UXR-NEWS-ALGORITHMS 1.3.0 §10.4 — контрактный тест движка новостей v2
 * с положительным контролем. Чистый юнит: без БД, без Quarkus.
 *
 * <p><b>Откуда ожидаемые числа.</b> Всё, что умеет прототип, сверено с JS-моделью
 * {@code docs/prototypes/news-proof/page.tpl.html} на ЭТОЙ ЖЕ фикстуре:
 * {@code node backend/src/test/resources/news-v2/crosscheck-js.cjs} (функции
 * prepare / groupCount / burn / shipModel / matrix / knowledge взяты дословно).
 * §7.2b (своё/общее) и §7.2c (реактивация) в прототипе нет — их числа посчитаны
 * по формулам спеки, расчёт — в комментариях у проверок.
 *
 * <p>Фикстура (период 01–07.11.2026 по Москве):
 * <ul>
 *   <li>A — общая задача (спринт S2: P1+P2): закрыта до периода → реактивирована → закрыта;</li>
 *   <li>B — сделана внутри периода; C — заведена в периоде, ×3 правки агентом (серия);</li>
 *   <li>D — готова, без релиза (ждёт); F — готова и выпущена (доехала, ожидание 1 день);</li>
 *   <li>H — выпущена до периода, в периоде переведена в ✅;</li>
 *   <li>K — выпущена, затем реактивирована и осталась открытой;</li>
 *   <li>E — готова в спринте без связи с релизом (выкатка не определена);
 *       G — общая, закрыта в периоде; U — нетронутая открытая;</li>
 *   <li>три ADR (одна правка в день создания — отбрасывается §5), решение, спека, спринт, два релиза.</li>
 * </ul>
 */
class NewsV2EngineFixtureTest {

    static final ZoneId MSK = ZoneId.of("Europe/Moscow");
    static final Instant T0 = Instant.parse("2026-10-31T21:00:00Z");
    static final Instant T1 = Instant.parse("2026-11-07T21:00:00Z");
    static final String PL = "📋 PLANNED", DONE = "✅ DONE", RFD = "🚀 READY FOR DEPLOY", WIP = "🔄 IN PROGRESS";

    static Instant z(String s) { return Instant.parse(s + ":00Z"); }
    static Version v(String at, String st) { return new Version(z(at), st); }

    static Map<String, Sprint> sprints() {
        Map<String, Sprint> m = new TreeMap<>();
        m.put("S1", new Sprint("S1", "S1", List.of("P1"), List.of("C1"), List.of("M1"), null, null,
            List.of(new Release("P1#v1", LocalDate.parse("2026-10-20")), new Release("P1#v2", LocalDate.parse("2026-11-04")))));
        m.put("S2", new Sprint("S2", "S2", List.of("P1", "P2"), List.of("C2"), List.of("M1"), z("2026-11-01T09:00"), null,
            List.of(new Release("P2#v3", LocalDate.parse("2026-11-03")))));
        m.put("S3", new Sprint("S3", "S3", List.of("P2"), List.of("C3"), List.of(), null, null, List.of()));
        return m;
    }

    static List<TaskRecord> tasks(boolean dropLastVersionOfA) {
        List<Version> a = new ArrayList<>(List.of(v("2026-10-01T10:00", PL), v("2026-10-10T10:00", DONE),
            v("2026-11-02T10:00", WIP), v("2026-11-03T10:00", DONE)));
        if (dropLastVersionOfA) a.remove(a.size() - 1);
        return List.of(
            new TaskRecord("S2/A", "S2", "A", null, a, DONE),
            new TaskRecord("S1/B", "S1", "B", null, List.of(v("2026-10-25T10:00", PL), v("2026-11-02T12:00", DONE)), DONE),
            new TaskRecord("S1/C", "S1", "C", null, List.of(v("2026-11-02T08:00", PL), v("2026-11-04T09:00", PL),
                v("2026-11-04T09:10", PL), v("2026-11-04T09:20", PL)), PL),
            new TaskRecord("S1/D", "S1", "D", null, List.of(v("2026-10-20T10:00", PL), v("2026-11-05T10:00", RFD)), RFD),
            new TaskRecord("S1/F", "S1", "F", null, List.of(v("2026-10-20T10:00", PL), v("2026-11-03T10:00", RFD)), RFD),
            new TaskRecord("S1/H", "S1", "H", null, List.of(v("2026-10-10T10:00", PL), v("2026-10-15T10:00", RFD),
                v("2026-11-02T09:00", DONE)), DONE),
            new TaskRecord("S1/K", "S1", "K", null, List.of(v("2026-10-10T10:00", PL), v("2026-10-15T10:00", RFD),
                v("2026-11-04T10:00", WIP)), WIP),
            new TaskRecord("S3/E", "S3", "E", null, List.of(v("2026-10-20T10:00", PL), v("2026-11-06T10:00", RFD)), RFD),
            new TaskRecord("S2/G", "S2", "G", null, List.of(v("2026-10-20T10:00", PL), v("2026-11-05T12:00", DONE)), DONE),
            new TaskRecord("S1/U", "S1", "U", null, List.of(v("2026-09-01T10:00", PL)), PL));
    }

    static Event ev(String type, String el, String kind, Instant at, String day, List<String> p, String parent) {
        return new Event(type, el, kind, at, at == null ? LocalDate.parse(day) : null, null, null, p, List.of(),
            "sprint".equals(type) ? el : null, List.of(), parent, null, null, el, "fixture");
    }

    static List<Event> others() {
        return List.of(
            ev("sprint", "S2", "created", z("2026-11-01T09:00"), null, List.of("P1", "P2"), null),
            ev("release", "P1#v2", "released", null, "2026-11-04", List.of("P1"), null),
            ev("release", "P2#v3", "released", null, "2026-11-03", List.of("P2"), null),
            ev("adr", "ADR-1", "created", null, "2026-11-02", List.of("P1"), null),
            ev("adr", "ADR-1", "changed", z("2026-11-02T15:00"), null, List.of("P1"), null),   // день создания — отбрасывается
            ev("adr", "ADR-2", "changed", z("2026-11-03T10:00"), null, List.of("P1", "P2"), null),
            ev("adr", "ADR-3", "changed", z("2026-11-05T11:00"), null, List.of("P2"), null),
            ev("decision", "DEC-1", "created", null, "2026-11-02", List.of("P1"), "ADR-1"),
            ev("spec", "SPEC-1", "created", z("2026-11-03T12:00"), null, List.of("P2"), null),
            ev("spec", "SPEC-1", "version", z("2026-11-06T10:00"), null, List.of("P2"), null),
            // вне периода — не входит
            ev("adr", "ADR-2", "changed", z("2026-10-20T10:00"), null, List.of("P1", "P2"), null));
    }

    static List<Knowledge> knowledge() {
        return List.of(
            new Knowledge("adr", "ADR-1", "PROPOSED", LocalDate.parse("2026-11-02"), null, null, List.of("P1")),
            new Knowledge("adr", "ADR-2", "ACCEPTED", LocalDate.parse("2026-10-01"), null, null, List.of("P1", "P2")),
            new Knowledge("adr", "ADR-3", "PROPOSED", LocalDate.parse("2026-09-01"), null, null, List.of("P2")),
            new Knowledge("decision", "DEC-1", "accepted", LocalDate.parse("2026-11-02"), "ADR-1", null, List.of("P1")),
            new Knowledge("spec", "SPEC-1", "draft", LocalDate.parse("2026-11-03"), null, "1.0.0", List.of("P2")));
    }

    /** Серия агента: правки C 04.11 09:00–09:20 — автор известен только тут (как будет после S2-12). */
    static final AuthorResolver AGENT_ON_C = (type, id, at) ->
        "task".equals(type) && "S1/C".equals(id) && !at.isBefore(z("2026-11-04T09:00")) && !at.isAfter(z("2026-11-04T09:20"))
            ? new AuthorResolver.Author("agent:claude", true) : AuthorResolver.Author.UNKNOWN;

    static NewsV2Engine engine(boolean dropA, Set<String> scope) {
        Input in = new Input(T0, T1, Instant.parse("2026-11-07T20:00:00Z"), MSK, tasks(dropA), sprints(), others(),
            knowledge(), List.of(), scope);
        return new NewsV2Engine(in, AGENT_ON_C, KnowledgeStatusHistory.NONE);
    }

    static NewsV2Engine engine() { return engine(false, null); }

    // ───────────────────────── §5, §2: события и элементы ─────────────────────────

    @Test
    void prepareDropsChangedOnCreatedDayAndDedupsByDay() {
        NewsV2Engine e = engine();
        NewsV2Engine.Prepared p = e.prepare(e.periodEvents());
        // JS: prepare.E = 22, dropped = 1, rows = 20, «изменено ×3» у C.
        assertEquals(22, p.E().size());
        assertEquals(1, p.dropped().size());
        assertEquals("ADR-1", p.dropped().get(0).el());
        assertEquals(20, p.rows().size());
        List<NewsV2Engine.Row> multi = p.rows().stream().filter(r -> r.mult() > 1).toList();
        assertEquals(1, multi.size());
        assertEquals("task:S1/C|changed|2026-11-04", multi.get(0).key());
        assertEquals(3, multi.get(0).mult());
    }

    @Test
    void projectGroupsCountFullyAndTotalIsUnion() {
        NewsV2Engine e = engine();
        List<Event> E = e.prepare(e.periodEvents()).E();
        NewsV2Engine.GroupCount R = e.groupCount(E, "project");
        // JS: [["P1",17,13,4],["P2",10,8,4]], итог 22 · 17, M = 4, Σ(|G|−1) = 4.
        assertEquals(List.of("P1", "P2"), R.list().stream().map(NewsV2Engine.Group::g).toList());
        assertArrayEquals(new int[]{17, 13, 4}, new int[]{R.list().get(0).ev(), R.list().get(0).el(), R.list().get(0).multi()});
        assertArrayEquals(new int[]{10, 8, 4}, new int[]{R.list().get(1).ev(), R.list().get(1).el(), R.list().get(1).multi()});
        assertEquals(22, R.totEv());
        assertEquals(17, R.totEl());
        assertEquals(4, R.M());
        assertEquals(4, R.extra());
        assertEquals(3, R.agEvT(), "три события серии агента");
        // по типам: задача 13·9, ADR 3·3, релиз 2·2, спека 2·1, решение 1·1, спринт 1·1
        NewsV2Engine.GroupCount T = e.groupCount(E, "type");
        Map<String, int[]> byType = new HashMap<>();
        for (NewsV2Engine.Group g : T.list()) byType.put(g.g(), new int[]{g.ev(), g.el()});
        assertArrayEquals(new int[]{13, 9}, byType.get("task"));
        assertArrayEquals(new int[]{3, 3}, byType.get("adr"));
        assertArrayEquals(new int[]{2, 2}, byType.get("release"));
        assertArrayEquals(new int[]{2, 1}, byType.get("spec"));
    }

    @Test
    void rollupFoldsTheAgentSeriesWithoutChangingCounts() {
        NewsV2Engine e = engine();
        List<Event> E = e.prepare(e.periodEvents()).E();
        List<NewsV2Engine.Series> s = e.rollup(E).stream().filter(x -> x.items().size() > 1).toList();
        // JS: [["changed|agent:claude|sprint:S1", 3]]
        assertEquals(1, s.size());
        assertEquals("changed|agent:claude|sprint:S1", s.get(0).key());
        assertEquals(3, s.get(0).items().size());
        assertEquals(E.size(), e.rollup(E).stream().mapToInt(x -> x.items().size()).sum());
    }

    // ───────────────────────── §7.2 / §7.2a: сгорание и выкатка ─────────────────────────

    @Test
    void burnAndShipMatchTheJsModel() {
        NewsV2Engine.ShipModel M = engine().shipModel(NewsV2.Query.none());
        NewsV2Engine.Part a = M.all.total;
        // JS shipPure.all: oO 8→6, nO 6→5, Y 0→2, Yu(t1) 1, S 1, C 3, A 2, oC 3, oA 1, unk 0
        assertEquals(8, a.oO0); assertEquals(6, a.oO1);
        assertEquals(6, a.nO0); assertEquals(5, a.nO1);
        assertEquals(0, a.Y0);  assertEquals(2, a.Y1); assertEquals(1, a.Yu1);
        assertEquals(1, a.S);
        assertEquals(3, a.C); assertEquals(2, a.A); assertEquals(3, a.oC); assertEquals(1, a.oA);
        assertEquals(0, a.unk);
        assertEquals(1, a.burn());
        assertEquals(2, a.burnDict());
        assertEquals(-1, a.dShip(), "поправка выкатки: +1 · −1 (по словарю было бы +2)");
        assertEquals(4, a.W, "JS burn().all.W = 4: A, B, H, G");
        // дневные ряды (JS labels 01..07.11): nO 6,6,7,6,6,5,5,5; S в день 04.11
        assertArrayEquals(new int[]{6, 6, 7, 6, 6, 5, 5, 5}, M.all.dayNO);
        assertArrayEquals(new int[]{8, 8, 8, 7, 7, 6, 6, 6}, M.all.dayOO);
        assertArrayEquals(new int[]{0, 0, 0, 1, 0, 1, 2, 2}, M.all.dayY);
        assertArrayEquals(new int[]{0, 0, 0, 1, 0, 0, 0}, M.all.dayS);
        // JS: waits ["S1/F:1"], med 1, oldest [D (2.4583, wait), E (1.4583, unknown)], entered 3, r2c 0
        assertEquals(1, M.waits.size());
        assertEquals("S1/F", M.waits.get(0).uid());
        assertEquals(1, M.waits.get(0).days());
        assertEquals(1.0, M.median);
        assertEquals(List.of("S1/D", "S3/E"), M.oldest.stream().map(NewsV2Engine.Oldest::uid).toList());
        assertEquals(2.4583, M.oldest.get(0).ageDays(), 1e-4);
        assertEquals("unknown", M.oldest.get(1).ship());
        assertEquals(3, M.enteredReady);
        assertEquals(0, M.readyToClosedNoRel);
        // JS proj p:P1: nO 5→4, oO 7→5; p:P2: nO 2→1, Yu 1
        NewsV2Engine.Part p1 = M.byAxis.get("project").get("P1").total, p2 = M.byAxis.get("project").get("P2").total;
        assertEquals(5, p1.nO0); assertEquals(4, p1.nO1); assertEquals(7, p1.oO0); assertEquals(5, p1.oO1);
        assertEquals(2, p2.nO0); assertEquals(1, p2.nO1); assertEquals(1, p2.Yu1);
    }

    @Test
    void ownAndSharedBurnDecompose() {
        NewsV2Engine.ShipModel M = engine().shipModel(NewsV2.Query.none());
        Map<String, NewsV2Engine.TaskGroup> byProject = M.byAxis.get("project");
        // Спека §7.2b, расчёт по задачам. P1: свои B(+1) F(+1) C(−1) K(−1) D U H (0) = 0; общие G(+1) A(0) = +1.
        // P2: своя E (0) = 0; общие G(+1) A(0) = +1. Σ по проектам = 2 ≠ итог 1 (G считается дважды).
        assertEquals(1, byProject.get("P1").total.burn());
        assertEquals(0, byProject.get("P1").own.burn());
        assertEquals(1, byProject.get("P1").shared.burn());
        assertEquals(1, byProject.get("P2").total.burn());
        assertEquals(0, byProject.get("P2").own.burn());
        assertEquals(1, byProject.get("P2").shared.burn());
        // Burn^Σ = Σ own + Burn^{sh,∪} = 0 + 0 + 1 = итог 1
        assertEquals(1, M.sharedUnion.get("project").burn());
        assertEquals(M.all.total.burn(), byProject.values().stream().mapToInt(g -> g.own.burn()).sum() + M.sharedUnion.get("project").burn());
    }

    // ───────────────────────── §7.2c: реактивация ─────────────────────────

    @Test
    void reactivationCountsAEventsButOnlyKInAddedReact() {
        NewsV2Engine.ShipModel M = engine().shipModel(NewsV2.Query.none());
        NewsV2Engine.Part a = M.all.total;
        // A: закрыта → открыта (из закрытой, не выпускалась), снова закрыта — в A^react не входит.
        // K: выпущена (P1#v1 20.10) → открыта 04.11 — «после выпуска», осталась открытой → A^react.
        assertEquals(2, a.reactEv);
        assertEquals(2, a.reactEl);
        assertEquals(1, a.reactFromClosed);
        assertEquals(1, a.reactAfterRelease);
        assertEquals(0, a.reactFromReady);
        assertEquals(1, a.aReact, "только K");
        assertEquals(1, a.aNew(), "только C");
        assertEquals(a.A, a.aNew() + a.aReact);
        // Знаменатель: сделано хоть раз на t0 или в P — A, B, D, F, H, K, E, G = 8 (C и U — нет).
        assertEquals(8, a.doneEver);
        assertEquals(0.25, a.reactRate(), 1e-9);
        // A — общая: реактивация видна в обоих проектах, в итоге один раз.
        assertEquals(1, M.byAxis.get("project").get("P2").total.reactEl);
        assertEquals(2, M.byAxis.get("project").get("P1").total.reactEl);
    }

    // ───────────────────────── §7.3 знания ─────────────────────────

    @Test
    @SuppressWarnings("unchecked")
    void knowledgeQueueIsARangeUntilS2_13() {
        NewsV2Engine e = engine();
        Map<String, Object> res = e.compute(NewsV2.Query.none());
        Map<String, Object> k = (Map<String, Object>) ((Map<String, Object>) res.get("metrics")).get("knowledge");
        Map<String, Object> adr = (Map<String, Object>) k.get("adr");
        // JS knowledge(): adr Q1 2, Q0 ∈ [1, 2], new 1 (proposed 1); dec Q1 0, new 1 (decided 1)
        assertEquals(false, adr.get("exact"));
        assertEquals(2, adr.get("q_t1"));
        assertEquals(List.of(1, 2), adr.get("q_t0_range"));
        assertEquals(1, adr.get("new"));
        assertEquals(1, adr.get("new_proposed"));
        Map<String, Object> dec = (Map<String, Object>) k.get("decision");
        assertEquals(0, dec.get("q_t1"));
        assertEquals(1, dec.get("new_decided"));
        // JS revEv 1, specVev 1, specNew 1, ADR-1 → 1 решение.
        assertEquals(Map.of("events", 1, "elements", 1), k.get("adr_revisions"));
        assertEquals(Map.of("events", 1, "elements", 1), k.get("spec_versions"));
        assertEquals(1L, k.get("spec_new"));
        // ОТЛИЧИЕ ОТ ПРОТОТИПА (намеренное): JS adrChEv = 3 считает по сырым D.events,
        // вместе с правкой ADR-1 в день создания. По §5 спеки день создания не даёт
        // «изменено» — сервер считает по набору E после подготовки: 2 · 2.
        assertEquals(Map.of("events", 2, "elements", 2), k.get("adr_changes"));
    }

    // ───────────────────────── §10: валидация и положительный контроль ─────────────────────────

    @Test
    @SuppressWarnings("unchecked")
    void allInvariantsHoldOnTheFixture() {
        Map<String, Object> res = engine().compute(NewsV2.Query.none());
        Map<String, Object> val = (Map<String, Object>) ((Map<String, Object>) res.get("meta")).get("validation");
        List<Map<String, Object>> checks = (List<Map<String, Object>>) val.get("checks");
        List<String> failed = checks.stream().filter(c -> Boolean.FALSE.equals(c.get("ok")))
            .map(c -> c.get("inv") + " " + c.get("name") + ": " + c.get("detail")).toList();
        assertEquals(List.of(), failed);
        assertEquals(true, val.get("ok"));
        Set<String> invs = new TreeSet<>();
        for (Map<String, Object> c : checks) invs.add(String.valueOf(c.get("inv")));
        for (String inv : List.of("1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "10.2"))
            assertTrue(invs.contains(inv), "инвариант " + inv + " не проверялся: " + invs);
        // Flow знаний и выкатка E — «не смогли проверить» (жёлтое), а не зелёное и не красное.
        assertTrue(checks.stream().anyMatch(c -> "5".equals(c.get("inv")) && c.get("ok") == null));
        assertTrue(checks.stream().anyMatch(c -> "7.2a".equals(c.get("inv")) && c.get("ok") == null));
    }

    @Test
    @SuppressWarnings("unchecked")
    void positiveControlRemovedVersionOfABreaksValidation() {
        Map<String, Object> res = engine(true, null).compute(NewsV2.Query.none());
        Map<String, Object> val = (Map<String, Object>) ((Map<String, Object>) res.get("meta")).get("validation");
        assertEquals(false, val.get("ok"), "удалена версия A → снимок (✅) не совпал с историей (🔄)");
        List<Map<String, Object>> drift = (List<Map<String, Object>>) val.get("drift");
        assertFalse(drift.isEmpty());
        assertTrue(drift.stream().anyMatch(d -> ((List<String>) d.get("examples")).contains("S2/A")), String.valueOf(drift));
    }

    // ───────────────────────── матрица, фильтры, скоуп, дельта, черта ─────────────────────────

    @Test
    void matrixMatchesJs() {
        NewsV2Engine e = engine();
        NewsV2Engine.Matrix m = e.matrix(e.prepare(e.periodEvents()).E(), 1);
        // JS matrix('msk', 1): cols [P1, прочие(1)], grand 22·17, Σ строк 22·20, столбцы 17·13 и 10·8
        assertEquals(List.of("P1", "(other:1)"), m.cols());
        assertEquals(22, m.ev()); assertEquals(17, m.el());
        assertEquals(22, m.sumRowEv()); assertEquals(20, m.sumRowEl());
        assertEquals(6, m.rows().size());
        NewsV2Engine.MatrixRow d04 = m.rows().get(3);
        assertEquals("2026-11-04", d04.day());
        assertArrayEquals(new int[]{5, 3}, d04.cells().get(0), "04.11: P1 5 событий · 3 элемента");
        assertEquals(2, m.colT().get(0).M()); assertEquals(2, m.colT().get(1).M());
    }

    @Test
    @SuppressWarnings("unchecked")
    void filtersNarrowTheFeedAndClickOnNumberFiltersByElements() {
        NewsV2Engine e = engine();
        NewsV2.Query q = new NewsV2.Query(Set.of("task"), Set.of("P2"), null, null, null, null, null, null,
            "kind", null, null, null, null);
        Map<String, Object> res = e.compute(q);
        Map<String, Object> total = (Map<String, Object>) ((Map<String, Object>) res.get("meta")).get("total");
        assertEquals(4, total.get("events"), "задачи P2: A×2, E, G");
        assertEquals(3, total.get("elements"));
        // «клик по числу»: els — ровно элементы метрики «реактивации»
        NewsV2.Query byEls = new NewsV2.Query(null, null, null, null, null, null, null, Set.of("task:S2/A", "task:S1/K"),
            "project", null, null, null, null);
        Map<String, Object> r2 = e.compute(byEls);
        List<Map<String, Object>> rows = (List<Map<String, Object>>) r2.get("events");
        assertEquals(Set.of("task:S2/A", "task:S1/K"), new HashSet<>(rows.stream().map(r -> (String) r.get("el_key")).toList()));
    }

    @Test
    void scopeHidesElementsWithoutAllowedProjectAndTrimsGroups() {
        NewsV2Engine e = engine(false, Set.of("P2"));
        List<Event> E = e.prepare(e.periodEvents()).E();
        NewsV2Engine.GroupCount R = e.groupCount(E, "project");
        assertEquals(List.of("P2"), R.list().stream().map(NewsV2Engine.Group::g).toList(), "в группах — только разрешённые проекты");
        assertEquals(10, R.totEv());
        assertEquals(0, R.M(), "×N считается только по разрешённым проектам");
    }

    @Test
    @SuppressWarnings("unchecked")
    void deltaAndSinceMark() {
        NewsV2Engine e = engine();
        NewsV2.Query q = new NewsV2.Query(null, null, null, null, null, null, null, null, "project", null, null, null,
            Instant.parse("2026-11-05T00:00:00Z"));
        Map<String, Object> m = (Map<String, Object>) e.compute(q).get("metrics");
        Map<String, Object> d = (Map<String, Object>) ((Map<String, Object>) m.get("delta")).get("events");
        // P⁻ = 25.10–31.10: одно событие (B заведена 25.10). Процент не считается при f(P⁻) < 5.
        assertEquals(22, d.get("value")); assertEquals(1, d.get("previous")); assertEquals(21, d.get("delta"));
        assertNull(d.get("pct"));
        // с черты 05.11 00:00Z: D ready, ADR-3, G closed, E ready, SPEC-1 version
        Map<String, Object> since = (Map<String, Object>) m.get("since_mark");
        assertEquals(5, since.get("events"));
        assertEquals(5, since.get("elements"));
    }

    @Test
    void sourceErrorIsHonestNotEmpty() {
        Input in = new Input(T0, T1, T1, MSK, List.of(), sprints(), List.of(), List.of(),
            List.of(new SourceError("task_history", "upstream 502", true)), null);
        @SuppressWarnings("unchecked")
        Map<String, Object> meta = (Map<String, Object>) new NewsV2Engine(in, null, null).compute(NewsV2.Query.none()).get("meta");
        assertEquals("partial", meta.get("state"), "источник недоступен ≠ «ничего не было»");
        @SuppressWarnings("unchecked")
        Map<String, Object> tasks = (Map<String, Object>) ((Map<String, Object>) new NewsV2Engine(in, null, null)
            .compute(NewsV2.Query.none()).get("metrics")).get("tasks");
        assertEquals(false, tasks.get("available"));
        Input empty = new Input(T0, T1, T1, MSK, List.of(), sprints(), List.of(), List.of(), List.of(), null);
        @SuppressWarnings("unchecked")
        Map<String, Object> meta2 = (Map<String, Object>) new NewsV2Engine(empty, null, null).compute(NewsV2.Query.none()).get("meta");
        assertEquals("empty", meta2.get("state"));
    }

    /**
     * S7A-07: meta.truncated — честный флаг. Раньше limit только поднимал флаг,
     * а лента приходила целиком: «обрезано» при необрезанной выдаче — та же
     * неправда, что «пусто» при недоступном источнике. Обрезается только
     * список строк; числа (total, метрики) считаются по всему периоду.
     */
    @Test
    @SuppressWarnings("unchecked")
    void limitCutsTheFeedAndTruncatedTellsTheTruth() {
        NewsV2Engine e = engine();
        int all = ((List<Object>) e.compute(NewsV2.Query.none()).get("events")).size();
        assertTrue(all > 3, "фикстура обязана давать больше строк, чем limit");
        Map<String, Object> cut = e.compute(new NewsV2.Query(null, null, null, null, null, null, null, null,
            "project", null, null, 3, null));
        Map<String, Object> meta = (Map<String, Object>) cut.get("meta");
        assertEquals(3, ((List<Object>) cut.get("events")).size(), "limit режет ленту");
        assertEquals(true, meta.get("truncated"));
        assertEquals(22, ((Map<String, Object>) meta.get("total")).get("events"), "числа считаются по всему периоду, не по странице");
        Map<String, Object> wide = e.compute(new NewsV2.Query(null, null, null, null, null, null, null, null,
            "project", null, null, all, null));
        assertEquals(all, ((List<Object>) wide.get("events")).size());
        assertEquals(false, ((Map<String, Object>) wide.get("meta")).get("truncated"));
    }

    @Test
    void deterministicOutput() {
        assertEquals(engine().compute(NewsV2.Query.none()).toString(), engine().compute(NewsV2.Query.none()).toString());
    }

    @Test
    void atomCarriesTheSameRowsAsTheFeed() {
        Map<String, Object> res = engine().compute(NewsV2.Query.none());
        String xml = NewsAtomWriter.write(res, "https://lore.example/lore/news/v2/atom?project=P1", null);
        @SuppressWarnings("unchecked")
        int rows = ((List<Object>) res.get("events")).size();
        assertEquals(rows, xml.split("<entry>", -1).length - 1);
        assertTrue(xml.contains("×3"), "свёрнутая по дню правка C несёт ×3");
    }

    /**
     * S7A-12 (UI «Новости», 09.11): фильтр «Кто» по конкретному человеку/агенту и
     * счёт по оси who — как у остальных осей. Числа остальных метрик не меняются.
     */
    @Test
    @SuppressWarnings("unchecked")
    void whoAxisCountsAndFiltersByConcreteAuthor() {
        assertTrue(NewsV2Engine.AXES.contains("who"), "who — ось группировки и фильтра");
        Map<String, Object> all = engine().compute(NewsV2.Query.none());
        Map<String, Object> byWho = (Map<String, Object>) ((Map<String, Object>)
            ((Map<String, Object>) all.get("metrics")).get("counts")).get("by_who");
        assertNotNull(byWho, "metrics.counts.by_who — счёт по конкретным авторам");
        Map<String, Object> claude = (Map<String, Object>) byWho.get("agent:claude");
        assertNotNull(claude, "серия агента на C видна по имени: " + byWho);
        assertTrue(byWho.containsKey(NewsV2Engine.NOWHO), "автор неизвестен — своя группа, а не пропажа: " + byWho);

        Map<String, Object> only = engine().compute(new NewsV2.Query(null, null, null, null, null, null, null, null,
            "who", null, null, null, null, Set.of("agent:claude")));
        List<Map<String, Object>> groups = (List<Map<String, Object>>) ((Map<String, Object>) only.get("groups")).get("list");
        assertEquals(1, groups.size(), "фильтр who оставляет одного автора: " + groups);
        assertEquals(claude.get("events"), ((Map<String, Object>) ((Map<String, Object>)
            ((Map<String, Object>) only.get("metrics")).get("counts")).get("total")).get("events"),
            "события под фильтром = счёт этого автора в by_who");
    }

    /**
     * SPRINT_UXR_S9_SCALE_OPT/S9-11: свёртка ленты «по записи». В пиковый день
     * у одной записи бывает несколько событий (статус, правка, закрытие), и без
     * оси «запись» они рассыпаны по дню строками. Ключ группы — «тип:код», то есть
     * ровно элемент события: одна запись — одна группа, события в ней — её.
     */
    @Test
    @SuppressWarnings("unchecked")
    void recordAxisGroupsEventsOfOneElement() {
        assertTrue(NewsV2Engine.AXES.contains("record"), "record — ось группировки");
        Map<String, Object> res = engine().compute(new NewsV2.Query(null, null, null, null, null, null, null, null,
            "record", null, null, null, null, null));
        List<Map<String, Object>> groups = (List<Map<String, Object>>) ((Map<String, Object>) res.get("groups")).get("list");
        assertFalse(groups.isEmpty(), "группы по записи есть: " + res.get("groups"));
        for (Map<String, Object> g : groups) {
            String key = String.valueOf(g.get("key"));
            assertTrue(key.contains(":"), "ключ группы — «тип:код»: " + key);
            assertEquals(1, ((Number) g.get("elements")).intValue(), "в группе записи ровно один элемент: " + g);
        }
    }
}
