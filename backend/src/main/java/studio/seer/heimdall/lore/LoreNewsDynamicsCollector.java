package studio.seer.heimdall.lore;

import studio.seer.heimdall.lore.news.NewsDynamics;
import studio.seer.heimdall.lore.news.NewsDynamics.Fact;
import studio.seer.heimdall.lore.news.NewsV2.SourceError;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.*;
import java.util.function.BiFunction;

import static studio.seer.heimdall.lore.LoreNewsV2Collector.day;
import static studio.seer.heimdall.lore.LoreNewsV2Collector.flat;
import static studio.seer.heimdall.lore.LoreNewsV2Collector.instant;
import static studio.seer.heimdall.lore.LoreNewsV2Collector.list;
import static studio.seer.heimdall.lore.LoreNewsV2Collector.sortedSet;
import static studio.seer.heimdall.lore.LoreNewsV2Collector.str;
import static studio.seer.heimdall.lore.LoreNewsV2Collector.strList;

/**
 * SPRINT_UXR_S7A_NEWS/S7A-11: сбор фактов блока «Динамика» новостей.
 *
 * <p>Только нормализация строк в {@link NewsDynamics.Fact}; ряды, Δ и % считает
 * {@link NewsDynamics#compute}. Чтение — через функцию {@code query(sql, params)}, как у
 * {@link LoreNewsV2Collector}: сборщик проверяется юнит-тестом без БД, а сбой источника
 * попадает в errors, а не превращается в «ничего не было».
 *
 * <p>Правила:
 * <ul>
 *   <li><b>закрытие — по последнему статусу</b> (S7A-13): факт есть только у элемента,
 *       чья ОТКРЫТАЯ версия — «готово»; переоткрытая задача не закрыта;</li>
 *   <li><b>момент — момент статуса</b>: {@link LoreSlices#STATUS_SINCE_SQL} (status_known_from
 *       открытой версии). Правка текста (MT-NOTE-APPEND, version_kind='text') открывает
 *       версию, но момент статуса переносит — закрытием она не считается;</li>
 *   <li>задачи {@code bookkeeping} и «рождённые закрытыми» (одна статусная версия) —
 *       исключение с причиной, как в v1 Throughput ({@code taskThroughput.ts});</li>
 *   <li>статус, положенный бэкфиллом (V68 — ADR/решения, V71 — задачи), — «момент неизвестен»:
 *       дата бэкфилла не дата закрытия/принятия. Правка после бэкфилла переносит его момент,
 *       поэтому сверяется момент, а не флаг открытой версии.</li>
 * </ul>
 * Принадлежности (проекты, компоненты, спринт, вехи) — те же выражения, что у ленты
 * ({@link LoreNewsV2Collector}): фильтры динамики и ленты сужают одно и то же.
 */
final class LoreNewsDynamicsCollector {

    /** Спринты: принадлежности для задач и факт «закрыт» по последнему статусу. */
    static final String SQL_SPRINTS =
        "SELECT sprint_id, " +
        "out('BELONGS_TO_PROJECT').slug AS git_projects, " +
        "out('BELONGS_TO')[component_id IS NOT NULL].component_id AS components, " +
        "out('TARGETS_MILESTONE').milestone_id AS milestone_ids, " +
        "out('HAS_STATE')[valid_to IS NULL].status_raw[0] AS status_raw, " +
        LoreSlices.STATUS_SINCE_SQL + " AS status_since " +
        "FROM KnowSprint";

    /**
     * Задачи: последний статус и его момент, число статусных версий (правки текста не в счёт —
     * как {@code task_close_path}), все моменты версий (минимум — «заведена», как в ленте).
     */
    static final String SQL_TASKS =
        "SELECT task_uid, out('PART_OF').sprint_id[0] AS sprint_id, " +
        "out('BELONGS_TO').component_id[0] AS component_id, bookkeeping, " +
        "out('HAS_STATE')[valid_to IS NULL].status_raw[0] AS status_raw, " +
        LoreSlices.STATUS_SINCE_SQL + " AS status_since, " +
        "out('HAS_STATE')[version_kind IS NULL].size() AS status_versions, " +
        "out('HAS_STATE').valid_from AS hist_from " +
        "FROM KnowTask";

    static final String SQL_TASK_BACKFILL = backfillSql("KnowTaskHist", "task_uid");

    static final String SQL_RELEASES =
        "SELECT release_id, release_uid, release_date, released_at, git_project, " +
        "out('BELONGS_TO_PROJECT').slug AS projects FROM KnowRelease WHERE release_date IS NOT NULL";

