package studio.seer.heimdall.lore;

import java.util.List;
import java.util.Map;

/** SPRINT_UXR_S7B_ADMIN/S7B-02 — заглушка до правки (тест до кода). */
public class LoreAdminActions {

    static final int DEFAULT_LIMIT = 200;
    static final int MAX_LIMIT = 1000;

    record Query(String sql, String countSql, Map<String, Object> params) {}

    static Query build(String caller, String axis, String family, Long from, Long to, int limit) {
        return new Query("", "", Map.of());
    }

    static Long parseTime(String name, String v, boolean endOfDay) {
        return -1L;
    }

    static int limitOf(Integer limit) {
        return -1;
    }

    static Map<String, Object> body(List<Map<String, Object>> rows, Long total, int limit) {
        return Map.of();
    }
}
