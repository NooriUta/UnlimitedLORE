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
            return "active требует владельца: передайте проект (project, slug KnowGitProject) или scope=global для общего "
                + "гейта — гейт без владельца остаётся draft (ADR-LORE-053-D7, QG-01)";
        if ("retired".equals(status) && (retiredReason == null || retiredReason.isBlank()))
            return "retired требует причины: передайте retired_reason (ADR-LORE-053-D7)";
        return null;
    }

    /**
     * Тип гейта — код словаря {@code qg_type} (SPRINT_QG_REBUILD/QG-04, ADR-LORE-053-D3; слово владелицы
     * 16.11.2026 «добавь поле тип … пока без цвета и иконки»). Слой «универсальный / проектный» — вид статьи
     * словаря (kind), у гейта не дублируется. Ошибка словами или null; type == null — поле не трогаем.
     */
    static String checkType(String type, java.util.Collection<String> activeCodes) {
        if (type == null) return null;
        if (!activeCodes.contains(type))
            return "qg_type: один из " + new java.util.TreeSet<>(activeCodes) + " (словарь qg_type, строчной латиницей), пришло «" + type + "»";
        return null;
    }

    /**
     * Признак scope гейта — SPRINT_QG_REBUILD/QG-01, решение владелицы 19.11.2026 «2а»
     * (D-2026-MIG-118-OWNER-ANSWERS-1119). {@code global} — общий гейт: без проекта, виден всем и
     * проверяет все проекты; {@code project} — привязан ровно к одному проекту.
     */
    static final List<String> SCOPES = List.of("global", "project");

    /**
     * Ошибка словами или null. {@code projectGiven} — в запросе пришёл project; {@code ownerProjects} —
     * сколько проектов будет у гейта после записи (существующие рёбра плюс присланный). scope == null —
     * поле не трогаем.
     */
    static String checkScope(String scope, boolean projectGiven, int ownerProjects) {
        if (scope == null) return null;
        if (!SCOPES.contains(scope))
            return "scope: один из " + SCOPES + " (строчной латиницей; QG-01), пришло «" + scope + "»";
        if ("global".equals(scope) && projectGiven)
            return "scope=global — общий гейт без проекта: не передавайте project (связи с проектами снимаются)";
        if ("project".equals(scope) && ownerProjects != 1)
            return "scope=project требует ровно одного проекта-владельца, у гейта их " + ownerProjects
                + " — передайте project (slug KnowGitProject)";
        return null;
    }

    /** Есть ли у гейта законный владелец: общий гейт владеет собой сам, иначе нужен проект. */
    static boolean hasOwner(String scope, int ownerProjects) {
        return "global".equals(scope) || ownerProjects > 0;
    }

    /** Статус нового гейта: не передан — draft. */
    static String initialStatus(String status) {
        return CreateDefaultStatus.forNew("quality_gate", status); // первый статус справочника qg_status (16.11.2026)
    }
}
