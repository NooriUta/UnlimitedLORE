package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Владелица 09.11.2026: «верхний фильтр по проектам не влияет на элементы внизу».
 *
 * <p>{@code ?scope_projects=a,b} у любого среза: выбор проектов в шапке v2 сужает выдачу.
 * Выбор ПЕРЕСЕКАЕТСЯ с правами вызывающего — сужает, но никогда не расширяет; отброшенные
 * проекты называются в ответе. Срез, не привязанный к проектам, сузить нечем — это сказано
 * словами ({@code applied:false} + причина), а выдача остаётся прежней: молча проигнорированный
 * фильтр выглядел бы как работающий.
 */
final class SliceProjectNarrowing {
    static final String PARAM = "scope_projects";

    /**
     * @param scope         множество проектов для {@link LoreSlices#compose(String, Map, Set)}
     *                      ({@code null} — без ограничения)
     * @param meta          отметка для ответа ({@code null} — параметра не было)
     * @param emptyByChoice ни один выбранный проект вызывающему не доступен: пусто по выбору,
     *                      а не «нет прав вообще» (тот случай — SCOPE_EMPTY, 403)
     */
    record Result(Set<String> scope, Map<String, Object> meta, boolean emptyByChoice) {}

    private SliceProjectNarrowing() {}

    /**
     * PS-PRODUCT-FILTER (владелица 21.11.2026: «считаем продукт логической группировкой проектов; на верхний фильтр
     * выносим продукт — фильтр по продукту делаем для бэка»). {@code ?scope_products=A,B} раскрывается в проекты
     * продуктов (их BELONGS_TO_PROJECT) и уходит в {@link #PARAM}: дальше — тот же путь сужения правами.
     */
    static final String PRODUCTS_PARAM = "scope_products";
    /** Проект, которого заведомо нет: продукт без проектов — пусто по выбору, а не «всё». */
    static final String NO_PROJECT = "__no_project__";

    /**
     * Вынимает {@link #PRODUCTS_PARAM} и пишет проекты продуктов в {@link #PARAM} (с уже выбранными проектами —
     * пересечение). Возвращает отметку для ответа или {@code null}, если параметра не было.
     */
    static Map<String, Object> expandProducts(Map<String, String> given, Map<String, List<String>> projectsOf) {
        return expandProducts(given, projectsOf, Map.of());
    }

    /**
     * Владелица 21.11.2026: в шапке подпродукты — раскрывашкой под продуктом, выбор родителя включает подпродукты.
     * {@code parentOf} — подпродукт → родитель (PARENT_PRODUCT): к выбранному продукту добавляются все его потомки
     * (по цепочке), проекты — объединением без дублей. Выбранный подпродукт родителя не тянет.
     */
    static Map<String, Object> expandProducts(Map<String, String> given, Map<String, List<String>> projectsOf,
                                              Map<String, String> parentOf) {
        String raw = given.remove(PRODUCTS_PARAM);
        if (raw == null) return null;
        List<String> products = LoreSlices.listValue(PRODUCTS_PARAM, raw);
        Map<String, List<String>> childrenOf = new LinkedHashMap<>();
        for (Map.Entry<String, String> e : new java.util.TreeMap<>(parentOf).entrySet())
            childrenOf.computeIfAbsent(e.getValue(), k -> new ArrayList<>()).add(e.getKey());
        Set<String> codes = new LinkedHashSet<>(products);
        List<String> subproducts = new ArrayList<>();
        java.util.Deque<String> queue = new java.util.ArrayDeque<>(products);
        while (!queue.isEmpty()) {
            for (String child : childrenOf.getOrDefault(queue.poll(), List.of())) {
                if (codes.add(child)) { subproducts.add(child); queue.add(child); }
            }
        }
        Set<String> projects = new LinkedHashSet<>();
        List<String> unknown = new ArrayList<>();
        List<String> withoutProjects = new ArrayList<>();
        for (String code : codes) {
            List<String> ps = projectsOf.get(code);
            if (ps == null) { unknown.add(code); continue; }
            if (ps.isEmpty() && products.contains(code)) withoutProjects.add(code);
            projects.addAll(ps);
        }
        String chosen = given.get(PARAM);
        if (chosen != null) projects.retainAll(new LinkedHashSet<>(LoreSlices.listValue(PARAM, chosen)));
        given.put(PARAM, projects.isEmpty() ? NO_PROJECT : String.join(",", projects));
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("products", products);
        if (!subproducts.isEmpty()) meta.put("subproducts", subproducts);
        meta.put("projects", List.copyOf(projects));
        if (!unknown.isEmpty()) meta.put("unknown", unknown);
        if (!withoutProjects.isEmpty()) meta.put("without_projects", withoutProjects);
        return meta;
    }

    /** Вынимает {@link #PARAM} из {@code given} (срез этого параметра не знает) и считает скоуп. */
    static Result apply(String sliceId, Map<String, String> given, Set<String> rowScope) {
        String raw = given.remove(PARAM);
        if (raw == null) return new Result(rowScope, null, false);
        List<String> requested = LoreSlices.listValue(PARAM, raw);

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("requested", requested);
        if (!LoreSlices.PROJECT_SCOPED.containsKey(sliceId)) {
            meta.put("applied", false);
            // Ревью 10.11, B11: текст отметки — в `note` (его читает клиент), не в `reason`.
            meta.put("note", "срез " + sliceId + " не привязан к проектам — сузить по выбранным проектам "
                + "нечем, показано всё доступное");
            return new Result(rowScope, meta, false);
        }
        Set<String> effective = new LinkedHashSet<>();
        List<String> dropped = new ArrayList<>();
        for (String p : requested) {
            if (rowScope == null || rowScope.contains(p)) effective.add(p);
            else if (!NO_PROJECT.equals(p)) dropped.add(p);
        }
        meta.put("applied", true);
        // Отброшенные называются один раз — списком dropped; та же фраза в note была дублем (ревью 10.11).
        meta.put("dropped", dropped);
        return new Result(effective, meta, effective.isEmpty());
    }
}
