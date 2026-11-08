package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Спринт нельзя закрыть или отменить, пока в нём есть открытые задачи
 * (D-2026-LORE-SPRINT-CLOSE-NEEDS-TASKS-CLOSED, слово владелицы 08.11.2026:
 * «запрещаю»; ADR-LORE-047, допущение A5).
 *
 * <p>Проверка стоит в том же Java-пути статуса, что вызывает MCP {@code status_set}
 * ({@code LoreStatusResource.updateStatus}), поэтому UI, MCP и пакетная смена
 * получают одинаковый отказ: 409 и список открытых задач.
 *
 * <p>«Открытая» — не в закрытой категории ({@link LoreStatusCategory#CLOSED}:
 * finished, withdrawn). Задача без опознанного статуса считается открытой: «не
 * смогли прочитать» не равно «закрыта».
 *
 * <p>Уже закрытые спринты с открытыми задачами не трогаются — их перечисляет срез
 * {@code closed_sprints_with_open_tasks} (инвентаризация до решения, что с ними
 * делать). Авто-вывод статуса спринта из задач идёт мимо этого пути и закрывает
 * спринт только когда открытых задач нет — ему проверка не нужна.
 */
final class SprintCloseGuard {

    private SprintCloseGuard() {}

    /** Задачи спринта со статусом открытой строки истории (иначе — с вершины). */
    static final String TASKS_SQL =
        "SELECT task_uid, title, "
        + "COALESCE(out('HAS_STATE')[valid_to IS NULL].status_raw[0], status_raw) AS status_raw "
        + "FROM KnowTask WHERE out('PART_OF').sprint_id CONTAINS :sid ORDER BY task_uid";

    /** Закрывающие переходы спринта. */
    static boolean closing(String status) {
        return "done".equals(status) || "cancelled".equals(status);
    }

    /** Открытые задачи из строк {@link #TASKS_SQL}: {task_uid, title, status}. */
    static List<Map<String, Object>> openTasks(List<Map<String, Object>> rows) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (rows == null) return out;
        for (Map<String, Object> r : rows) {
            Object raw = r.get("status_raw");
            if (LoreStatusCategory.isClosed(LoreStatusCategory.of("task", raw))) continue;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("task_uid", r.get("task_uid"));
            m.put("title", r.get("title"));
            m.put("status", LoreRecordValues.planToken(raw == null ? null : String.valueOf(raw)));
            out.add(m);
        }
        return out;
    }

    /** Тело 409: код, пояснение, число и список открытых задач. */
    static Map<String, Object> conflictBody(String sprintId, String status, List<Map<String, Object>> open) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", "SPRINT_HAS_OPEN_TASKS");
        body.put("detail", "спринт '" + sprintId + "' нельзя перевести в " + status + ": открыто "
            + open.size() + " задач — закройте или отмените их (или перенесите task_mv)");
        body.put("open_count", open.size());
        body.put("open_tasks", open);
        return body;
    }
}
