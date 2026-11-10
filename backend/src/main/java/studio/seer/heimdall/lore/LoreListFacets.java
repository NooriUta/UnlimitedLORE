package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * SPRINT_UXR_S9_SCALE_OPT/S9-01 — серверные фасеты и итоги списка
 * ({@code GET /lore/slice/{id}/facets}).
 *
 * <p><b>Зачем.</b> Постраничный список (closed_tasks и др.) видит на клиенте только
 * загруженную страницу: клиентский {@code facetOf} по ней даёт правдоподобные, но
 * неверные числа. Здесь те же числа считаются по ВСЕЙ отфильтрованной выдаче.
 *
 * <p><b>Правила.</b>
 * <ul>
 *   <li>Ось — {@code Facet} из {@code kit/src/list/filterModel.ts}:
 *       {@code {values:[{value,count}] по убыванию счёта, empty, nonempty, total}}.</li>
 *   <li>Ось считается по выдаче БЕЗ фильтра своей оси, но с прочими фильтрами и
 *       текстом {@code q} — иначе выбор значения схлопнул бы ось в одно значение.</li>
 *   <li>Многозначное поле (массив) раскладывается по элементам: Σcount &gt; total —
 *       по контракту.</li>
 *   <li>Несосчитанная ось — в {@code unavailable} с причиной, а не нулём.</li>
 *   <li>Обрезанная выдача — {@code completeness partial|unknown} и {@code cap.parts}:
 *       какая часть (totals или ось) обрезана.</li>
 * </ul>
 * Скоуп, {@code scope_projects} и сам SQL — общие с {@code /slice/{id}}
 * ({@link LoreSlices#compose}, {@link SliceProjectNarrowing}); здесь только счёт.
 */
final class LoreListFacets {

    private LoreListFacets() {}

    /** Свои параметры эндпоинта — в compose не уходят. */
    static final String AXES_PARAM = "axes";
    static final String GROUP_PARAM = "group_by";
    static final int MAX_AXES = 12;

    private static final Set<String> OWN_PARAMS = Set.of(AXES_PARAM, GROUP_PARAM);
    private static final Pattern FIELD_RE = Pattern.compile("[a-z_][a-z0-9_]{0,63}");

    /**
     * Ось (поле строки) → фильтр среза, который её сужает, где имена различаются.
     * Иначе фильтром оси считается одноимённый параметр среза, если он есть.
     */
    static final Map<String, String> AXIS_PARAM = Map.of(
        "sprint_id", "sprint",
        "component_ids", "component",
        "component_id", "component");

    /** Оси из {@code axes=a,b}: поле среза или {@code status_category} у срезов со статусом. */
    static List<String> axes(String sliceId, String raw) {
        if (raw == null || raw.isBlank())
            throw new IllegalArgumentException("missing required param: " + AXES_PARAM + " (поля строки через запятую)");
        List<String> out = new ArrayList<>();
        for (String part : raw.split(",")) {
            String a = part.trim();
            if (a.isEmpty() || out.contains(a)) continue;
            checkField(sliceId, a, AXES_PARAM);
            out.add(a);
        }
        if (out.isEmpty()) throw new IllegalArgumentException("empty list for param: " + AXES_PARAM);
        if (out.size() > MAX_AXES)
            throw new IllegalArgumentException("too many values for param: " + AXES_PARAM + " (max " + MAX_AXES + ")");
        return out;
    }

    /** Поле группировки итогов; {@code null} на входе — {@link #defaultGroupBy}. */
    static String groupBy(String sliceId, String raw) {
        if (raw == null || raw.isBlank()) return defaultGroupBy(sliceId);
        String g = raw.trim();
        checkField(sliceId, g, GROUP_PARAM);
        return g;
    }

    private static void checkField(String sliceId, String field, String param) {
        if (!FIELD_RE.matcher(field).matches())
            throw new IllegalArgumentException("bad value for param: " + param);
        if (LoreStatusCategory.FIELD.equals(field)) {
            if (LoreSectionCount.isCountable(sliceId)) return;
            throw new IllegalArgumentException(param + ": " + field + " — только у срезов со статусом ("
                + String.join(",", LoreSectionCount.countableSlices()) + ")");
        }
        LoreSlices.SliceDef def = LoreSlices.get(sliceId);
        String sql = def == null ? "" : def.baseSql();
        if (!Pattern.compile("\\b" + Pattern.quote(field) + "\\b").matcher(sql).find())
            throw new IllegalArgumentException(param + ": поля " + field + " в срезе " + sliceId + " нет");
    }

    /** Фильтры запроса без страницы (limit/offset/fields) и без своих параметров. */
    static Map<String, String> filtersOf(Map<String, String> given) {
        Map<String, String> out = LoreSectionCount.filtersOf(given);
        OWN_PARAMS.forEach(out::remove);
        return out;
    }

    /** Фильтр, сужающий ось, или {@code null} — у оси своего фильтра нет. */
    static String filterParamOf(String sliceId, String axis) {
        LoreSlices.SliceDef def = LoreSlices.get(sliceId);
        if (def == null) return null;
        String p = AXIS_PARAM.getOrDefault(axis, axis);
        return def.optionalFilters().containsKey(p) ? p : null;
    }

    /** Фильтры для счёта оси: все, кроме фильтра самой оси. Исходная карта не мутируется. */
    static Map<String, String> withoutAxis(String sliceId, Map<String, String> filters, String axis) {
        Map<String, String> out = new LinkedHashMap<>(filters);
        String p = filterParamOf(sliceId, axis);
        if (p != null) out.remove(p);
        return out;
    }

    static String defaultGroupBy(String sliceId) {
        return LoreSectionCount.isCountable(sliceId) ? LoreStatusCategory.FIELD : null;
    }

    /** Значения поля строки: массив — по элементам, скаляр — одно; пустые отброшены. */
    private static List<String> valuesOf(Object v) {
        List<String> out = new ArrayList<>();
        if (v instanceof Collection<?> c) {
            for (Object o : c) addValue(out, o);
        } else if (v instanceof Object[] arr) {
            for (Object o : arr) addValue(out, o);
        } else {
            addValue(out, v);
        }
        return out;
    }

    private static void addValue(List<String> out, Object o) {
        if (o == null) return;
        String s = String.valueOf(o).trim();
        if (!s.isEmpty() && !out.contains(s)) out.add(s);
    }

    /** Ось по строкам — форма {@code Facet} kit. */
    static Map<String, Object> facet(List<Map<String, Object>> rows, String field) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        int empty = 0;
        int total = 0;
        if (rows != null) for (Map<String, Object> r : rows) {
            if (r == null) continue;
            total++;
            List<String> vs = valuesOf(r.get(field));
            if (vs.isEmpty()) { empty++; continue; }
            for (String v : vs) counts.merge(v, 1, Integer::sum);
        }
        List<Map<String, Object>> values = new ArrayList<>();
        counts.entrySet().stream()
            .sorted((a, b) -> b.getValue().equals(a.getValue())
                ? a.getKey().compareTo(b.getKey())
                : Integer.compare(b.getValue(), a.getValue()))
            .forEach(e -> {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("value", e.getKey());
                m.put("count", e.getValue());
                values.add(m);
            });
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("values", values);
        out.put("empty", empty);
        out.put("nonempty", total - empty);
        out.put("total", total);
        return out;
    }

    /** Итоги выдачи: всего и по группе (значению поля {@code groupBy}; пустое — {@code ""}). */
    static Map<String, Object> totals(List<Map<String, Object>> rows, String groupBy) {
        int all = 0;
        Map<String, Integer> by = groupBy == null ? null : new LinkedHashMap<>();
        if (rows != null) for (Map<String, Object> r : rows) {
            if (r == null) continue;
            all++;
            if (by == null) continue;
            List<String> vs = valuesOf(r.get(groupBy));
            if (vs.isEmpty()) by.merge("", 1, Integer::sum);
            else for (String v : vs) by.merge(v, 1, Integer::sum);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("all", all);
        out.put("group_by", groupBy);
        out.put("by_group", by);
        return out;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> rowsOf(String sliceId, Map<String, Object> body) {
        Object raw = body == null ? null : body.get("rows");
        List<Map<String, Object>> rows = raw instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
        return LoreStatusCategory.enrich(sliceId, rows);
    }

    /** complete | partial | unknown — по признаку усечения тела среза ({@code sliceBody}). */
    private static String completenessOf(Map<String, Object> body) {
        Object t = body == null ? null : body.get("truncated");
        return Boolean.TRUE.equals(t) ? "partial" : "unknown".equals(t) ? "unknown" : "complete";
    }

    /**
     * Ответ эндпоинта.
     *
     * @param base    тело среза со всеми фильтрами — итоги и scope
     * @param perAxis тело, по которому считается ось (без её фильтра); {@code null} — не посчитано
     * @param errors  причина для несосчитанных осей
     */
    static Map<String, Object> assemble(String sliceId, List<String> axes, Map<String, Object> base,
                                        Map<String, Map<String, Object>> perAxis, Map<String, String> errors,
                                        String groupBy, Map<String, String> filters) {
        Map<String, Object> facets = new LinkedHashMap<>();
        Map<String, Object> unavailable = new LinkedHashMap<>();
        List<String> cutParts = new ArrayList<>();
        String completeness = "complete";
        Integer limit = null;

        String baseC = completenessOf(base);
        if (!"complete".equals(baseC)) {
            cutParts.add("totals");
            completeness = baseC;
            if (base.get("limit") instanceof Integer i) limit = i;
        }
        for (String axis : axes) {
            Map<String, Object> b = perAxis == null ? null : perAxis.get(axis);
            if (b == null) {
                String why = errors == null ? null : errors.get(axis);
                unavailable.put(axis, why == null ? "ось не посчитана" : why);
                continue;
            }
            facets.put(axis, facet(rowsOf(sliceId, b), axis));
            String c = completenessOf(b);
            if (!"complete".equals(c)) {
                cutParts.add(axis);
                if (!"partial".equals(completeness)) completeness = c;
                if (limit == null && b.get("limit") instanceof Integer i) limit = i;
            }
        }

        Map<String, Object> cap = null;
        if (!cutParts.isEmpty()) {
            cap = new LinkedHashMap<>();
            cap.put("parts", cutParts);
            cap.put("limit", limit);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("section", sliceId);
        out.put("axes", axes);
        out.put("facets", facets);
        out.put("unavailable", unavailable);
        out.put("totals", totals(rowsOf(sliceId, base), groupBy));
        out.put("scope", base == null ? null : base.get("scope"));
        out.put("filters", filters == null ? Map.of() : filters);
        out.put("completeness", completeness);
        out.put("cap", cap);
        return out;
    }
}
