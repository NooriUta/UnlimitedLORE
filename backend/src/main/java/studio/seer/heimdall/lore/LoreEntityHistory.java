package studio.seer.heimdall.lore;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-03 — общий запрос истории SCD2 по карте
 * {@link LoreSlices#HIST_PARENT} для всех типов, с автором правки.
 *
 * <p><b>Почему не слайс на тип.</b> История по id была только у спринта,
 * задачи, ADR и справочника; у спек и решений — лишь пакетные {@code _all},
 * у остальных цепочек — ничего. Таблица «какие бывают цепочки и как зовётся
 * родитель» уже есть ({@code HIST_PARENT}, сверяется с реестром {@code valid_from}
 * статическим блоком) — третья таблица о том же здесь не заводится (RM-P8).
 *
 * <p><b>Почему SQL на тип, а не unionall всех цепочек.</b> Тип известен из
 * запроса: unionall сканировал бы двенадцать таблиц ради одной.
 *
 * <p><b>Автор правки.</b> На строке истории автора нет (и миграцией он сюда не
 * добавляется — задача без миграции). Источник факта «кто звал» уже есть:
 * журнал действий AO-01 ({@code MetricSnapshot}, {@code metric='lore.action'}) —
 * точка на каждый мутирующий вызов с осью из ТОКЕНА ({@code agent|human|unauth}),
 * вызывающим и кодом ответа. Строка истории сопоставляется с ближайшей УСПЕШНОЙ
 * точкой журнала по той же сущности в окне вокруг {@code valid_from}. Не нашлось —
 * {@code kind="unknown"} с причиной, а не «человек» по умолчанию: «не смогли
 * установить» ≠ «правил человек». Строка, пришедшая из git-ингеста
 * ({@code source_commit}), без точки журнала — {@code kind="ingest"}.
 *
 * <p>Чистые функции без состояния — тестируются без базы.
 */
final class LoreEntityHistory {

    private LoreEntityHistory() {}

    /** Окно сопоставления: точка журнала пишется ПОСЛЕ ответа, то есть чуть позже valid_from. */
    static final long WINDOW_BEFORE_MS = 5_000;
    static final long WINDOW_AFTER_MS  = 60_000;

    /** Источник атрибуции — называется в ответе, чтобы «unknown» было объяснимо. */
    static final String JOURNAL_SQL =
        "SELECT ts, source, segment, value FROM MetricSnapshot "
        + "WHERE metric = 'lore.action' AND object_id = :id ORDER BY ts";

    private static final String DIRECT  = "in('HAS_STATE').out('BELONGS_TO_PROJECT').slug";
    private static final String VIA_SPRINT = "in('HAS_STATE').out('PART_OF').out('BELONGS_TO_PROJECT').slug";

    /**
     * Проект строки — тем же путём, что у read-скоупа слайсов ({@code PROJECT_SCOPED}):
     * задача и фаза — через спринт, решение — своё ребро ИЛИ ребро родительского ADR.
     * Справочник — общий (как {@code history_dict}), скоупом не режется.
     */
    private static String projectsExpr(String type) {
        return switch (type) {
            case "task", "phase" -> VIA_SPRINT;
            case "dict_entry"    -> null;
            default              -> DIRECT;
        };
    }

    private static String projectsViaExpr(String type) {
        return "decision".equals(type) ? "in('HAS_STATE').out('DECIDED_IN').out('BELONGS_TO_PROJECT').slug" : null;
    }

    static boolean isGlobal(String type) { return projectsExpr(type) == null; }

    /** Тип сущности → класс цепочки, в устойчивом порядке. */
    private static final Map<String, String> HIST_OF_TYPE;
    static {
        Map<String, String> m = new TreeMap<>();
        for (Map.Entry<String, LoreSlices.HistParent> e : LoreSlices.HIST_PARENT.entrySet())
            m.put(e.getValue().entityType(), e.getKey());
        HIST_OF_TYPE = java.util.Collections.unmodifiableMap(m);
    }

    static Set<String> types() { return HIST_OF_TYPE.keySet(); }

    /**
     * SQL цепочки одной сущности. Поля, которых у цепочки нет (status_raw у спеки,
     * source_commit у вехи), ArcadeDB отдаёт null — форма строки одна на все типы.
     */
    static String sql(String type) {
        String hist = type == null ? null : HIST_OF_TYPE.get(type);
        if (hist == null) throw new IllegalArgumentException("unknown history type: " + type + " (known: " + types() + ")");
        LoreSlices.HistParent parent = LoreSlices.HIST_PARENT.get(hist);
        // У строки справочника ключ денормализован на саму Hist (составной, без одиночного id у вершины).
        String idExpr = "dict_entry".equals(type) ? "code" : "in('HAS_STATE')." + parent.idField() + "[0]";
        StringBuilder sb = new StringBuilder("SELECT '").append(type).append("' AS entity_type, '")
            .append(hist).append("' AS hist_type, ").append(idExpr).append(" AS ref_id, state_uid, ")
            .append("valid_from, valid_to, content_hash, source_commit, status_raw");
        if ("dict_entry".equals(type)) sb.append(", dict_type");
        String p = projectsExpr(type);
        if (p != null) sb.append(", ").append(p).append(" AS projects");
        String via = projectsViaExpr(type);
        if (via != null) sb.append(", ").append(via).append(" AS projects_via");
        sb.append(" FROM ").append(hist).append(" WHERE ").append(idExpr).append(" = :id ORDER BY valid_from");
        return sb.toString();
    }

    /**
     * Проектный скоуп по строкам: видна, если ХОТЯ БЫ ОДИН её проект разрешён
     * (правило слайсов). {@code allowed == null} — без ограничения; общий тип не режется.
     */
    static List<Map<String, Object>> scope(String type, List<Map<String, Object>> rows, Set<String> allowed) {
        if (allowed == null || isGlobal(type)) return rows;
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            boolean ok = false;
            for (String key : List.of("projects", "projects_via")) {
                Object v = r.get(key);
                if (v instanceof Collection<?> c) { for (Object o : c) if (o != null && allowed.contains(o.toString())) ok = true; }
                else if (v != null && allowed.contains(v.toString())) ok = true;
            }
            if (ok) out.add(r);
        }
        return out;
    }

    /**
     * Каждой строке — поле {@code author}: {@code kind} (agent|human|unauth|ingest|unknown),
     * {@code caller}, {@code source} (journal|ingest|none), {@code commit}, {@code reason}.
     * Входные карты не меняются.
     */
    static List<Map<String, Object>> attribute(List<Map<String, Object>> rows, List<Map<String, Object>> journal) {
        List<long[]> points = new ArrayList<>();          // [ts, index]
        for (int i = 0; i < journal.size(); i++) {
            Map<String, Object> p = journal.get(i);
            Long ts = epochMillis(p.get("ts"));
            if (ts == null || !isSuccess(p.get("value"))) continue;
            points.add(new long[] {ts, i});
        }
        List<Map<String, Object>> out = new ArrayList<>(rows.size());
        for (Map<String, Object> r : rows) {
            Map<String, Object> row = new LinkedHashMap<>(r);
            Map<String, Object> author = new LinkedHashMap<>();
            Long vf = epochMillis(r.get("valid_from"));
            Map<String, Object> best = null;
            long bestDist = Long.MAX_VALUE;
            if (vf != null) {
                for (long[] pt : points) {
                    long d = pt[0] - vf;
                    if (d < -WINDOW_BEFORE_MS || d > WINDOW_AFTER_MS) continue;
                    if (Math.abs(d) < bestDist) { bestDist = Math.abs(d); best = journal.get((int) pt[1]); }
                }
            }
            Object commit = r.get("source_commit");
            if (best != null) {
                Object axis = best.get("segment");
                author.put("kind", axis == null || axis.toString().isBlank() ? "unknown" : axis.toString());
                author.put("caller", best.get("source"));
                author.put("source", "journal");
            } else if (commit != null && !commit.toString().isBlank()) {
                author.put("kind", "ingest");
                author.put("caller", null);
                author.put("source", "ingest");
                author.put("commit", commit.toString());
            } else {
                author.put("kind", "unknown");
                author.put("caller", null);
                author.put("source", "none");
                author.put("reason", vf == null
                    ? "у строки истории нет valid_from — сопоставить с журналом действий нечем"
                    : "в журнале действий (AO-01) нет успешного вызова по этой сущности рядом с правкой — "
                      + "правка старше журнала или записана в обход REST");
            }
            row.put("author", author);
            out.add(row);
        }
        return out;
    }

    private static boolean isSuccess(Object status) {
        if (status instanceof Number n) return n.doubleValue() >= 200 && n.doubleValue() < 300;
        if (status == null) return false;
        try { double d = Double.parseDouble(status.toString()); return d >= 200 && d < 300; }
        catch (NumberFormatException e) { return false; }
    }

    /** epoch millis | строка-число | DATETIME в форме рендера ArcadeDB | ISO-Z | дата. */
    static Long epochMillis(Object v) {
        if (v == null) return null;
        if (v instanceof Number n) return n.longValue();
        String s = v.toString().trim();
        if (s.isEmpty()) return null;
        if (s.chars().allMatch(Character::isDigit)) {
            try { return Long.parseLong(s); } catch (NumberFormatException e) { return null; }
        }
        Object iso = LoreTimeFormat.isoUtc(s);
        try { return Instant.parse(iso.toString()).toEpochMilli(); } catch (RuntimeException ignored) { /* следующая форма */ }
        try { return LocalDate.parse(s).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(); }
        catch (RuntimeException e) { return null; }
    }
}
