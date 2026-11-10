package studio.seer.heimdall.lore;

import java.util.List;
import java.util.Map;

/**
 * SPRINT_UXR_S9_SCALE_OPT/S9-01 — серверные фасеты и итоги списка. ЗАГЛУШКА до кода:
 * сигнатуры те же, что у реализации, тесты {@code LoreListFacetsTest} падают проверкой.
 */
final class LoreListFacets {

    private LoreListFacets() {}

    static List<String> axes(String sliceId, String raw) { return List.of(); }

    static Map<String, String> filtersOf(Map<String, String> given) { return Map.of(); }

    static Map<String, String> withoutAxis(String sliceId, Map<String, String> filters, String axis) { return Map.of(); }

    static String defaultGroupBy(String sliceId) { return null; }

    static Map<String, Object> facet(List<Map<String, Object>> rows, String field) { return Map.of(); }

    static Map<String, Object> totals(List<Map<String, Object>> rows, String groupBy) { return Map.of(); }

    static Map<String, Object> assemble(String sliceId, List<String> axes, Map<String, Object> base,
                                        Map<String, Map<String, Object>> perAxis, Map<String, String> errors,
                                        String groupBy, Map<String, String> filters) { return Map.of(); }
}
