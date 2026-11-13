package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * SPRINT_UXR_POLISH_UAT_1113/PU-17, шаг 3 — СУХОЙ ПРОГОН, срез {@value #SLICE}: какие задачи потеряли
 * роли при переносе. До фикса #1313 task_mv копировал роли из строк вершины, которые после TR-05 пусты,
 * а рёбра ROLE_HELD_BY оставались только у отменённого источника.
 *
 * <p>Признак переноса — точный: moveTask ставит отмену источника и первую версию новой задачи ОДНИМ
 * моментом ({@code now}) и переносит название. Пара «отменённый источник с открытыми рёбрами ролей →
 * задача без открытых рёбер ролей, чья первая версия того же момента, с тем же названием, в другом
 * спринте» — потеря при переносе. Несколько кандидатов на один источник — {@code ambiguous}, такие
 * не восстанавливаются без разбора.
 *
 * <p>Только чтение: срез ничего не пишет. Восстановление — отдельным шагом, штатным путём
 * POST /lore/task/role и только после слова владелицы.
 */
final class LoreRolesLostOnMove {

    private LoreRolesLostOnMove() {}

    static final String SLICE = "task_roles_lost_on_move";

    static final List<String> ROLES = List.of(TaskRole.AUTHOR, TaskRole.EXECUTOR, TaskRole.REVIEWER, TaskRole.HANDOFF);

    private static String holder(String role) {
        String e = "outE('ROLE_HELD_BY')[role='" + role + "' AND valid_to IS NULL].@in.";
        return "ifnull(" + e + "actor_id[0], " + e + "display_name[0]) AS " + role;
    }

    /** Кандидаты пар: отменённые задачи и задачи без открытых ролей. Свёртка — {@link #fold}. */
    static final String SQL = "SELECT task_uid, title, out('PART_OF').sprint_id[0] AS sprint_id, "
        + "out('HAS_STATE')[valid_to IS NULL].status_raw[0] AS status_raw, "
        + "out('HAS_STATE')[valid_to IS NULL].valid_from[0] AS open_from, "
        + "out('HAS_STATE').valid_from AS version_froms, "
        + "outE('ROLE_HELD_BY')[valid_to IS NULL].size() AS open_roles, "
        + String.join(", ", ROLES.stream().map(LoreRolesLostOnMove::holder).toList()) + " "
        + "FROM KnowTask WHERE (outE('ROLE_HELD_BY')[valid_to IS NULL].size() = 0 "
        + "OR out('HAS_STATE')[valid_to IS NULL].status_raw[0].toLowerCase() LIKE '%cancel%')";

    /** Строки SQL → пары «было → стало»; в ответ добавляются счётчики, чтобы ноль пар был проверенным нулём. */
    @SuppressWarnings("unchecked")
    static void fold(Map<String, Object> out) {
        List<Map<String, Object>> rows = out.get("rows") instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
        List<Map<String, Object>> sources = new ArrayList<>();
        Map<String, List<Map<String, Object>>> bare = new LinkedHashMap<>();
        for (Map<String, Object> r : rows) {
            int open = r.get("open_roles") instanceof Number n ? n.intValue() : 0;
            boolean cancelled = "cancelled".equals(LoreStatusVocabulary.classify(LoreRecordValues.str(r.get("status_raw"))));
            if (open > 0 && cancelled) sources.add(r);
            else if (open == 0) bare.computeIfAbsent(key(r.get("title"), firstOf(r.get("version_froms"))), k -> new ArrayList<>()).add(r);
        }
        List<Map<String, Object>> pairs = new ArrayList<>();
        int ambiguous = 0;
        for (Map<String, Object> s : sources) {
            List<Map<String, Object>> hits = new ArrayList<>();
            for (Map<String, Object> b : bare.getOrDefault(key(s.get("title"), str(s.get("open_from"))), List.of()))
                if (!String.valueOf(b.get("sprint_id")).equals(String.valueOf(s.get("sprint_id")))) hits.add(b);
            if (hits.isEmpty()) continue;
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("from_task_uid", s.get("task_uid"));
            p.put("to_task_uid", hits.size() == 1 ? hits.get(0).get("task_uid") : null);
            p.put("candidates", hits.stream().map(h -> h.get("task_uid")).toList());
            p.put("verdict", hits.size() == 1 ? "pair" : "ambiguous");
            p.put("moved_at", str(s.get("open_from")));
            p.put("title", s.get("title"));
            p.put("to_status_raw", hits.size() == 1 ? hits.get(0).get("status_raw") : null);
            for (String role : ROLES) p.put(role, s.get(role));
            pairs.add(p);
            if (hits.size() > 1) ambiguous++;
        }
        out.put("rows", pairs);
        Map<String, Object> checked = new LinkedHashMap<>();
        checked.put("cancelled_with_roles", sources.size());
        checked.put("tasks_without_roles", bare.values().stream().mapToInt(List::size).sum());
        checked.put("pairs", pairs.size() - ambiguous);
        checked.put("ambiguous", ambiguous);
        out.put("checked", checked);
    }

    /** Самая ранняя версия — момент заведения задачи (ISO-строки одного формата сравниваются как строки). */
    static String firstOf(Object versions) {
        String min = null;
        for (String v : LoreRecordValues.arr(versions)) if (min == null || v.compareTo(min) < 0) min = v;
        return min;
    }

    private static String key(Object title, String at) {
        return String.valueOf(title == null ? "" : String.valueOf(title).strip()) + "\u0000" + (at == null ? "" : at);
    }

    private static String str(Object v) {
        return v == null ? null : String.valueOf(v);
    }
}
