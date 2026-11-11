package studio.seer.heimdall.lore;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-MCP-CHANGED-RANGE (остаток, v1.17.14) — {@code GET /lore/changed}:
 * «что изменилось с … по …» одной выдачей по многим типам.
 *
 * <p><b>Повод.</b> Владелица 11.11.2026: после ревью «закрыли 27, 42 на доработку» агенту нечем
 * было посмотреть правки за период по всем объектам сразу — только срез за срезом, а
 * {@code closed_tasks} целиком по объёму уже не читается.
 *
 * <p><b>Источник — существующие списочные срезы, а не новый SQL.</b> У каждого типа уже есть срез
 * с {@code changed_at} (S4-04, {@link LoreChangedAt}) и проектным скоупом
 * ({@link LoreSlices#PROJECT_SCOPED}); третья правда о «когда менялось» не заводится. Статус
 * «было» — версия SCD2, открытая к началу периода; «кто» — автор последней версии внутри
 * периода ({@code changed_by}, S2-12). Правка «на месте» (заметка, тело без версии) версии не
 * открывает — тогда автор неизвестен ({@code null}), а не выдуман.
 *
 * <p><b>Честность.</b> Тип, который не прочитался, — в {@code errors[]}, ответ {@code complete:false}
 * и {@code nothing_changed:false}: «0 строк» при сбое не читается как «ничего не изменилось».
 * Фильтр по проекту к типу без проектной оси — тоже в {@code errors[]}, а не «все записи».
 *
 * <p>Чистые функции без базы; ввод-вывод — {@link LoreChangedResource}.
 */
final class LoreChanged {

    private LoreChanged() {}

    /**
     * Откуда берётся тип: срезы списка, поля строки, цепочка истории ({@code null} — её нет по
     * модели), параметр проекта среза ({@code null} — фильтр по колонкам {@code projectCols}).
     * {@code statusType} — тип для {@link LoreStatusCategory}.
     */
    record Source(String type, List<String> slices, String idField, String titleField, String statusField,
                  String statusType, String histType, String projectParam, List<String> projectCols) {}

    static final Map<String, Source> SOURCES;
    static {
        Map<String, Source> m = new LinkedHashMap<>();
        put(m, new Source("task", List.of("open_tasks", "closed_tasks"), "task_uid", "title", "status_raw",
            "task", "KnowTaskHist", "project", List.of()));
        put(m, new Source("adr", List.of("adrs"), "adr_id", "name", "status",
            "adr", "KnowADRHist", null, List.of("git_projects")));
        put(m, new Source("decision", List.of("decisions"), "decision_id", "title", "status_raw",
            "decision", "KnowDecisionHist", null, List.of("projects")));
        put(m, new Source("spec", List.of("specs"), "spec_id", "title", "status",
            "spec", "KnowSpecHist", "project", List.of()));
        put(m, new Source("question", List.of("questions"), "question_id", "title", "status",
            "question", null, null, List.of("projects")));
        put(m, new Source("release", List.of("releases"), "release_id", "version", null,
            null, "KnowReleaseHist", null, List.of("projects")));
        put(m, new Source("sprint", List.of("sprints"), "sprint_id", "name", "status_raw",
            "sprint", "KnowSprintHist", "project", List.of()));
        put(m, new Source("milestone", List.of("milestones"), "milestone_id", "label", null,
            null, "KnowMilestoneHist", null, List.of()));
        put(m, new Source("component", List.of("components"), "component_id", "full_name", null,
            null, null, null, List.of("git_projects")));
        put(m, new Source("feature", List.of("features"), "uc_id", "title", "status",
            "feature", null, null, List.of("projects")));
        SOURCES = java.util.Collections.unmodifiableMap(m);
    }

    private static void put(Map<String, Source> m, Source s) { m.put(s.type(), s); }

    /** Категории статуса вне PLAN/DOC-типов {@link LoreStatusCategory} — вопрос и фича. */
    private static final Map<String, String> QUESTION_CATEGORY = Map.of(
        "open", "in_progress", "deferred", "not_started", "closed", "finished", "dropped", "withdrawn");
    private static final Map<String, String> FEATURE_CATEGORY = Map.of(
        "proposed", "not_started", "planned", "not_started", "draft", "not_started",
        "in_progress", "in_progress", "active", "in_progress",
        "shipped", "finished", "done", "finished", "dropped", "withdrawn", "cancelled", "withdrawn");

    static final Set<String> PARAMS =
        Set.of("types", "from", "to", "project", "status_category", "actor", "limit", "offset");

    static final int DEFAULT_LIMIT = 200;
    static final int MAX_LIMIT = 1000;

    /** Разобранный запрос. {@code range} — период {@link SlicePage.Range} (UTC, включительно). */
    record Query(List<String> types, SlicePage.Range range, String statusCategory, String actor,
                 String project, int limit, int offset) {}

    private static final DateTimeFormatter ISO_MS =
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

    static Query parse(Map<String, String> params) {
        Map<String, String> p = params == null ? Map.of() : params;
        for (String k : p.keySet())
            if (!PARAMS.contains(k)) throw new IllegalArgumentException("unknown param: " + k + " (known: " + new java.util.TreeSet<>(PARAMS) + ")");
        String from = blankToNull(p.get("from"));
        String to = blankToNull(p.get("to"));
        if (from == null && to == null)
            throw new IllegalArgumentException("from or to required — без периода это «всё», а не «изменённое»");
        // Тот же разбор границ, что у общих параметров срезов (SlicePage): одна правда о периоде.
        Map<String, String> r = new LinkedHashMap<>();
        if (from != null) r.put("changed_from", from);
        if (to != null) r.put("changed_to", to);
        SlicePage.Range range = SlicePage.extract(r).range();

        List<String> types = new ArrayList<>();
        String csv = blankToNull(p.get("types"));
        if (csv == null) types.addAll(SOURCES.keySet());
        else {
            for (String part : csv.split(",")) {
                String t = part.trim().toLowerCase(Locale.ROOT);
                if (t.isEmpty() || types.contains(t)) continue;
                if (!SOURCES.containsKey(t))
                    throw new IllegalArgumentException("unknown type: " + t + " (known: " + String.join(",", SOURCES.keySet()) + ")");
                types.add(t);
            }
            if (types.isEmpty()) throw new IllegalArgumentException("empty list for param: types");
        }

        String cat = blankToNull(p.get("status_category"));
        if (cat != null) {
            cat = cat.toLowerCase(Locale.ROOT);
            if (!cat.equals("open") && !cat.equals("closed") && !LoreStatusCategory.CATEGORIES.contains(cat))
                throw new IllegalArgumentException("bad value for param: status_category (" + cat + ") — open | closed | "
                    + String.join(" | ", LoreStatusCategory.CATEGORIES));
        }
        String project = blankToNull(p.get("project"));
        if (project != null && !LoreSlices.VALUE_RE.matcher(project).matches())
            throw new IllegalArgumentException("bad value for param: project");
        int limit = p.get("limit") == null ? DEFAULT_LIMIT : intParam("limit", p.get("limit"));
        if (limit < 1 || limit > MAX_LIMIT) throw new IllegalArgumentException("limit must be 1.." + MAX_LIMIT + " (got " + limit + ")");
        int offset = p.get("offset") == null ? 0 : intParam("offset", p.get("offset"));
        if (offset < 0) throw new IllegalArgumentException("offset must be >= 0 (got " + offset + ")");
        return new Query(List.copyOf(types), range, cat, blankToNull(p.get("actor")), project, limit, offset);
    }

    /** У задач открытые и закрытые — разные срезы; лишний не читается. */
    static List<String> slicesFor(Source s, String statusCategory) {
        if ("task".equals(s.type()) && statusCategory != null) {
            boolean closed = statusCategory.equals("closed") || LoreStatusCategory.isClosed(statusCategory);
            return List.of(closed ? "closed_tasks" : "open_tasks");
        }
        return s.slices();
    }

    /** Параметры среза: проект — тем параметром, что срез принимает сам. */
    static Map<String, String> sliceParams(Source s, String project) {
        Map<String, String> m = new LinkedHashMap<>();
        if (project != null && s.projectParam() != null) m.put(s.projectParam(), project);
        return m;
    }

    /** Причина, по которой фильтр по проекту к типу неприменим; {@code null} — применим. */
    static String projectUnsupported(Source s, String project) {
        if (project == null || s.projectParam() != null || !s.projectCols().isEmpty()) return null;
        return "у типа " + s.type() + " нет проектной оси — фильтр project=" + project
            + " к нему неприменим; тип не прочитан, а не «изменений нет»";
    }

    /** id строк типа, изменённых в периоде (и прошедших фильтр проекта) — для запроса истории. */
    static List<String> changedIds(Source s, List<Map<String, Object>> rows, Query q) {
        List<String> ids = new ArrayList<>();
        for (Map<String, Object> r : candidates(s, rows, q)) {
            Object id = r.get(s.idField());
            if (id != null && !ids.contains(id.toString())) ids.add(id.toString());
        }
        return ids;
    }

    private static List<Map<String, Object>> candidates(Source s, List<Map<String, Object>> rows, Query q) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (rows == null) return out;
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (Map<String, Object> r : LoreChangedAt.fold(rows)) {
            if (r == null) continue;
            if (!q.range().contains(LoreChangedAt.instant(r.get("changed_at")))) continue;
            if (q.project() != null && s.projectParam() == null && !projects(s, r).contains(q.project())) continue;
            Object id = r.get(s.idField());
            if (id != null && !seen.add(id.toString())) continue;   // срезы задач не пересекаются, но дубль не размножим
            out.add(r);
        }
        return out;
    }

    private static List<String> projects(Source s, Map<String, Object> r) {
        List<String> out = new ArrayList<>();
        for (String col : s.projectCols()) {
            Object v = r.get(col);
            if (v instanceof Collection<?> c) { for (Object o : c) if (o != null && !out.contains(o.toString())) out.add(o.toString()); }
            else if (v != null && !out.contains(v.toString())) out.add(v.toString());
        }
        return out;
    }

    static String category(Source s, Object status) {
        if (status == null || s.statusType() == null) return LoreStatusCategory.UNKNOWN;
        String token = String.valueOf(status).strip().toLowerCase(Locale.ROOT);
        return switch (s.statusType()) {
            case "question" -> QUESTION_CATEGORY.getOrDefault(token, LoreStatusCategory.UNKNOWN);
            case "feature" -> FEATURE_CATEGORY.getOrDefault(token, LoreStatusCategory.UNKNOWN);
            default -> LoreStatusCategory.of(s.statusType(), status);
        };
    }

    private record Version(Instant at, Object status, Object by, Object kind) {}

    /**
     * Строки выдачи типа. {@code hist == null} у типа с цепочкой — история не прочиталась
     * ({@code history:"unavailable"}, «было» неизвестно); у типа без цепочки — {@code not_tracked}.
     */
    static List<Map<String, Object>> items(Source s, List<Map<String, Object>> rows, List<Map<String, Object>> hist, Query q) {
        Map<String, List<Version>> versions = new LinkedHashMap<>();
        if (hist != null) {
            for (Map<String, Object> h : hist) {
                Object id = h.get("ref_id");
                Instant at = LoreChangedAt.instant(h.get("valid_from"));
                if (id == null || at == null) continue;
                versions.computeIfAbsent(id.toString(), k -> new ArrayList<>())
                    .add(new Version(at, h.get("status_v"), h.get("changed_by"), h.get("changed_by_kind")));
            }
            versions.values().forEach(l -> l.sort(Comparator.comparing(Version::at)));
        }
        Instant from = q.range().from();
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : candidates(s, rows, q)) {
            Object id = r.get(s.idField());
            Object now = s.statusField() == null ? null : r.get(s.statusField());
            String cat = category(s, now);
            if (q.statusCategory() != null) {
                boolean ok = switch (q.statusCategory()) {
                    case "open" -> !LoreStatusCategory.isClosed(cat);
                    case "closed" -> LoreStatusCategory.isClosed(cat);
                    default -> q.statusCategory().equals(cat);
                };
                if (!ok) continue;
            }
            Map<String, Object> it = new LinkedHashMap<>();
            it.put("type", s.type());
            it.put("ref_id", id);
            Object title = r.get(s.titleField());
            it.put("title", title != null ? title : id);
            it.put("status_now", now);
            it.put("status_category", cat);
            Instant changed = LoreChangedAt.instant(r.get("changed_at"));
            it.put("changed_at", changed == null ? null : ISO_MS.format(changed));

            Object was = null;
            Boolean statusChanged = null;
            Boolean created = null;
            Object by = null;
            Object kind = null;
            String history;
            if (s.histType() == null) history = "not_tracked";
            else if (hist == null) history = "unavailable";
            else {
                List<Version> vs = versions.getOrDefault(id == null ? "" : id.toString(), List.of());
                history = vs.isEmpty() ? "none" : "versions";
                Version before = null;
                Version lastIn = null;
                for (Version v : vs) {
                    if (from != null && v.at().isBefore(from)) before = v;
                    if (q.range().contains(v.at())) lastIn = v;
                }
                if (before != null) was = before.status();
                if (from != null && !vs.isEmpty()) created = before == null && !vs.get(0).at().isBefore(from);
                if (s.statusField() != null && from != null && !vs.isEmpty())
                    statusChanged = before != null && !java.util.Objects.equals(str(was), str(now));
                if (lastIn != null) { by = lastIn.by(); kind = lastIn.kind(); }
            }
            it.put("status_was", was);
            it.put("status_changed", statusChanged);
            it.put("created_in_period", created);
            it.put("changed_by", by);
            it.put("changed_by_kind", kind);
            it.put("history", history);
            List<String> pr = projects(s, r);
            if (!pr.isEmpty()) it.put("projects", pr);
            if (q.actor() != null && (by == null || !q.actor().equalsIgnoreCase(by.toString()))) continue;
            out.add(it);
        }
        return out;
    }

    /** Версии изменённых записей одной цепочки (без окна: «было» — версия ДО периода). */
    static String histSql(Source s) {
        if (s.histType() == null) return null;
        return "SELECT in('HAS_STATE')." + s.idField() + "[0] AS ref_id, valid_from, "
            + "COALESCE(status_raw, status) AS status_v, changed_by, changed_by_kind FROM " + s.histType()
            + " WHERE in('HAS_STATE')." + s.idField() + "[0] IN :ids AND valid_from IS NOT NULL";
    }

    /** Сводка: порядок по времени (свежее сверху), страница, ошибки, честное «ничего». */
    static Map<String, Object> assemble(Query q, List<Map<String, Object>> items, List<Map<String, Object>> errors) {
        List<Map<String, Object>> all = new ArrayList<>(items);
        all.sort(Comparator.comparing((Map<String, Object> m) -> LoreChangedAt.instant(m.get("changed_at")),
            Comparator.nullsLast(Comparator.<Instant>reverseOrder())));
        int total = all.size();
        int from = Math.min(q.offset(), total);
        int to = (int) Math.min((long) from + q.limit(), total);
        boolean complete = errors == null || errors.isEmpty();

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("from", q.range().fromRaw());
        body.put("to", q.range().toRaw());
        body.put("time_zone", "UTC");
        body.put("types", q.types());
        if (q.project() != null) body.put("project", q.project());
        if (q.statusCategory() != null) body.put("status_category", q.statusCategory());
        if (q.actor() != null) body.put("actor", q.actor());
        body.put("rows", new ArrayList<>(all.subList(from, to)));
        Map<String, Object> page = new LinkedHashMap<>();
        page.put("limit", q.limit());
        page.put("offset", q.offset());
        page.put("total", total);
        page.put("has_more", to < total);
        body.put("page", page);
        body.put("errors", errors == null ? List.of() : errors);
        body.put("complete", complete);
        body.put("nothing_changed", complete && total == 0);
        if (!complete) {
            List<String> failed = new ArrayList<>();
            for (Map<String, Object> e : errors) failed.add(String.valueOf(e.get("type")));
            body.put("warning", "not all types were read (" + String.join(",", failed) + ") — the absence of changes "
                + "for them is NOT established; rows cover only the types that answered");
        }
        if (q.actor() != null)
            body.put("actor_note", "actor matches the author of the last version inside the period; in-place edits "
                + "(no version) have no recorded author and are excluded by the actor filter");
        return body;
    }

    private static String str(Object o) { return o == null ? null : o.toString().strip(); }

    private static String blankToNull(String s) { return s == null || s.isBlank() ? null : s.trim(); }

    private static int intParam(String name, String v) {
        try { return Integer.parseInt(v.trim()); }
        catch (NumberFormatException e) { throw new IllegalArgumentException("bad value for param: " + name + " (integer expected)"); }
    }
}
