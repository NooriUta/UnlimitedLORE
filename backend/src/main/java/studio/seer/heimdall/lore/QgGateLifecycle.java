package studio.seer.heimdall.lore;

import java.util.List;

/**
 * Жизненный цикл гейта качества — ADR-LORE-053-D7 (SPRINT_QG_REBUILD/QG-09), [[spec:SPEC-QG-ARCHITECTURE]] §10, §12.
 *
 * <p>draft → active → stale ↔ active → retired. Код состояния — строчной латиницей из словаря
 * {@code qg_status}. {@code status = null} не существует: новый гейт без статуса — {@code draft}.
 * {@code active} требует проекта-владельца (ребро BELONGS_TO_PROJECT): гейт без владельца не может
 * работать, некому отдать stale. {@code retired} требует причины.
 */
final class QgGateLifecycle {

    static final List<String> STATUSES = List.of("draft", "active", "stale", "retired");

    private QgGateLifecycle() {}

    /** Ошибка словами или null. status == null — правка без смены состояния, правила не применяются. */
    static String check(String status, boolean hasOwnerProject, String retiredReason) {
        if (status == null) return null;
        if (!STATUSES.contains(status))
            return "status: один из " + STATUSES + " (строчной латиницей, словарь qg_status; ADR-LORE-053-D7), пришло «" + status + "»";
        if ("active".equals(status) && !hasOwnerProject)
            return "active требует проекта-владельца: передайте project (slug KnowGitProject) — гейт без владельца "
                + "остаётся draft (ADR-LORE-053-D7)";
        if ("retired".equals(status) && (retiredReason == null || retiredReason.isBlank()))
            return "retired требует причины: передайте retired_reason (ADR-LORE-053-D7)";
        return null;
    }

    /** Статус нового гейта: не передан — draft. */
    static String initialStatus(String status) {
        return status == null ? "draft" : status;
    }
}
