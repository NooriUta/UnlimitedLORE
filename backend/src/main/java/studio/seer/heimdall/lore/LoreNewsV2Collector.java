package studio.seer.heimdall.lore;

import studio.seer.heimdall.lore.news.AuthorResolver;
import studio.seer.heimdall.lore.news.KnowledgeStatusHistory;
import studio.seer.heimdall.lore.news.NewsV2;
import studio.seer.heimdall.lore.news.NewsV2.Event;
import studio.seer.heimdall.lore.news.NewsV2.Knowledge;
import studio.seer.heimdall.lore.news.NewsV2.Release;
import studio.seer.heimdall.lore.news.NewsV2.SourceError;
import studio.seer.heimdall.lore.news.NewsV2.Sprint;
import studio.seer.heimdall.lore.news.NewsV2.TaskRecord;
import studio.seer.heimdall.lore.news.NewsV2.Version;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.*;
import java.util.function.BiFunction;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SPRINT_UXR_S7A_NEWS/S7A-01: сбор входа новостей v2 из SCD2-истории всех типов.
 *
 * <p>Только нормализация (порт {@code docs/prototypes/news-proof/build.cjs}):
 * строки срезов → {@link NewsV2.Input}. Ни одной метрики — их считает
 * {@link studio.seer.heimdall.lore.news.NewsV2Engine}.
 *
 * <p>Чтение через функцию {@code query(sql, params)}, а не через бин: так
 * сборщик проверяется юнит-тестом на подставных строках, без БД. Каждый
 * источник читается в своём try: сбой одного не роняет ленту, а попадает в
 * {@code errors[]} (S7A-07, «источник недоступен» ≠ «ничего не было»).
 *
 * <p>Окно: события берутся с начала ПРЕДЫДУЩЕГО периода (для дельты §7.5);
 * история задач — целиком (состояние на t0 требует последней версии до t0).
 */
final class LoreNewsV2Collector {

    /** Все версии задач со статусом: состояние на t0/t1 и события (§1, §7.2). */
    static final String SQL_TASK_HIST =
        "SELECT in('HAS_STATE').task_uid[0] AS task_uid, valid_from, status_raw " +
        "FROM KnowTaskHist WHERE valid_from IS NOT NULL";
    static final String SQL_RELEASES =
        "SELECT release_id, release_uid, release_date, git_project, out('BELONGS_TO_PROJECT').slug AS projects " +
        "FROM KnowRelease WHERE release_date IS NOT NULL";
    static final String SQL_ADR_HIST =
        "SELECT in('HAS_STATE').adr_id[0] AS adr_id, valid_from, " +
        "in('HAS_STATE').out('BELONGS_TO_PROJECT').slug AS projects " +
        "FROM KnowADRHist WHERE valid_from IS NOT NULL";
    static final String SQL_SPEC_HIST =
        "SELECT in('HAS_STATE').spec_id[0] AS spec_id, valid_from, " +
        "in('HAS_STATE').out('BELONGS_TO_PROJECT').slug AS projects " +
        "FROM KnowSpecHist WHERE valid_from IS NOT NULL";

    private final BiFunction<String, Map<String, Object>, List<Map<String, Object>>> query;
    private final List<SourceError> errors = new ArrayList<>();

    LoreNewsV2Collector(BiFunction<String, Map<String, Object>, List<Map<String, Object>>> query) {
        this.query = query;
    }

    /**
     * S7A-01: автор события — из истории (S2-12 пишет changed_by/changed_by_kind в
     * каждую версию). Сначала история статусов ({@link StatusHistoryTimeline}: задачи,
     * спринты, фазы, ADR, спеки, решения), где автора нет — индекс по всем цепочкам
     * Hist ({@link HistAuthorIndex}). Нигде нет — честное «неизвестно», без догадки.
     */
    static AuthorResolver authors(StatusHistoryTimeline timeline, HistAuthorIndex index) {
        return (type, id, at) -> {
            AuthorResolver.Author a = timeline.authorOf(type, id, at);
            if (a != null && (a.who() != null || a.agent() != null)) return a;
            return index.authorOf(type, id, at, AuthorResolver.Author::new);
        };
    }

    private List<Map<String, Object>> read(String source, String sql, boolean critical) {
        try {
            List<Map<String, Object>> rows = query.apply(sql, Map.of());
            return rows == null ? List.of() : rows;
        } catch (Exception e) {
            errors.add(new SourceError(source, String.valueOf(e.getMessage()), critical));
            return List.of();
        }
    }

