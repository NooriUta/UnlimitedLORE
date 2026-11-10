package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * SPRINT_UXR_S1_HONEST_API/S1-09: записи, намеренно лишённые проекта, построчным
 * проектным скоупом не режутся.
 *
 * <p><b>Откуда.</b> Решение владелицы 19.10.2026 («Claude rules infra пока ни к
 * чему не привязывай», см. V47 в {@code LoreSchemaMigrationRunner}): доки вида
 * {@code claude-rules} и ранбуки области {@code infra} описывают МАШИНУ и стенд,
 * а не продукт, и остаются без {@code BELONGS_TO_PROJECT}. Построчный скоуп
 * ({@code LoreSlices.PROJECT_SCOPED}) отсекает всё без ребра проекта — и панель
 * «Правила CLAUDE» под скоупом видела 1 док из ~10 (тот, которому ребро всё же
 * поставили), без единого признака неполноты.
 *
 * <p><b>Как.</b> Вторым запросом без скоупа, но с фильтром исключённого вида;
 * из него берутся только строки БЕЗ проекта (с проектом — подчиняются скоупу как
 * обычно) и вливаются в выдачу с сортировкой по id, как в самом срезе. Число
 * влитых строк пишется в маркер {@code scope}, чтобы выдача объясняла себя.
 */
final class ScopeExemptRows {

    /** Фильтр среза, который выбирает исключённый вид, и поле id для слияния/сортировки. */
    record Exemption(String param, String value, String idField, String why) {}

    static final Map<String, Exemption> BY_SLICE = Map.of(
        "docs", new Exemption("kind", "claude-rules", "doc_id",
            "доки claude-rules без проекта — знание о машине, по решению владелицы 19.10.2026 вне проектов"),
        "runbooks", new Exemption("area", "infra", "runbook_id",
            "ранбуки infra без проекта — знание о стенде, по решению владелицы 19.10.2026 вне проектов")
    );

    record Merged(List<Map<String, Object>> rows, int added) {}

    private ScopeExemptRows() {}

    /**
     * Параметры второго (нескоупного) запроса, либо {@code null} — подмешивать нечего:
     * скоуп выключен ({@code allowed == null}), пуст (там честный 403), у среза нет
     * исключения, вызывающий просил другой вид или явно фильтрует по проекту.
     */
    /**
     * Ревью 10.11, B12: выбор проектов в шапке ({@code scope_projects}, вынимается из параметров до
     * этого вызова) — такой же явный фильтр по проекту, как {@code project}: записи без проекта ему
     * не отвечают.
     */
    static Map<String, String> exemptParams(String sliceId, Map<String, String> given, Set<String> allowed,
                                            boolean headerProjectsChosen) {
        if (headerProjectsChosen) return null;
        return exemptParams(sliceId, given, allowed);
    }

    static Map<String, String> exemptParams(String sliceId, Map<String, String> given, Set<String> allowed) {
        if (allowed == null || allowed.isEmpty()) return null;
        Exemption ex = BY_SLICE.get(sliceId);
        if (ex == null) return null;
        if (given.containsKey("project")) return null;
        String asked = given.get(ex.param());
        if (asked != null && !asked.equals(ex.value())) return null;
        Map<String, String> p = new LinkedHashMap<>(given);
        p.put(ex.param(), ex.value());
        return p;
    }

    /** Вливает строки без проекта из {@code exempt} в {@code scoped}, без дублей, по id. */
    static Merged merge(String sliceId, List<Map<String, Object>> scoped, List<Map<String, Object>> exempt) {
        Exemption ex = BY_SLICE.get(sliceId);
        List<Map<String, Object>> base = scoped == null ? new ArrayList<>() : new ArrayList<>(scoped);
        if (ex == null || exempt == null || exempt.isEmpty()) return new Merged(base, 0);
        Set<String> seen = new LinkedHashSet<>();
        for (Map<String, Object> r : base) seen.add(String.valueOf(r.get(ex.idField())));
        int added = 0;
        for (Map<String, Object> r : exempt) {
            if (!projectless(r.get("projects"))) continue;
            if (seen.add(String.valueOf(r.get(ex.idField())))) {
                base.add(r);
                added++;
            }
        }
        if (added > 0) base.sort(Comparator.comparing(r -> String.valueOf(r.get(ex.idField()))));
        return new Merged(base, added);
    }

    /** Дописывает в маркер скоупа, сколько строк вошло по исключению и почему. */
    static void annotate(Map<String, Object> scopeMarker, String sliceId, int added) {
        if (scopeMarker == null || added <= 0) return;
        Exemption ex = BY_SLICE.get(sliceId);
        if (ex == null) return;
        scopeMarker.put("exempt_rows", added);
        scopeMarker.put("exempt_note", ex.why());
    }

    private static boolean projectless(Object projects) {
        if (projects == null) return true;
        if (projects instanceof java.util.Collection<?> c) {
            return c.stream().allMatch(p -> p == null || String.valueOf(p).isBlank());
        }
        return String.valueOf(projects).isBlank();
    }
}
