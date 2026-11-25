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
    static final String NO_RIGHTS_SUPERADMIN = "нет прав: организацию заводит и связывает только superadmin (как проект)";
    static final String READ_ONLY_REASON = "только чтение: путей записи у этого типа в паспорте пока нет";
    /** AP-PROJECT-LINK-UI: тип только-для-чтения, но у него есть правимые поля (связи с путём записи). */
    static final String STATUS_READ_ONLY_REASON = "статус и создание в паспорте не меняются: правятся только поля с путём записи";
    static final String NOT_IDENTIFIED =
        "не опознан: запрос без проверенной учётки и без роли — права вычислить не из чего";

    /** Жизненный цикл статусов типа: план — для спринта и задачи, свой — для ADR и спеки. */
    static List<String> lifecycle(String type, List<String> specStatuses) {
        return switch (type) {
            // PU-29 (приёмка 14.11.2026): статусы ядра WK-05 (waiting, review, failed) — в цикле, иначе модель
            // отдаёт их «вне цикла — перейти нельзя» и меню статуса их не предлагает. Сторож:
            // LoreLifecycleCoversStatusesTest (цикл покрывает всё, что принимает /lore/status).
            case "sprint", "task" -> List.of("todo", "planned", "backlog", "design", "active", "partial",
                "waiting", "blocked", "review", "ready_for_deploy", "uat", "done", "failed", "cancelled");
            case "adr" -> List.of("draft", "proposed", "accepted", "deferred", "superseded");
            case "spec" -> specStatuses != null && !specStatuses.isEmpty()
                ? specStatuses : LoreSpecResource.SPEC_STATUSES_FALLBACK;
            default -> List.of();
        };
    }

    /** У типа есть поле, которое правится: editable и с путём записи в модели. */
    /** Типы, чьи пути записи — под super-admin (создание и связи организации, как у проекта). */
    static final java.util.Set<String> SUPERADMIN_WRITES = java.util.Set.of("organization");

    /**
     * AP-PASSPORT-EDIT, решение владельца 3а (25.11.2026): «только чтение» снимается вместе с «+ Новая», ТИП ЗА ТИПОМ.
     * У типа только-для-чтения создание из паспорта есть, только если он здесь (включён своей волной) И у него есть
     * блок create модели. Волна 1 — продуктовый слой; организация — раньше, под super-admin.
     */
    static final java.util.Set<String> PASSPORT_CREATE = java.util.Set.of("organization", "pain", "gain", "job", "actor", "feature");

    /** Причина у типа, где правка и создание есть, а статус в паспорте не меняется. */
    static final String STATUS_ONLY_READ_ONLY_REASON = "статус в паспорте не меняется: правятся поля с путём записи";

    /** Есть ли у типа связь, которой управляют из паспорта ({@code manageable}) — путь /relation. */
    static boolean hasManageableRelation(String type) {
        LoreRecordRegistry.TypeDef d = LoreRecordRegistry.get(type);
        if (d == null) return false;
        for (LoreRecordRegistry.Relation r : d.relations()) if (r.manageable()) return true;
        return false;
    }

    static boolean hasWritableField(String type) {
        LoreRecordRegistry.TypeDef d = LoreRecordRegistry.get(type);
        if (d == null) return false;
        for (LoreRecordRegistry.Field f : d.fields()) if (f.editable() && f.write() != null) return true;
        return false;
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
            // AP-PROJECT-LINK-UI (16.11.2026): «только чтение» — про статус и создание. Если у типа
            // есть поле с путём записи (проекты решения, вопроса, ранбука через /relation), правка
            // даётся по роли; прочие поля и так editable=false в модели.
            Map<String, Object> ro = new LinkedHashMap<>();
            boolean writable = hasWritableField(type) || hasManageableRelation(type);
            // D-2026-MIG-REPOSITORY-ORGANIZATION: у организации порог — super-admin, как у создания проекта.
            boolean roleOk = SUPERADMIN_WRITES.contains(type) ? "superadmin".equals(role) : ("admin".equals(role) || "superadmin".equals(role));
            boolean can = writable && roleOk;
            ro.put("can_edit", can);
            ro.put("can_status", false);
            // Создание у типа только-чтения — если путь создания объявлен моделью (блок create) и он под super-admin.
            boolean create = PASSPORT_CREATE.contains(type) && roleOk && LoreModelFile.content().create().containsKey(type);
            ro.put("can_create", create);
            ro.put("status_next", List.of());
            ro.put("reason", !writable ? READ_ONLY_REASON : can ? (create ? STATUS_ONLY_READ_ONLY_REASON : STATUS_READ_ONLY_REASON)
                : !identified ? NOT_IDENTIFIED : SUPERADMIN_WRITES.contains(type) ? NO_RIGHTS_SUPERADMIN : NO_RIGHTS);
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
