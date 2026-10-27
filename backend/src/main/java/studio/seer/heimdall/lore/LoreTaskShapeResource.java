package studio.seer.heimdall.lore;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * {@code GET /lore/task-shape} — форма и объём задач для статистики и BI
 * (SPRINT_LORE_MEASURE_TRUTH/MT-TASK-SHAPE, потребитель — Völva).
 *
 * <p>Строка на задачу: проект, статус, тип, оценка, класс сложности по факторам
 * ({@link TaskShape}), признаки скелета, коды рекомендаций и <b>факт</b> —
 * календарный цикл «заведена → done» по строкам истории. Сверка оценки с
 * фактом и есть калибровка: коэффициенты считаются по истории, а не задаются.
 *
 * <p>Текст заметки наружу НЕ отдаётся — только выведенные признаки и длина.
 * BI нужна форма, а не содержание; и так ответ остаётся безопасным по объёму.
 *
 * <p>Сводка {@code summary} — по проектам. Строки — по {@code rows=true}
 * (по умолчанию); {@code rows=false} отдаёт одну сводку.
 *
 * <p><b>Цикл честно помечен.</b> Почти половина закрытых задач заведена уже
 * сделанной (цикл меньше часа — запись задним числом). Такие строки идут в
 * {@code created_done} и НЕ входят в медианы цикла: иначе медиана мерила бы
 * привычку записывать, а не работу.
 */