    /** ADR: текущий статус вершины, статус и момент открытой версии истории. */
    static final String SQL_ADRS =
        "SELECT adr_id, status, " +
        "out('HAS_STATE')[valid_to IS NULL].status_raw[0] AS hist_status, " +
        LoreSlices.STATUS_SINCE_SQL + " AS status_since, " +
        "out('BELONGS_TO_PROJECT').slug AS projects, " +
        "out('BELONGS_TO').component_id AS components " +
        "FROM KnowADR";

    static final String SQL_ADR_BACKFILL = backfillSql("KnowADRHist", "adr_id");

    /** Решения: проект — свой, иначе проекты ADR (как лента: timeline_decisions.adr_projects). */
    static final String SQL_DECISIONS =
        "SELECT decision_id, status_raw, " +
        "out('HAS_STATE')[valid_to IS NULL].status_raw[0] AS hist_status, " +
        LoreSlices.STATUS_SINCE_SQL + " AS status_since, " +
        "out('BELONGS_TO_PROJECT').slug AS projects, " +
        "out('DECIDED_IN').out('BELONGS_TO_PROJECT').slug AS adr_projects, " +
        "out('BELONGS_TO').component_id AS components " +
        "FROM KnowDecision";

    static final String SQL_DECISION_BACKFILL = backfillSql("KnowDecisionHist", "decision_id");

    /** Имена источников — ключи {@link NewsDynamics#METRIC_SOURCES}. */
    static final List<String> SOURCES = List.of("sprints", "tasks", "task_backfill", "releases",
        "adrs", "adr_backfill", "decisions", "decision_backfill");

    /** Версии, чей статус положен бэкфиллом: владельцы, начало версии и «известен с». */
    static String backfillSql(String hist, String key) {
        return "SELECT in('HAS_STATE')." + key + " AS owners, valid_from, status_known_from FROM " + hist
            + " WHERE status_backfilled = true";
    }

    private final BiFunction<String, Map<String, Object>, List<Map<String, Object>>> query;
    private final List<SourceError> errors = new ArrayList<>();

    LoreNewsDynamicsCollector(BiFunction<String, Map<String, Object>, List<Map<String, Object>>> query) {
        this.query = query;
    }

    private List<Map<String, Object>> read(String source, String sql) {
        try {
            List<Map<String, Object>> rows = query.apply(sql, Map.of());
            return rows == null ? List.of() : rows;
        } catch (Exception e) {
            errors.add(new SourceError(source, String.valueOf(e.getMessage()), true,
                LoreNewsV2Collector.forbidden(e), null));
            return List.of();
        }
    }

    /** Моменты бэкфилла по владельцу: начала версий и «известен с» (любой из них — не настоящий момент). */
    private Map<String, Set<Instant>> backfill(String source, String sql) {
        Map<String, Set<Instant>> out = new HashMap<>();
        for (Map<String, Object> r : read(source, sql)) {
            Set<Instant> at = new HashSet<>();
            for (String f : new String[]{"valid_from", "status_known_from"}) {
                Instant i = instant(r.get(f));
                if (i != null) at.add(i);
            }
            for (String id : strList(r.get("owners"))) out.computeIfAbsent(id, k -> new HashSet<>()).addAll(at);
        }
        return out;
    }

    private record SprintInfo(List<String> projects, List<String> components, List<String> milestones) {}

