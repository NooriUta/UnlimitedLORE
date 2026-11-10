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
    // B9: task_uids — ВСЕ владельцы версии. task_uid ([0]) — лишь первый, а порядок
    // рёбер — порядок хранилища, не приоритет: общая версия (S2-11) иначе приписалась
    // бы одному владельцу, второй потерял бы переход в таймлайне.
    static final String SQL_TASK_HIST =
        "SELECT in('HAS_STATE').task_uid[0] AS task_uid, in('HAS_STATE').task_uid AS task_uids, " +
        "valid_from, status_raw " +
        "FROM KnowTaskHist WHERE valid_from IS NOT NULL";
    /**
     * S7A-09: текущий снимок задач — лёгкая проекция. Срез all_tasks везёт note_md
     * (сотни раз тяжелее остального) и роли; ленте нужны только эти пять полей.
     * Выражения — те же, что у all_tasks (статус — с открытой строки истории, MT-12).
     */
    static final String SQL_TASKS =
        "SELECT task_uid, title, out('BELONGS_TO').component_id[0] AS component_id, " +
        "out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0] AS status_raw, " +
        "out('PART_OF').sprint_id[0] AS sprint_id FROM KnowTask";
    /** S7A-09: спринты — без context_md, приоритета, PR и плана; выражения — те же, что у среза sprints. */
    static final String SQL_SPRINTS =
        "SELECT sprint_id, name, created_date, " +
        "out('IMPLEMENTED_IN_RELEASE').release_id   AS release_ids, " +
        "out('IMPLEMENTED_IN_RELEASE').release_date AS release_dates, " +
        LoreSlices.DONE_DATE_SQL + " AS done_date, " +
        "out('BELONGS_TO_PROJECT').slug AS git_projects, " +
        "out('BELONGS_TO')[component_id IS NOT NULL].component_id AS components, " +
        "out('TARGETS_MILESTONE').milestone_id AS milestone_ids FROM KnowSprint";
    static final String SQL_RELEASES =
        "SELECT release_id, release_uid, release_date, git_project, out('BELONGS_TO_PROJECT').slug AS projects " +
        "FROM KnowRelease WHERE release_date IS NOT NULL";
    static final String SQL_ADR_HIST =
        "SELECT in('HAS_STATE').adr_id[0] AS adr_id, in('HAS_STATE').adr_id AS adr_uids, valid_from, " +
        "in('HAS_STATE').out('BELONGS_TO_PROJECT').slug AS projects " +
        "FROM KnowADRHist WHERE valid_from IS NOT NULL";
    static final String SQL_SPEC_HIST =
        "SELECT in('HAS_STATE').spec_id[0] AS spec_id, in('HAS_STATE').spec_id AS spec_uids, valid_from, " +
        "in('HAS_STATE').out('BELONGS_TO_PROJECT').slug AS projects " +
        "FROM KnowSpecHist WHERE valid_from IS NOT NULL";
    /** S7A-01: вопросы для ленты — лёгкая проекция без body_md (условие 9 SPEC-LORE-KIT-CONTRACT-CONDITIONS). */
    static final String SQL_QUESTIONS =
        "SELECT question_id, title, status, opened_date, closed_date, " +
        "out('BELONGS_TO').component_id AS components, out('BELONGS_TO_PROJECT').slug AS projects, " +
        "out('RAISED_IN').sprint_id[0] AS raised_sprint FROM KnowQuestion";

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

    /** Момент чтения текущего сбора ({@code now} из {@link #collect}) — к нему относится провал источника. */
    private Instant readAt;

    private void fail(String source, Exception e, boolean critical) {
        errors.add(new SourceError(source, String.valueOf(e.getMessage()), critical, forbidden(e), readAt));
    }

    /**
     * K2-FEED-VIEW §6: отказ ПО ПРАВАМ — по всей цепочке причин: наш
     * {@link LoreExceptions.Forbidden}, {@link SecurityException} или ответ 403.
     * 401 сюда не идёт: «кред не принят» — это «не смогли», а не «не дали».
     */
    static boolean forbidden(Throwable e) {
        Set<Throwable> seen = Collections.newSetFromMap(new IdentityHashMap<>());
        for (Throwable t = e; t != null && seen.add(t); t = t.getCause()) {
            if (t instanceof LoreExceptions.Forbidden || t instanceof SecurityException) return true;
            if (t instanceof LoreExceptions.LoreException le && le.status == 403) return true;
            if (t instanceof jakarta.ws.rs.WebApplicationException w && w.getResponse() != null
                && w.getResponse().getStatus() == 403) return true;
        }
        return false;
    }

    private List<Map<String, Object>> read(String source, String sql, boolean critical) {
        try {
            List<Map<String, Object>> rows = query.apply(sql, Map.of());
            return rows == null ? List.of() : rows;
        } catch (Exception e) {
            fail(source, e, critical);
            return List.of();
        }
    }

    private List<Map<String, Object>> slice(String sliceId, boolean critical) {
        LoreSlices.Composed c;
        try { c = LoreSlices.compose(sliceId, Map.of()); }
        catch (Exception e) { fail(sliceId, e, critical); return List.of(); }
        try {
            List<Map<String, Object>> rows = query.apply(c.sql(), c.params());
            return rows == null ? List.of() : rows;
        } catch (Exception e) {
            fail(sliceId, e, critical);
            return List.of();
        }
    }

    /**
     * S7A-09: начало окна чтения — начало ПРЕДЫДУЩЕГО периода (§7.5): период длиной
     * больше суток сдвигается на свою длину, сутки и короче — на неделю. Одно место
     * для сборщика, истории статуса и индекса авторов — тот же сдвиг, что у
     * {@code NewsV2Engine.previousInput()}.
     */
    static Instant windowStart(Instant t0, Instant t1) {
        java.time.Duration len = java.time.Duration.between(t0, t1);
        java.time.Duration shift = len.compareTo(java.time.Duration.ofDays(1)) <= 0 ? java.time.Duration.ofDays(7) : len;
        return t0.minus(shift);
    }

    NewsV2.Input collect(Instant t0, Instant t1, Instant now, ZoneId zone, Set<String> scope) {
        readAt = now;
        Instant from = windowStart(t0, t1);
        LocalDate fromDay = from.atZone(zone).toLocalDate();
        LocalDate toDay = t1.minusMillis(1).atZone(zone).toLocalDate();

        // ── справочники ──
        Map<String, Sprint> sprints = new TreeMap<>();
        for (Map<String, Object> s : read("sprints", SQL_SPRINTS, true)) {
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
        for (Map<String, Object> t : read("all_tasks", SQL_TASKS, true)) {
            String uid = str(t.get("task_uid"));
            if (uid != null) cur.putIfAbsent(uid, t);
        }
        Map<String, List<Version>> hist = new TreeMap<>();
        for (Map<String, Object> h : read("task_history", SQL_TASK_HIST, true)) {
            Instant vf = instant(h.get("valid_from"));
            if (vf == null) continue;
            // B9: переход — каждому владельцу версии, не только первому ([0]).
            for (String uid : owners(h, "task_uids", "task_uid")) {
                hist.computeIfAbsent(uid, k -> new ArrayList<>()).add(new Version(vf, str(h.get("status_raw"))));
            }
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
        Map<String, Instant> adrFirst = firstByOwners(adrHist, "adr_uids", "adr_id");
        for (Map<String, Object> h : adrHist) {
            Instant vf = instant(h.get("valid_from"));
            if (vf == null || vf.isBefore(from) || !vf.isBefore(t1)) continue;
            List<String> rowProjects = sortedSet(h.get("projects"));
            // B9: событие «изменено» — каждому владельцу версии. «Первая версия» своя
            // у каждого: для владельца, у которого общая версия единственная, это
            // начальное состояние, не правка — события нет.
            for (String id : owners(h, "adr_uids", "adr_id")) {
                if (vf.equals(adrFirst.get(id))) continue;
                Map<String, Object> a = adrById.getOrDefault(id, Map.of());
                List<String> p = rowProjects.isEmpty() ? sortedSet(a.get("git_projects")) : rowProjects;
                events.add(ev("adr", id, "changed", vf, null, p, sortedSet(a.get("components")), null, List.of(), null, null, str(a.get("name")), "adr_history"));
            }
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
        Map<String, Instant> specFirst = firstByOwners(specHist, "spec_uids", "spec_id");
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
            Instant vf = instant(h.get("valid_from"));
            if (vf == null || vf.isBefore(from) || !vf.isBefore(t1)) continue;
            List<String> rowProjects = sortedSet(h.get("projects"));
            // B9: событие «версия» — каждому владельцу, «первая версия» своя у каждого
            // (см. adr-цикл выше).
            for (String id : owners(h, "spec_uids", "spec_id")) {
                if (vf.equals(specCreated.getOrDefault(id, specFirst.get(id)))) continue;
                Map<String, Object> s = specById.getOrDefault(id, Map.of());
                List<String> p = rowProjects.isEmpty() ? sortedSet(s.get("projects")) : rowProjects;
                List<String> c = s.get("component_id") == null ? List.of() : List.of(str(s.get("component_id")));
                events.add(ev("spec", id, "version", vf, null, p, c, null, List.of(), null, null, str(s.get("title")), "spec_history"));
            }
        }
        // ── вопросы (S7A-01, новые типы §1): «открыт» и «закрыт»; дата без времени — днём ──
        for (Map<String, Object> q : read("questions", SQL_QUESTIONS, false)) {
            String id = str(q.get("question_id"));
            if (id == null) continue;
            List<String> p = sortedSet(q.get("projects"));
            List<String> c = sortedSet(q.get("components"));
            String sprint = str(q.get("raised_sprint"));
            for (String[] k : new String[][]{{"opened_date", "created"}, {"closed_date", "closed"}}) {
                Instant at = instant(q.get(k[0]));
                LocalDate d = at == null ? day(q.get(k[0])) : null;
                boolean in = at != null ? !at.isBefore(from) && at.isBefore(t1)
                    : d != null && !d.isBefore(fromDay) && !d.isAfter(toDay);
                if (in) events.add(ev("question", id, k[1], at, d, p, c, sprint, List.of(), null,
                    str(q.get("status")), str(q.get("title")), "questions." + k[0]));
            }
        }
        // TODO(S7A-01, новые типы §1): вехи и компоненты — у них нет даты создания
        // ни в одном источнике; добавить, когда появится источник даты.

        return new NewsV2.Input(t0, t1, now, zone, tasks, sprints, events, knowledge, List.copyOf(errors), scope);
    }

    static Event ev(String type, String el, String kind, Instant at, LocalDate day, List<String> p, List<String> c,
                    String sprint, List<String> ms, String parent, String to, String title, String src) {
        return new Event(type, el, kind, at, at == null ? day : null, null, null, p, c, sprint, ms, parent, null, to, title, src);
    }

    /**
     * B9: владельцы строки истории — списком: версия, общая у нескольких записей
     * (S2-11), относится к каждой. Подставные строки без колонки-списка несут
     * скалярный id — он и читается (обратная совместимость тестовых фикстур).
     */
    static List<String> owners(Map<String, Object> row, String ownersField, String idField) {
        return strList(row.containsKey(ownersField) ? row.get(ownersField) : row.get(idField));
    }

    /** Минимальный valid_from на каждого владельца — «первая версия» своя у каждого. */
    static Map<String, Instant> firstByOwners(List<Map<String, Object>> rows, String ownersField, String idField) {
        Map<String, Instant> first = new HashMap<>();
        for (Map<String, Object> h : rows) {
            Instant vf = instant(h.get("valid_from"));
            if (vf == null) continue;
            for (String id : owners(h, ownersField, idField)) {
                first.merge(id, vf, (a, b) -> a.isBefore(b) ? a : b);
            }
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
