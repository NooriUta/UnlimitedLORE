package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * {@code perms} паспорта (ADR-LORE-047, допущение A4).
 *
 * <p>{@code can_edit}/{@code can_status}/{@code can_create} — то же правило, что у
 * путей записи сегодня: {@code requireAdmin} (admin или superadmin). Другого правила
 * паспорт не изобретает — иначе кнопка обещала бы то, что запись отклонит.
 *
 * <p>{@code status_next} — жизненный цикл типа (shared/lore-statuses.json) без
 * текущего статуса; у спринта с открытыми задачами без закрывающих переходов
 * (D-2026-LORE-SPRINT-CLOSE-NEEDS-TASKS-CLOSED), и тогда {@code reason} —
 * «открыто N задач».
 *
 * <p>{@code reason} обязан различать «нет прав» и «не опознан» (SPEC 0.3,
 * «Согласование» п. 4): служебная учётка приложения не заведена в графе ролей,
 * и пустое право без причины неотличимо от неопознанного вызывающего.
 */
final class LoreRecordPerms {

    private LoreRecordPerms() {}

    static final String NO_RIGHTS = "нет прав: правка и смена статуса требуют роли admin или superadmin";
    static final String READ_ONLY_REASON = "только чтение: путей записи у этого типа в паспорте пока нет";
    static final String NOT_IDENTIFIED =
        "не опознан: запрос без проверенной учётки и без роли — права вычислить не из чего";

    /** Жизненный цикл статусов типа: план — для спринта и задачи, свой — для ADR и спеки. */
    static List<String> lifecycle(String type, List<String> specStatuses) {
        return switch (type) {
            case "sprint", "task" -> List.of("todo", "planned", "backlog", "design", "active", "partial",
                "blocked", "ready_for_deploy", "uat", "done", "cancelled");
            case "adr" -> List.of("draft", "proposed", "accepted", "deferred", "superseded");
            case "spec" -> specStatuses != null && !specStatuses.isEmpty()
                ? specStatuses : LoreSpecResource.SPEC_STATUSES_FALLBACK;
            default -> List.of();
        };
    }

    static Map<String, Object> of(String type, String role, boolean identified, String currentStatus, int openTasks) {
        return of(type, role, identified, currentStatus, openTasks, null);
    }

    /**
     * @param identified вызывающий опознан (есть проверенная учётка или роль)
     * @param openTasks  открытых задач у спринта (для прочих типов — 0)
     */
    static Map<String, Object> of(String type, String role, boolean identified, String currentStatus,
                                  int openTasks, List<String> specStatuses) {
        if (LoreRecordRegistry.READ_ONLY.contains(type)) {
            // Kit 09.11: путей записи у типа в фасаде нет — ничего не обещаем, причину называем.
            Map<String, Object> ro = new LinkedHashMap<>();
            ro.put("can_edit", false);
            ro.put("can_status", false);
            ro.put("can_create", false);
            ro.put("status_next", List.of());
            ro.put("reason", READ_ONLY_REASON);
            return ro;
        }
        boolean can = "admin".equals(role) || "superadmin".equals(role);
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("can_edit", can);
        p.put("can_status", can);
        p.put("can_create", can);
        List<String> next = new ArrayList<>();
        String reason = null;
        if (!can) {
            reason = identified ? NO_RIGHTS : NOT_IDENTIFIED;
        } else {
            boolean blockClose = "sprint".equals(type) && openTasks > 0;
            for (String s : lifecycle(type, specStatuses)) {
                if (s.equals(currentStatus)) continue;
                if (blockClose && SprintCloseGuard.closing(s)) continue;
                next.add(s);
            }
            if (blockClose) reason = "открыто " + openTasks + " задач";
        }
        p.put("status_next", next);
        p.put("reason", reason);
        return p;
    }
}
