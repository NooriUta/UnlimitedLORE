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
 * <p><b>Автор правки.</b> С S2-12 версия несёт автора сама ({@code changed_by},
 * {@code changed_by_kind} из проверенного токена, {@link ChangeAuthor}) — тогда
 * {@code source="hist"} и журнал не нужен. Для старых версий без автора
 * (и версий, записанных без токена) остаётся прежний путь. Источник факта «кто звал» уже есть:
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
        "SELECT ts, source, segment, client, machine, value FROM AgentActionLog "
        + "WHERE object_id = :id ORDER BY ts";

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
     * MINI-06: заголовок записи для ответа истории — с вершины-владельца цепочки (класс цепочки без «Hist»),
     * по тому же полю id. Поле имени у типов разное (title у задачи, name у спринта, label у вехи) —
     * берётся первое непустое. У строки справочника вершины-владельца нет — {@code null}.
     */
    static String titleSql(String type) {
        String hist = type == null ? null : HIST_OF_TYPE.get(type);
        if (hist == null) throw new IllegalArgumentException("unknown history type: " + type + " (known: " + types() + ")");
        if ("dict_entry".equals(type)) return null;
        LoreSlices.HistParent parent = LoreSlices.HIST_PARENT.get(hist);
        String vertex = hist.substring(0, hist.length() - "Hist".length());
        return "SELECT coalesce(title, name, label) AS title FROM " + vertex
            + " WHERE " + parent.idField() + " = :id LIMIT 1";
    }

    /**
     * SQL цепочки одной сущности. Поля, которых у цепочки нет (status_raw у спеки,
     * source_commit у вехи), ArcadeDB отдаёт null — форма строки одна на все типы.
     */
    static String sql(String type) {
        String hist = type == null ? null : HIST_OF_TYPE.get(type);
        if (hist == null) throw new IllegalArgumentException("unknown history type: " + type + " (known: " + types() + ")");
        LoreSlices.HistParent parent = LoreSlices.HIST_PARENT.get(hist);
        boolean dict = "dict_entry".equals(type);
        // У строки справочника ключ денормализован на саму Hist (составной, без одиночного id у вершины).
        // B9: история читается в контексте записи. WHERE — CONTAINS, а не «первый владелец [0] =»:
        // версия, общая у нескольких записей (S2-11), иначе у второго владельца молча пуста —
        // WHERE по чужому [0] не сматчится. ref_id — сам запрошенный :id, а не in('HAS_STATE').<id>[0]:
        // иначе строки в истории второго владельца несли бы чужой ключ.
        String idExpr = dict ? "code" : ":id";
        String where = dict ? "code = :id" : "in('HAS_STATE')." + parent.idField() + " CONTAINS :id";
        StringBuilder sb = new StringBuilder("SELECT '").append(type).append("' AS entity_type, '")
            .append(hist).append("' AS hist_type, ").append(idExpr).append(" AS ref_id, state_uid, ")
            .append("valid_from, valid_to, content_hash, source_commit, status_raw, changed_by, changed_by_kind");
        if (dict) sb.append(", dict_type");
        // S7B-06: у дока тело версии — сама суть истории (построчный дифф версий
        // в «Правилах CLAUDE»); без него экран видел только смену хеша.
        if ("doc".equals(type)) sb.append(", content_md");
        String p = projectsExpr(type);
        if (p != null) sb.append(", ").append(p).append(" AS projects");
        String via = projectsViaExpr(type);
        if (via != null) sb.append(", ").append(via).append(" AS projects_via");
        sb.append(" FROM ").append(hist).append(" WHERE ").append(where).append(" ORDER BY valid_from");
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
     * {@code caller}, {@code source} (hist|journal|ingest|none), {@code commit}, {@code reason};
     * при {@code source=hist} — ещё {@code kc_sub} (человек) или {@code client_id} (агент).
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
            Object rowKind = r.get("changed_by_kind");
            Object rowBy = r.get("changed_by");
            if (rowBy != null && (ChangeAuthor.KIND_HUMAN.equals(rowKind) || ChangeAuthor.KIND_AGENT.equals(rowKind))) {
                // S2-12: автор записан в самой версии из проверенного токена — это факт,
                // журнал и догадки по времени не нужны.
                author.put("kind", rowKind.toString());
                author.put("caller", rowBy.toString());
                author.put("source", "hist");
                // Форма контракта S2 HistoryAuthor: человек — kc_sub, агент — client_id.
                author.put(ChangeAuthor.KIND_HUMAN.equals(rowKind) ? "kc_sub" : "client_id", rowBy.toString());
                // D-2026-LORE-AGENT-MACHINE-EVERYWHERE: машину версия не хранит — берётся из точки
                // журнала той же правки; нет точки — «неизвестно», у человека — «не применимо».
                author.put("machine", ChangeAuthor.KIND_HUMAN.equals(rowKind) ? AgentMachine.NOT_APPLICABLE
                    : best != null && best.get("machine") != null && !best.get("machine").toString().isBlank()
                        ? best.get("machine").toString() : AgentMachine.UNKNOWN);
            } else if (best != null) {
                Object axis = best.get("segment");
                author.put("kind", axis == null || axis.toString().isBlank() ? "unknown" : axis.toString());
                author.put("caller", best.get("source"));
                author.put("source", "journal");
                // Точки до V86 несут «(unknown)», новые — машину или «(n/a)» у не-агента.
                author.put("client", best.get("client"));
                author.put("machine", best.get("machine"));
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

    // ── S9-09: история на 100+ версий — страница, фильтры, порядок ───────────

    /** Предел строк на страницу. */
    static final int PAGE_MAX = 500;
    static final java.util.Set<String> AUTHOR_KINDS = java.util.Set.of("human", "agent", "unknown", "ingest", "unauth");
    /** Поле версии → колонка строки истории, по которой видно изменение. */
    static final Map<String, String> CHANGE_FIELDS = Map.of("status", "status_raw", "content", "content_hash");

    /** Причина отказа параметров страницы или null. */
    static String pageError(String authorKind, String field, String order, Integer offset, Integer limit) {
        if (authorKind != null && !AUTHOR_KINDS.contains(authorKind)) return "author_kind must be one of " + AUTHOR_KINDS;
        if (field != null && !CHANGE_FIELDS.containsKey(field)) return "field must be one of " + CHANGE_FIELDS.keySet();
        if (order != null && !order.equals("asc") && !order.equals("desc")) return "order must be asc or desc";
        if (offset != null && offset < 0) return "offset must be >= 0";
        if (limit != null && (limit < 1 || limit > PAGE_MAX)) return "limit must be 1.." + PAGE_MAX;
        return null;
    }

    /**
     * Страница истории над атрибутированными строками в хронологии (как отдаёт {@link #sql}).
     * Фильтр по полю оставляет версии, в которых поле изменилось относительно предыдущей
     * версии ВСЕЙ цепочки (первая версия — изменение). total — после фильтров;
     * has_more — за страницей есть ещё. Без параметров — вся цепочка, как раньше.
     */
    @SuppressWarnings("unchecked")
    static Map<String, Object> page(List<Map<String, Object>> rows, String authorKind, String field,
                                    String order, Integer offset, Integer limit) {
        List<Map<String, Object>> kept = new ArrayList<>();
        String col = field == null ? null : CHANGE_FIELDS.get(field);
        Object prev = null;
        boolean first = true;
        for (Map<String, Object> r : rows) {
            Object cur = col == null ? null : r.get(col);
            boolean changed = col == null || first || !java.util.Objects.equals(prev, cur);
            prev = cur;
            first = false;
            if (!changed) continue;
            if (authorKind != null) {
                Object a = r.get("author");
                Object kind = a instanceof Map<?, ?> m ? m.get("kind") : null;
                if (!authorKind.equals(kind)) continue;
            }
            kept.add(r);
        }
        if ("desc".equals(order)) java.util.Collections.reverse(kept);
        int total = kept.size();
        int from = offset == null ? 0 : Math.min(offset, total);
        int to = limit == null ? total : Math.min(total, from + limit);
        Map<String, Object> page = new LinkedHashMap<>();
        page.put("total", total);
        page.put("offset", from);
        page.put("limit", limit);
        page.put("returned", to - from);
        page.put("has_more", to < total);
        page.put("order", order == null ? "asc" : order);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("rows", new ArrayList<>(kept.subList(from, to)));
        out.put("page", page);
        return out;
    }

    /** Режимы свёртки. */
    static final java.util.Set<String> COLLAPSE_MODES = java.util.Set.of("agent");

    /** Предел длины {@code author} — идентификатор вызывающего, не текст. */
    static final int AUTHOR_MAX = 200;

    /** Причина отказа параметров страницы (с автором и свёрткой) или null. */
    static String pageError(String authorKind, String author, String field, String collapse,
                            String order, Integer offset, Integer limit) {
        if (author != null && author.isBlank()) return "author must not be blank";
        if (author != null && author.length() > AUTHOR_MAX) return "author must be at most " + AUTHOR_MAX + " characters";
        if (collapse != null && !COLLAPSE_MODES.contains(collapse)) return "collapse must be one of " + COLLAPSE_MODES;
        return pageError(authorKind, field, order, offset, limit);
    }

    /**
     * Страница истории с фильтром по конкретному автору ({@code author} — {@code author.caller},
     * вместе с {@code authorKind} по И) и свёрткой {@code collapse=agent}: подряд идущие
     * (после фильтров, в хронологии) правки ОДНОГО агента — одна строка, последняя версия
     * серии, с {@code collapsed {count, first_state_uid, first_valid_from}}; серия из одной
     * правки не помечается. Свёртка — до страницы, поэтому total/has_more честны.
     */
    static Map<String, Object> page(List<Map<String, Object>> rows, String authorKind, String author, String field,
                                    String collapse, String order, Integer offset, Integer limit) {
        // Порядок применения: поле (по всей цепочке) → вид/автор → свёртка → порядок → страница.
        Map<String, Object> all = page(rows, authorKind, field, null, null, null);
        @SuppressWarnings("unchecked") List<Map<String, Object>> kept = (List<Map<String, Object>>) all.get("rows");
        if (author != null) {
            List<Map<String, Object>> byAuthor = new ArrayList<>();
            for (Map<String, Object> r : kept) if (author.equals(authorField(r, "caller"))) byAuthor.add(r);
            kept = byAuthor;
        }
        if ("agent".equals(collapse)) kept = collapseAgentRuns(kept);
        Map<String, Object> out = page(kept, null, null, order, offset, limit);
        @SuppressWarnings("unchecked") Map<String, Object> pg = (Map<String, Object>) out.get("page");
        if (author != null) pg.put("author", author);
        if (collapse != null) pg.put("collapse", collapse);
        return out;
    }

    private static Object authorField(Map<String, Object> r, String key) {
        Object a = r.get("author");
        return a instanceof Map<?, ?> m ? m.get(key) : null;
    }

    private static List<Map<String, Object>> collapseAgentRuns(List<Map<String, Object>> rows) {
        List<Map<String, Object>> out = new ArrayList<>();
        int i = 0;
        while (i < rows.size()) {
            Map<String, Object> first = rows.get(i);
            Object caller = authorField(first, "caller");
            int j = i + 1;
            if (ChangeAuthor.KIND_AGENT.equals(authorField(first, "kind")) && caller != null) {
                while (j < rows.size() && ChangeAuthor.KIND_AGENT.equals(authorField(rows.get(j), "kind"))
                       && caller.equals(authorField(rows.get(j), "caller"))) j++;
            }
            if (j - i == 1) { out.add(first); i = j; continue; }
            Map<String, Object> last = new LinkedHashMap<>(rows.get(j - 1));
            Map<String, Object> run = new LinkedHashMap<>();
            run.put("count", j - i);
            run.put("first_state_uid", first.get("state_uid"));
            run.put("first_valid_from", first.get("valid_from"));
            last.put("collapsed", run);
            out.add(last);
            i = j;
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
