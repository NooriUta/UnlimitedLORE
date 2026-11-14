package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;
import studio.seer.heimdall.lore.news.NewsDynamics;

import java.time.Instant;
import java.util.*;
import java.util.function.BiFunction;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S7A_NEWS/S7A-11 — сборщик фактов «Динамики» на подставных строках, без БД.
 *
 * <p>Правила владелицы, которые держит тест:
 * <ul>
 *   <li>закрытие задачи — по ПОСЛЕДНЕМУ статусу (S7A-13): переоткрытая задача не закрыта;</li>
 *   <li>момент закрытия — момент статуса ({@code status_since} = STATUS_SINCE_SQL), не правка текста;</li>
 *   <li>{@code bookkeeping} исключается, как в v1 Throughput, и называется числом;</li>
 *   <li>статус, положенный бэкфиллом, — «момент неизвестен», а не дата бэкфилла.</li>
 * </ul>
 */
class LoreNewsDynamicsCollectorTest {

    static Map<String, Object> row(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    static BiFunction<String, Map<String, Object>, List<Map<String, Object>>> db(Map<String, List<Map<String, Object>>> by) {
        return (sql, p) -> by.getOrDefault(sql, List.of());
    }

    static final Map<String, Object> SPRINT = row("sprint_id", "S1", "git_projects", List.of("lore"),
        "components", List.of("lore-news"), "milestone_ids", List.of("M1"),
        "status_raw", "🔄 IN PROGRESS", "status_since", "2026-11-01T09:00:00Z");

    static List<NewsDynamics.Fact> of(NewsDynamics.Input in, String metric) {
        return in.facts().stream().filter(f -> f.metric().equals(metric)).toList();
    }

    static NewsDynamics.Fact one(NewsDynamics.Input in, String metric, String id) {
        List<NewsDynamics.Fact> l = of(in, metric).stream().filter(f -> f.id().equals(id)).toList();
        assertEquals(1, l.size(), metric + " " + id + ": " + in.facts());
        return l.get(0);
    }

    @Test
    void закрытаяЗадача_моментСтатуса_принадлежностиСпринта() {
        NewsDynamics.Input in = new LoreNewsDynamicsCollector(db(Map.of(
            LoreNewsDynamicsCollector.SQL_SPRINTS, List.of(SPRINT),
            LoreNewsDynamicsCollector.SQL_TASKS, List.of(row("task_uid", "S1/T-1", "sprint_id", "S1", "component_id", null,
                "bookkeeping", null, "status_raw", "✅ DONE", "status_since", "2026-11-10T08:00:00Z", "status_versions", 3,
                "hist_from", List.of("2026-11-12T08:00:00Z", "2026-11-02T08:00:00Z", "2026-11-10T08:00:00Z")))))).collect(null);
        assertEquals(List.of(), in.errors());
        NewsDynamics.Fact c = one(in, "tasks_closed", "S1/T-1");
        assertEquals(Instant.parse("2026-11-10T08:00:00Z"), c.at(), "момент статуса, а не последняя версия (правка текста 12.11)");
        assertNull(c.excluded());
        assertEquals(List.of("lore"), c.projects());
        assertEquals(List.of("lore-news"), c.components(), "нет своего компонента — компоненты спринта, как в ленте");
        assertEquals("S1", c.sprint());
        assertEquals(List.of("M1"), c.milestones());
        NewsDynamics.Fact cr = one(in, "tasks_created", "S1/T-1");
        assertEquals(Instant.parse("2026-11-02T08:00:00Z"), cr.at(), "заведена — первая версия истории (минимум)");
    }

    @Test
    void переоткрытаяИСнятая_неЗакрыты() {
        NewsDynamics.Input in = new LoreNewsDynamicsCollector(db(Map.of(
            LoreNewsDynamicsCollector.SQL_SPRINTS, List.of(SPRINT),
            LoreNewsDynamicsCollector.SQL_TASKS, List.of(
                row("task_uid", "S1/T-1", "sprint_id", "S1", "status_raw", "🔄 IN PROGRESS", "status_since", "2026-11-11T08:00:00Z",
                    "status_versions", 4, "hist_from", List.of("2026-11-02T08:00:00Z")),
                row("task_uid", "S1/T-2", "sprint_id", "S1", "status_raw", "🚫 CANCELLED", "status_since", "2026-11-11T08:00:00Z",
                    "status_versions", 2, "hist_from", List.of("2026-11-02T08:00:00Z")))))).collect(null);
        assertEquals(List.of(), of(in, "tasks_closed"), "по последнему статусу: переоткрыта — не закрыта; снята — не «закрыто»");
        assertEquals(2, of(in, "tasks_created").size());
    }

    @Test
    void bookkeepingИРождённаяЗакрытой_исключеныСПричиной() {
        NewsDynamics.Input in = new LoreNewsDynamicsCollector(db(Map.of(
            LoreNewsDynamicsCollector.SQL_SPRINTS, List.of(SPRINT),
            LoreNewsDynamicsCollector.SQL_TASKS, List.of(
                row("task_uid", "S1/T-1", "sprint_id", "S1", "bookkeeping", true, "status_raw", "✅ DONE",
                    "status_since", "2026-11-10T08:00:00Z", "status_versions", 3, "hist_from", List.of("2026-11-02T08:00:00Z")),
                row("task_uid", "S1/T-2", "sprint_id", "S1", "bookkeeping", false, "status_raw", "✅ DONE",
                    "status_since", "2026-11-10T08:00:00Z", "status_versions", 1, "hist_from", List.of("2026-11-10T08:00:00Z")))))).collect(null);
        assertEquals("bookkeeping", one(in, "tasks_closed", "S1/T-1").excluded());
        assertEquals("bookkeeping", one(in, "tasks_created", "S1/T-1").excluded(), "запись задним числом — и не «заведена»");
        assertEquals("born_done", one(in, "tasks_closed", "S1/T-2").excluded(), "как v1 Throughput: states ≤ 1 — не закрытие");
        assertNull(one(in, "tasks_created", "S1/T-2").excluded());
    }

    @Test
    void бэкфилл_моментНеизвестен() {
        NewsDynamics.Input in = new LoreNewsDynamicsCollector(db(Map.of(
            LoreNewsDynamicsCollector.SQL_SPRINTS, List.of(SPRINT),
            LoreNewsDynamicsCollector.SQL_TASKS, List.of(
                row("task_uid", "S1/T-1", "sprint_id", "S1", "status_raw", "✅ DONE", "status_since", "2026-11-05T00:00:00Z",
                    "status_versions", 2, "hist_from", List.of("2026-11-05T00:00:00Z", "2026-11-09T00:00:00Z"))),
            LoreNewsDynamicsCollector.SQL_TASK_BACKFILL, List.of(
                row("owners", List.of("S1/T-1"), "valid_from", "2026-11-05T00:00:00Z", "status_known_from", "2026-11-05T00:00:00Z"))))).collect(null);
        NewsDynamics.Fact c = one(in, "tasks_closed", "S1/T-1");
        assertEquals("moment_unknown", c.excluded());
        assertNull(c.at(), "дата бэкфилла — не дата закрытия");
        assertEquals("moment_unknown", one(in, "tasks_created", "S1/T-1").excluded());
    }

    @Test
    void спринтЗакрыт_поПоследнемуСтатусу() {
        NewsDynamics.Input in = new LoreNewsDynamicsCollector(db(Map.of(
            LoreNewsDynamicsCollector.SQL_SPRINTS, List.of(SPRINT,
                row("sprint_id", "S2", "git_projects", List.of("mini"), "components", List.of(), "milestone_ids", List.of(),
                    "status_raw", "✅ DONE", "status_since", "2026-11-10T08:00:00Z"))))).collect(null);
        List<NewsDynamics.Fact> s = of(in, "sprints_closed");
        assertEquals(1, s.size());
        assertEquals("S2", s.get(0).id());
        assertEquals("S2", s.get(0).sprint());
        assertEquals(List.of("mini"), s.get(0).projects());
    }

    @Test
    void релиз_моментИлиДеньUtc_проектыСФолбэком() {
        NewsDynamics.Input in = new LoreNewsDynamicsCollector(db(Map.of(
            LoreNewsDynamicsCollector.SQL_RELEASES, List.of(
                row("release_id", "v1", "release_uid", "lore#v1", "release_date", "2026-11-10", "released_at", "2026-11-10T21:30:00Z",
                    "projects", List.of("lore")),
                row("release_id", "v2", "release_uid", null, "release_date", "2026-11-11", "released_at", null,
                    "git_project", "mini", "projects", List.of()))))).collect(null);
        assertEquals(Instant.parse("2026-11-10T21:30:00Z"), one(in, "releases", "lore#v1").at());
        NewsDynamics.Fact v2 = one(in, "releases", "v2");
        assertEquals(Instant.parse("2026-11-11T00:00:00Z"), v2.at(), "только дата — день UTC");
        assertEquals(List.of("mini"), v2.projects());
    }

    @Test
    void принято_ADRИРешения_поТекущемуСтатусу_моментСтатуса() {
        NewsDynamics.Input in = new LoreNewsDynamicsCollector(db(Map.of(
            LoreNewsDynamicsCollector.SQL_ADRS, List.of(
                row("adr_id", "ADR-1", "status", "ACCEPTED", "hist_status", "ACCEPTED", "status_since", "2026-11-10T08:00:00Z",
                    "projects", List.of("lore"), "components", List.of("lore-news")),
                row("adr_id", "ADR-2", "status", "PROPOSED", "hist_status", "PROPOSED", "status_since", "2026-11-10T08:00:00Z",
                    "projects", List.of("lore"), "components", List.of()),
                row("adr_id", "ADR-3", "status", "accepted", "hist_status", null, "status_since", "2026-11-10T08:00:00Z",
                    "projects", List.of("lore"), "components", List.of())),
            LoreNewsDynamicsCollector.SQL_DECISIONS, List.of(
                row("decision_id", "D-1", "status_raw", "fixed", "hist_status", "fixed", "status_since", "2026-11-11T08:00:00Z",
                    "projects", List.of(), "adr_projects", List.of(List.of("mini")), "components", List.of()))))).collect(null);
        NewsDynamics.Fact a = one(in, "accepted", "ADR-1");
        assertEquals("adr", a.type());
        assertEquals(Instant.parse("2026-11-10T08:00:00Z"), a.at());
        assertEquals(List.of("lore-news"), a.components());
        assertTrue(of(in, "accepted").stream().noneMatch(f -> f.id().equals("ADR-2")));
        assertEquals("moment_unknown", one(in, "accepted", "ADR-3").excluded(), "у версии нет статуса — момент принятия неизвестен");
        NewsDynamics.Fact d = one(in, "accepted", "D-1");
        assertEquals("decision", d.type());
        assertEquals(List.of("mini"), d.projects(), "нет своего проекта — проекты ADR, как в ленте");
    }

    @Test
    void ADRСБэкфилломИПравкойПосле_моментНеизвестен() {
        // Правка текста после бэкфилла переносит status_known_from (момент бэкфилла) в новую версию.
        NewsDynamics.Input in = new LoreNewsDynamicsCollector(db(Map.of(
            LoreNewsDynamicsCollector.SQL_ADRS, List.of(
                row("adr_id", "ADR-1", "status", "ACCEPTED", "hist_status", "ACCEPTED", "status_since", "2026-10-20T00:00:00Z",
                    "projects", List.of("lore"), "components", List.of())),
            LoreNewsDynamicsCollector.SQL_ADR_BACKFILL, List.of(
                row("owners", List.of("ADR-1"), "valid_from", "2026-10-20T00:00:00Z", "status_known_from", "2026-10-20T00:00:00Z"))))).collect(null);
        assertEquals("moment_unknown", one(in, "accepted", "ADR-1").excluded());
    }

    @Test
    void сбойИсточника_вErrors_аНеПустота() {
        NewsDynamics.Input in = new LoreNewsDynamicsCollector((sql, p) -> {
            if (sql.equals(LoreNewsDynamicsCollector.SQL_RELEASES)) throw new IllegalStateException("upstream 502");
            return List.of();
        }).collect(Set.of("lore"));
        assertTrue(in.errors().stream().anyMatch(e -> e.source().equals("releases") && e.error().contains("502")), String.valueOf(in.errors()));
        assertEquals(Set.of("lore"), in.scope());
    }

    @Test
    void источникиСборщика_покрываютВсеМетрики() {
        Set<String> sources = new TreeSet<>();
        for (Set<String> s : NewsDynamics.METRIC_SOURCES.values()) sources.addAll(s);
        assertEquals(new TreeSet<>(LoreNewsDynamicsCollector.SOURCES), sources,
            "каждый источник сборщика привязан к метрикам — иначе его сбой ничего не пометит");
    }
}