    NewsDynamics.Input collect(Set<String> scope) {
        // ── спринты ──
        Map<String, SprintInfo> sprints = new HashMap<>();
        List<Fact> facts = new ArrayList<>();
        for (Map<String, Object> s : read("sprints", SQL_SPRINTS)) {
            String sid = str(s.get("sprint_id"));
            if (sid == null || sprints.containsKey(sid)) continue;
            SprintInfo si = new SprintInfo(sortedSet(s.get("git_projects")), sortedSet(s.get("components")),
                sortedSet(s.get("milestone_ids")));
            sprints.put(sid, si);
            if (done(s.get("status_raw"))) {
                Instant at = instant(s.get("status_since"));
                facts.add(new Fact("sprints_closed", "sprint", sid, at, si.projects(), si.components(), sid,
                    si.milestones(), at == null ? NewsDynamics.EX_MOMENT_UNKNOWN : null));
            }
        }

        // ── задачи ──
        Map<String, Set<Instant>> taskBf = backfill("task_backfill", SQL_TASK_BACKFILL);
        Set<String> seenTasks = new HashSet<>();
        for (Map<String, Object> t : read("tasks", SQL_TASKS)) {
            String uid = str(t.get("task_uid"));
            if (uid == null || !seenTasks.add(uid)) continue;
            String sid = str(t.get("sprint_id"));
            if (sid == null && uid.contains("/")) sid = uid.substring(0, uid.indexOf('/'));
            SprintInfo si = sid == null ? null : sprints.get(sid);
            List<String> projects = si == null ? List.of() : si.projects();
            String comp = str(t.get("component_id"));
            List<String> comps = comp != null ? List.of(comp) : si == null ? List.of() : si.components();
            List<String> ms = si == null ? List.of() : si.milestones();
            boolean bookkeeping = Boolean.TRUE.equals(first(t.get("bookkeeping")));
            Set<Instant> bf = taskBf.getOrDefault(uid, Set.of());

            Instant created = null;
            for (Object o : flat(t.get("hist_from"))) {
                Instant i = instant(o);
                if (i != null && (created == null || i.isBefore(created))) created = i;
            }
            // Первая версия положена бэкфиллом (V71: задача без истории) — момент заведения неизвестен.
            boolean createdUnknown = created == null || bf.contains(created);
            String exCreated = bookkeeping ? NewsDynamics.EX_BOOKKEEPING
                : createdUnknown ? NewsDynamics.EX_MOMENT_UNKNOWN : null;
            facts.add(new Fact("tasks_created", "task", uid, createdUnknown ? null : created,
                projects, comps, sid, ms, exCreated));

            if (done(t.get("status_raw"))) {
                Instant at = instant(t.get("status_since"));
                boolean unknown = at == null || bf.contains(at);
                Number versions = num(t.get("status_versions"));
                String ex = bookkeeping ? NewsDynamics.EX_BOOKKEEPING
                    : unknown ? NewsDynamics.EX_MOMENT_UNKNOWN
                    : versions != null && versions.intValue() <= 1 ? NewsDynamics.EX_BORN_DONE : null;
                facts.add(new Fact("tasks_closed", "task", uid, unknown ? null : at, projects, comps, sid, ms, ex));
            }
        }

        // ── релизы: момент, если известен; иначе день UTC ──
        for (Map<String, Object> r : read("releases", SQL_RELEASES)) {
            Instant at = instant(r.get("released_at"));
            if (at == null) {
                LocalDate d = day(r.get("release_date"));
                if (d == null) continue;
                at = d.atStartOfDay(ZoneOffset.UTC).toInstant();
            }
            List<String> p = sortedSet(r.get("projects"));
            if (p.isEmpty()) p = sortedSet(r.get("git_project"));
            String id = Optional.ofNullable(str(r.get("release_uid"))).orElse(str(r.get("release_id")));
            if (id == null) continue;
            facts.add(new Fact("releases", "release", id, at, p, List.of(), null, List.of(), null));
        }

        // ── принято: ADR и решения ──
        Map<String, Set<Instant>> adrBf = backfill("adr_backfill", SQL_ADR_BACKFILL);
        for (Map<String, Object> a : read("adrs", SQL_ADRS)) {
            String id = str(a.get("adr_id"));
            if (id == null || !NewsDynamics.accepted(str(a.get("status")))) continue;
            facts.add(knowledge("adr", id, a, sortedSet(a.get("projects")), adrBf));
        }
        Map<String, Set<Instant>> decBf = backfill("decision_backfill", SQL_DECISION_BACKFILL);
        for (Map<String, Object> d : read("decisions", SQL_DECISIONS)) {
            String id = str(d.get("decision_id"));
            if (id == null || !NewsDynamics.accepted(str(d.get("status_raw")))) continue;
            List<String> p = sortedSet(d.get("projects"));
            if (p.isEmpty()) p = sortedSet(flat(d.get("adr_projects")));
            facts.add(knowledge("decision", id, d, p, decBf));
        }

        return new NewsDynamics.Input(facts, List.copyOf(errors), scope);
    }

    /**
     * Факт «принято»: момент — момент статуса открытой версии, только если версия статус
     * несёт (до S2-13 история ADR хранила одни тела) и он не момент бэкфилла.
     */
    private static Fact knowledge(String type, String id, Map<String, Object> r, List<String> projects,
                                  Map<String, Set<Instant>> bf) {
        Instant at = instant(r.get("status_since"));
        boolean unknown = at == null || str(r.get("hist_status")) == null || bf.getOrDefault(id, Set.of()).contains(at);
        return new Fact("accepted", type, id, unknown ? null : at, projects, sortedSet(flat(r.get("components"))),
            null, List.of(), unknown ? NewsDynamics.EX_MOMENT_UNKNOWN : null);
    }

    /** «Готово» — канон словаря статусов (тот же, что DONE_STATUS_SQL и task_done_dates). */
    static boolean done(Object raw) {
        return "done".equals(LoreStatusVocabulary.classify(str(raw)));
    }

    private static Object first(Object v) {
        List<Object> l = list(v);
        return l.isEmpty() ? null : l.get(0);
    }

    private static Number num(Object v) {
        Object o = first(v);
        if (o instanceof Number n) return n;
        try { return o == null ? null : Integer.valueOf(String.valueOf(o).trim()); }
        catch (NumberFormatException e) { return null; }
    }
}