    private List<Map<String, Object>> slice(String sliceId, boolean critical) {
        LoreSlices.Composed c;
        try { c = LoreSlices.compose(sliceId, Map.of()); }
        catch (Exception e) { errors.add(new SourceError(sliceId, String.valueOf(e.getMessage()), critical)); return List.of(); }
        try {
            List<Map<String, Object>> rows = query.apply(c.sql(), c.params());
            return rows == null ? List.of() : rows;
        } catch (Exception e) {
            errors.add(new SourceError(sliceId, String.valueOf(e.getMessage()), critical));
            return List.of();
        }
    }

    NewsV2.Input collect(Instant t0, Instant t1, Instant now, ZoneId zone, Set<String> scope) {
        java.time.Duration len = java.time.Duration.between(t0, t1);
        java.time.Duration shift = len.compareTo(java.time.Duration.ofDays(1)) <= 0 ? java.time.Duration.ofDays(7) : len;
        Instant from = t0.minus(shift);
        LocalDate fromDay = from.atZone(zone).toLocalDate();
        LocalDate toDay = t1.minusMillis(1).atZone(zone).toLocalDate();

        // ── справочники ──
        Map<String, Sprint> sprints = new TreeMap<>();
        for (Map<String, Object> s : slice("sprints", true)) {
            String sid = str(s.get("sprint_id"));
            if (sid == null || sprints.containsKey(sid)) continue;
            List<String> ids = strList(s.get("release_ids"));
            List<Object> dates = list(s.get("release_dates"));
            List<Release> rel = new ArrayList<>();
            for (int i = 0; i < ids.size(); i++) {
                LocalDate d = i < dates.size() ? day(dates.get(i)) : null;
                if (d != null) rel.add(new Release(ids.get(i), d));
            }
            sprints.put(sid, new Sprint(sid, str(s.get("name")), sortedSet(s.get("git_projects")),
                sortedSet(s.get("components")), sortedSet(s.get("milestone_ids")),
                instant(s.get("created_date")), instant(s.get("done_date")), rel));
        }

        // ── задачи: текущий снимок + вся история ──
        Map<String, Map<String, Object>> cur = new HashMap<>();
        for (Map<String, Object> t : slice("all_tasks", true)) {
            String uid = str(t.get("task_uid"));
            if (uid != null) cur.putIfAbsent(uid, t);
        }
        Map<String, List<Version>> hist = new TreeMap<>();
        for (Map<String, Object> h : read("task_history", SQL_TASK_HIST, true)) {
            String uid = str(h.get("task_uid"));
            Instant vf = instant(h.get("valid_from"));
            if (uid == null || vf == null) continue;
            hist.computeIfAbsent(uid, k -> new ArrayList<>()).add(new Version(vf, str(h.get("status_raw"))));
        }
        List<TaskRecord> tasks = new ArrayList<>();
        Set<String> uids = new TreeSet<>(hist.keySet());
        uids.addAll(cur.keySet());
        for (String uid : uids) {
            Map<String, Object> c = cur.getOrDefault(uid, Map.of());
            String sid = str(c.get("sprint_id"));
            if (sid == null && uid.contains("/")) sid = uid.substring(0, uid.indexOf('/'));
            tasks.add(new TaskRecord(uid, sid, str(c.get("title")), str(c.get("component_id")),
                hist.getOrDefault(uid, List.of()), str(c.get("status_raw"))));
        }

        List<Event> events = new ArrayList<>();

        // ── спринты ──
        for (Sprint s : sprints.values()) {
            if (s.created() != null && !s.created().isBefore(from) && s.created().isBefore(t1))
                events.add(ev("sprint", s.id(), "created", s.created(), null, s.projects(), s.components(), s.id(), s.milestones(), null, null, s.name(), "sprints.created_date"));
            if (s.done() != null && !s.done().isBefore(from) && s.done().isBefore(t1))
                events.add(ev("sprint", s.id(), "closed", s.done(), null, s.projects(), s.components(), s.id(), s.milestones(), null, null, s.name(), "sprints.done_date"));
        }
        // ── релизы (только дата) ──
        for (Map<String, Object> r : read("releases", SQL_RELEASES, false)) {
            LocalDate d = day(r.get("release_date"));
            if (d == null || d.isBefore(fromDay) || d.isAfter(toDay)) continue;
            List<String> p = sortedSet(r.get("projects"));
            if (p.isEmpty()) p = sortedSet(r.get("git_project"));
            String id = Optional.ofNullable(str(r.get("release_uid"))).orElse(str(r.get("release_id")));
            events.add(ev("release", id, "released", null, d, p, List.of(), null, List.of(), null, null, str(r.get("release_id")), "releases"));
        }

        List<Knowledge> knowledge = new ArrayList<>();

        // ── ADR ──
        Map<String, Map<String, Object>> adrById = new HashMap<>();
        for (Map<String, Object> a : slice("adrs", false)) {
            String id = str(a.get("adr_id"));
            if (id == null) continue;
            adrById.put(id, a);
            LocalDate created = day(a.get("date_created"));
            List<String> p = sortedSet(a.get("git_projects"));
            knowledge.add(new Knowledge("adr", id, str(a.get("status")), created, null, null, p));
            if (created != null && !created.isBefore(fromDay) && !created.isAfter(toDay))
                events.add(ev("adr", id, "created", instantIfTimed(a.get("date_created")), created, p,
                    sortedSet(a.get("components")), null, List.of(), null, str(a.get("status")), str(a.get("name")), "adrs.date_created"));
        }
        List<Map<String, Object>> adrHist = read("adr_history", SQL_ADR_HIST, false);
        Map<String, Instant> adrFirst = firstBy(adrHist, "adr_id");
        for (Map<String, Object> h : adrHist) {
            String id = str(h.get("adr_id"));
            Instant vf = instant(h.get("valid_from"));
            if (id == null || vf == null || vf.equals(adrFirst.get(id)) || vf.isBefore(from) || !vf.isBefore(t1)) continue;
            Map<String, Object> a = adrById.getOrDefault(id, Map.of());
            List<String> p = sortedSet(h.get("projects"));
            if (p.isEmpty()) p = sortedSet(a.get("git_projects"));
            events.add(ev("adr", id, "changed", vf, null, p, sortedSet(a.get("components")), null, List.of(), null, null, str(a.get("name")), "adr_history"));
        }

        // ── решения ──
        Map<String, Map<String, Object>> decTl = new HashMap<>();
        for (Map<String, Object> d : slice("timeline_decisions", false)) {
            String id = str(d.get("decision_id"));
            if (id != null) decTl.put(id, d);
        }
        for (Map<String, Object> d : slice("decisions", false)) {
            String id = str(d.get("decision_id"));
            if (id == null) continue;
            Map<String, Object> tl = decTl.getOrDefault(id, Map.of());
            List<String> p = sortedSet(d.get("projects"));
            if (p.isEmpty()) p = sortedSet(tl.get("adr_projects"));
            List<String> c = sortedSet(d.get("components"));
            LocalDate created = day(d.get("date_created"));
            String parent = str(d.get("parent_adr"));
            knowledge.add(new Knowledge("decision", id, str(d.get("status_raw")), created, parent, null, p));
            if (created != null && !created.isBefore(fromDay) && !created.isAfter(toDay))
                events.add(ev("decision", id, "created", instantIfTimed(d.get("date_created")), created, p, c, null, List.of(), parent,
                    str(d.get("status_raw")), str(d.get("title")), "decisions.date_created"));
            Instant upd = instant(tl.get("updated_at"));
            if (upd != null && !upd.isBefore(from) && upd.isBefore(t1) && !Objects.equals(upd.atZone(zone).toLocalDate(), created))
                events.add(ev("decision", id, "changed", upd, null, p, c, null, List.of(), parent, null, str(d.get("title")), "timeline_decisions.updated_at"));
        }

        // ── спеки ──
        Map<String, Map<String, Object>> tspec = new HashMap<>();
        for (Map<String, Object> s : slice("timeline_specs", false)) {
            String id = str(s.get("spec_id"));
            if (id != null) tspec.put(id, s);
        }
        List<Map<String, Object>> specHist = read("spec_history", SQL_SPEC_HIST, false);
        Map<String, Instant> specFirst = firstBy(specHist, "spec_id");
        Map<String, Map<String, Object>> specById = new HashMap<>();
        Map<String, Instant> specCreated = new HashMap<>();
        for (Map<String, Object> s : slice("specs", false)) {
            String id = str(s.get("spec_id"));
            if (id == null) continue;
            specById.put(id, s);
            Instant created = instant(tspec.getOrDefault(id, Map.of()).get("date_created"));
            if (created == null) created = specFirst.get(id);
            if (created != null) specCreated.put(id, created);
            List<String> p = sortedSet(s.get("projects"));
            List<String> c = s.get("component_id") == null ? List.of() : List.of(str(s.get("component_id")));
            knowledge.add(new Knowledge("spec", id, str(s.get("status")), created == null ? null : created.atZone(zone).toLocalDate(),
                null, str(s.get("version")), p));
            if (created != null && !created.isBefore(from) && created.isBefore(t1))
                events.add(ev("spec", id, "created", created, null, p, c, null, List.of(), null, str(s.get("status")), str(s.get("title")), "timeline_specs"));
        }
        for (Map<String, Object> h : specHist) {
            String id = str(h.get("spec_id"));
            Instant vf = instant(h.get("valid_from"));
            if (id == null || vf == null || vf.equals(specCreated.getOrDefault(id, specFirst.get(id))) || vf.isBefore(from) || !vf.isBefore(t1)) continue;
            Map<String, Object> s = specById.getOrDefault(id, Map.of());
            List<String> p = sortedSet(h.get("projects"));
            if (p.isEmpty()) p = sortedSet(s.get("projects"));
            List<String> c = s.get("component_id") == null ? List.of() : List.of(str(s.get("component_id")));
            events.add(ev("spec", id, "version", vf, null, p, c, null, List.of(), null, null, str(s.get("title")), "spec_history"));
        }
        // TODO(S7A-01, новые типы §1): вехи, вопросы, компоненты — у вех нет даты
        // создания в срезе milestones; добавить, когда появится источник даты.

        return new NewsV2.Input(t0, t1, now, zone, tasks, sprints, events, knowledge, List.copyOf(errors), scope);
    }

