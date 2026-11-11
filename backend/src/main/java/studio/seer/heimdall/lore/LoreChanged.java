package studio.seer.heimdall.lore;

import java.util.List;
import java.util.Map;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-MCP-CHANGED-RANGE — заготовка под тест (красный до кода).
 */
final class LoreChanged {

    private LoreChanged() {}

    record Source(String type, List<String> slices, String idField, String titleField, String statusField,
                  String histType, String projectParam, List<String> projectCols) {}

    record Query(List<String> types) {}

    static final Map<String, Source> SOURCES = Map.of();

    static Query parse(Map<String, String> params) { throw new UnsupportedOperationException("not implemented"); }

    static List<String> slicesFor(Source s, String statusCategory) { throw new UnsupportedOperationException("not implemented"); }

    static Map<String, String> sliceParams(Source s, String project) { throw new UnsupportedOperationException("not implemented"); }

    static String projectUnsupported(Source s, String project) { throw new UnsupportedOperationException("not implemented"); }

    static List<String> changedIds(Source s, List<Map<String, Object>> rows, Query q) { throw new UnsupportedOperationException("not implemented"); }

    static List<Map<String, Object>> items(Source s, List<Map<String, Object>> rows, List<Map<String, Object>> hist, Query q) {
        throw new UnsupportedOperationException("not implemented");
    }

    static String histSql(Source s) { throw new UnsupportedOperationException("not implemented"); }

    static Map<String, Object> assemble(Query q, List<Map<String, Object>> items, List<Map<String, Object>> errors) {
        throw new UnsupportedOperationException("not implemented");
    }
}