@Path("/lore")
public class LoreTaskShapeResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreTaskShapeResource.class);

    /** Цикл короче часа — задача заведена уже сделанной. */
    static final double RETRO_CYCLE_DAYS = 1.0 / 24;

    static final String SQL =
        "SELECT task_uid, title, task_type, work_class, "
        + "out('PART_OF').sprint_id[0]                              AS sprint_id, "
        + "out('PART_OF').out('BELONGS_TO_PROJECT').slug            AS projects, "
        + "out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0]   AS status_raw, "
        + "out('HAS_STATE')[effort_days IS NOT NULL].effort_days[0] AS effort_days, "
        + "out('HAS_STATE')[note_md IS NOT NULL].note_md[0]         AS note_md, "
        + "out('HAS_STATE')[valid_to IS NULL].valid_from[0]         AS state_since, "
        // Все даты строк истории: минимум = «заведена». min() по строке-дате в
        // ArcadeDB падает (ClassCastException) — свёртка в Java.
        + "out('HAS_STATE').valid_from                              AS state_dates "
        + "FROM KnowTask";

    @GET
    @Path("task-shape")
    @Produces(MediaType.APPLICATION_JSON)
    public Response taskShape(@QueryParam("project") String project,
                              @QueryParam("rows") String rowsParam,
                              @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        // Строки несут заголовки задач всех проектов мимо проектного скоупа
        // срезов — поэтому admin, как у прочих сквозных выгрузок.
        requireAdmin(role);
        boolean withRows = rowsParam == null || !"false".equalsIgnoreCase(rowsParam);
        try {
            List<Map<String, Object>> raw = ingestService.queryPublic(SQL, Map.of());
            List<Map<String, Object>> rows = new ArrayList<>();
            for (Map<String, Object> r : raw) {
                Map<String, Object> row = toRow(r);
                if (project != null && !project.isBlank() && !project.equals(row.get("project"))) continue;
                rows.add(row);
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("generated_at", java.time.Instant.now().toString());
            if (project != null && !project.isBlank()) out.put("project", project);
            out.put("thresholds", Map.of(
                "epic_note_chars", TaskShape.EPIC_NOTE_CHARS, "epic_max_effort", TaskShape.EPIC_MAX_EFFORT,
                "merge_max_effort", TaskShape.MERGE_MAX_EFFORT, "stale_partial_days", TaskShape.STALE_PARTIAL_DAYS,
                "retro_cycle_days", RETRO_CYCLE_DAYS));
            out.put("total", rows.size());
            out.put("summary", summarize(rows));
            if (withRows) out.put("rows", rows);
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE TASK-SHAPE] %s", e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    /** Строка BI из сырых фактов графа. Пакетный уровень — для теста без базы. */
    static Map<String, Object> toRow(Map<String, Object> r) {
        String status = nul(first(r.get("status_raw")));
        Object eff = first(r.get("effort_days"));
        Double effort = eff instanceof Number n ? n.doubleValue() : null;
        String since = nul(first(r.get("state_since")));
        TaskShape.Shape s = TaskShape.analyze(nul(r.get("title")), nul(first(r.get("note_md"))),
            nul(r.get("task_type")), effort, status, LoreQualityFacts.Kind.daysSince(since));

        Map<String, Object> row = new LinkedHashMap<>();
        row.put("task_uid", r.get("task_uid"));
        row.put("sprint_id", first(r.get("sprint_id")));
        row.put("project", firstFlat(r.get("projects")));
        row.put("status", statusGroup(status));
        row.put("task_type", r.get("task_type"));
        row.put("work_class", r.get("work_class"));
        row.put("effort_days", effort);
        row.put("note_chars", s.length());
        row.put("steps", s.steps());
        row.put("has_why", s.why());
        row.put("has_verify", s.verify());
        row.put("has_test", s.test());
        row.put("complexity", s.complexity());
        row.put("points", s.points());
        row.put("estimate_fits", s.estimateFits());
        row.put("recommendations", s.recommendations().stream().map(TaskShape.Recommendation::code).toList());
        row.put("days_in_status", LoreQualityFacts.Kind.daysSince(since));
        if ("done".equals(row.get("status"))) {
            LocalDateTime created = minDate(r.get("state_dates"));
            LocalDateTime done = parse(since);
            if (created != null && done != null) {
                double days = java.time.Duration.between(created, done).toMinutes() / 1440.0;
                row.put("cycle_days", Math.round(days * 100) / 100.0);
                row.put("created_done", days < RETRO_CYCLE_DAYS);
            }
        }
        return row;
    }

    /** Сводка по проектам + итог «все». */
    static Map<String, Object> summarize(List<Map<String, Object>> rows) {
        Map<String, List<Map<String, Object>>> byProject = new TreeMap<>();
        for (Map<String, Object> r : rows) {
            String p = r.get("project") == null ? "(без проекта)" : String.valueOf(r.get("project"));
            byProject.computeIfAbsent(p, k -> new ArrayList<>()).add(r);
            byProject.computeIfAbsent("*", k -> new ArrayList<>()).add(r);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        for (var e : byProject.entrySet()) out.put(e.getKey(), stats(e.getValue()));
        return out;
    }

    static Map<String, Object> stats(List<Map<String, Object>> g) {
        int n = g.size();
        Map<String, Integer> status = new TreeMap<>(), cls = new TreeMap<>(), recs = new TreeMap<>();
        int withEffort = 0, noSteps = 0, verify = 0, dev = 0, devTest = 0, mismatch = 0, retro = 0, cycled = 0;
        double effortSum = 0;
        Map<String, List<Double>> cycleByClass = new TreeMap<>();
        for (Map<String, Object> r : g) {
            status.merge(String.valueOf(r.get("status")), 1, Integer::sum);
            cls.merge(String.valueOf(r.get("complexity")), 1, Integer::sum);
            if (r.get("effort_days") instanceof Double d && d > 0) { withEffort++; effortSum += d; }
            if (((Number) r.get("steps")).intValue() < 2) noSteps++;
            if (Boolean.TRUE.equals(r.get("has_verify"))) verify++;
            if ("dev".equals(r.get("task_type"))) { dev++; if (Boolean.TRUE.equals(r.get("has_test"))) devTest++; }
            if (Boolean.FALSE.equals(r.get("estimate_fits"))) mismatch++;
            if (r.get("recommendations") instanceof Collection<?> c)
                for (Object code : c) recs.merge(String.valueOf(code), 1, Integer::sum);
            if (r.get("cycle_days") instanceof Double cd) {
                cycled++;
                if (Boolean.TRUE.equals(r.get("created_done"))) retro++;
                else cycleByClass.computeIfAbsent(String.valueOf(r.get("complexity")), k -> new ArrayList<>()).add(cd);
            }
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("tasks", n);
        m.put("by_status", status);
        m.put("by_complexity", cls);
        m.put("with_effort", withEffort);
        m.put("effort_sum_days", Math.round(effortSum * 10) / 10.0);
        m.put("share_no_steps", share(noSteps, n));
        m.put("share_with_verify", share(verify, n));
        m.put("share_dev_with_test", share(devTest, dev));
        m.put("estimate_mismatch", mismatch);
        m.put("recommendations", recs);
        m.put("done_with_cycle", cycled);
        m.put("share_created_done", share(retro, cycled));
        Map<String, Object> med = new LinkedHashMap<>();
        for (var e : cycleByClass.entrySet()) med.put(e.getKey(), median(e.getValue()));
        m.put("median_cycle_days_by_complexity", med);
        return m;
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    static String statusGroup(String s) {
        if (s == null) return "unknown";
        String u = s.toUpperCase();
        if (u.contains("DONE")) return "done";
        if (u.contains("CANCEL")) return "cancelled";
        if (u.contains("PARTIAL")) return "partial";
        if (u.contains("BLOCK")) return "blocked";
        if (u.contains("PROGRESS") || u.contains("ACTIVE")) return "active";
        return "open";
    }

    private static Double share(int a, int b) {
        return b == 0 ? null : Math.round(1000.0 * a / b) / 1000.0;
    }

    private static Double median(List<Double> v) {
        if (v.isEmpty()) return null;
        List<Double> s = new ArrayList<>(v);
        s.sort(Double::compare);
        return Math.round(s.get(s.size() / 2) * 100) / 100.0;
    }

    private static Object first(Object v) {
        if (v instanceof List<?> l) return l.isEmpty() ? null : l.get(0);
        return v;
    }

    /** Обход через два ребра отдаёт список списков — берём первое непустое значение. */
    private static Object firstFlat(Object v) {
        if (v instanceof Collection<?> c) {
            for (Object o : c) {
                Object x = firstFlat(o);
                if (x != null && !String.valueOf(x).isBlank()) return x;
            }
            return null;
        }
        return v;
    }

    private static String nul(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    static LocalDateTime parse(String ts) {
        if (ts == null || ts.length() < 10) return null;
        try {
            if (ts.length() >= 19 && (ts.endsWith("Z") || ts.matches(".*[+-]\\d\\d:\\d\\d$")))
                return OffsetDateTime.parse(ts).toLocalDateTime();
            String t = ts.length() >= 19 ? ts.substring(0, 19).replace(' ', 'T') : ts.substring(0, 10) + "T00:00:00";
            return LocalDateTime.parse(t);
        } catch (Exception e) {
            return null;
        }
    }

    private static LocalDateTime minDate(Object v) {
        LocalDateTime min = null;
        if (v instanceof Collection<?> c) {
            for (Object o : c) {
                LocalDateTime d = o instanceof Collection<?> ? minDate(o) : parse(nul(o));
                if (d != null && (min == null || d.isBefore(min))) min = d;
            }
        } else {
            min = parse(nul(v));
        }
        return min;
    }
}