    static Event ev(String type, String el, String kind, Instant at, LocalDate day, List<String> p, List<String> c,
                    String sprint, List<String> ms, String parent, String to, String title, String src) {
        return new Event(type, el, kind, at, at == null ? day : null, null, null, p, c, sprint, ms, parent, null, to, title, src);
    }

    static Map<String, Instant> firstBy(List<Map<String, Object>> rows, String idField) {
        Map<String, Instant> first = new HashMap<>();
        for (Map<String, Object> h : rows) {
            String id = str(h.get(idField));
            Instant vf = instant(h.get("valid_from"));
            if (id == null || vf == null) continue;
            first.merge(id, vf, (a, b) -> a.isBefore(b) ? a : b);
        }
        return first;
    }

    // ── нормализация значений ──

    private static final Pattern DAY = Pattern.compile("^(\\d{4}-\\d{2}-\\d{2})");
    private static final Pattern TIMED = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}");

    static String str(Object v) {
        if (v == null) return null;
        if (v instanceof List<?> l) return l.isEmpty() || l.get(0) == null ? null : String.valueOf(l.get(0));
        String s = String.valueOf(v);
        return s.isBlank() ? null : s;
    }

    static List<Object> list(Object v) {
        if (v == null) return List.of();
        if (v instanceof List<?> l) return new ArrayList<>(l);
        return List.of(v);
    }

    static List<String> strList(Object v) {
        List<String> out = new ArrayList<>();
        for (Object o : list(v)) if (o != null && !String.valueOf(o).isBlank()) out.add(String.valueOf(o));
        return out;
    }

    static List<String> sortedSet(Object v) { return List.copyOf(new TreeSet<>(strList(v))); }

    static LocalDate day(Object v) {
        String s = str(v);
        if (s == null) return null;
        Matcher m = DAY.matcher(s.trim());
        return m.find() ? LocalDate.parse(m.group(1)) : null;
    }

    /**
     * Момент UTC из строки; «только дата» → null. Строки уже прошли
     * {@link LoreTimeFormat#isoUtcRows} (ISO-Z); форма с пробелом — запасной путь.
     */
    static Instant instant(Object v) {
        String s = str(v);
        if (s == null || !TIMED.matcher(s.trim()).find()) return null;
        String x = s.trim().replace(' ', 'T');
        if (!x.endsWith("Z") && !x.matches(".*[+-]\\d{2}:\\d{2}$")) x = x + "Z";
        try { return Instant.parse(x); }
        catch (DateTimeParseException e) {
            try { return java.time.OffsetDateTime.parse(x).toInstant(); } catch (DateTimeParseException e2) { return null; }
        }
    }

    static Instant instantIfTimed(Object v) { return instant(v); }
}
