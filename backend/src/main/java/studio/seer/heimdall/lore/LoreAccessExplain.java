package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-10 — «почему видит / не видит»: цепочка рассуждения
 * по тем же правилам, что действуют в коде, — чистая функция, без графа.
 *
 * <ol>
 *   <li>Проектный read-скоуп включается флагом {@code lore.scope.enforce}
 *       ({@link AidaLoreResource#allowedProjectsOrNull}); выключен — видят все.</li>
 *   <li>Роли realm {@code superadmin} и {@code admin} обходят скоуп
 *       ({@link AidaLoreResource#bypassesScope}) — только для человека.</li>
 *   <li>Иначе проект виден, если у человека в нём ЛЮБАЯ роль
 *       ({@link ProjectRbacService#allowedProjectsForUser}); писать — по роли:
 *       {@code reader} только читает (D4).</li>
 *   <li>Агенты владельца — профили из {@link ProjectRbacService#ROLE_AGENT_MATRIX}.</li>
 * </ol>
 */
final class LoreAccessExplain {

    private LoreAccessExplain() {}

    static final Set<String> BYPASS_REALM_ROLES = Set.of("superadmin", "admin");

    static Map<String, Object> explain(boolean scopeEnforced, String realmRole,
                                       Map<String, String> projectRoles, String project) {
        List<String> chain = new ArrayList<>();
        String role = projectRoles == null ? null : projectRoles.get(project);
        boolean sees;
        boolean canWrite;
        if (!scopeEnforced) {
            chain.add("проектный скоуп выключен (lore.scope.enforce=false) — проект видят все вошедшие");
            sees = true;
        } else if (realmRole != null && BYPASS_REALM_ROLES.contains(realmRole)) {
            chain.add("роль realm «" + realmRole + "» обходит проектный скоуп — видит весь корпус");
            sees = true;
        } else if (role != null) {
            chain.add("роль realm «" + (realmRole == null ? "—" : realmRole) + "» скоуп не обходит");
            chain.add("роль в проекте " + project + " — «" + role + "»: проект виден");
            sees = true;
        } else {
            chain.add("роль realm «" + (realmRole == null ? "—" : realmRole) + "» скоуп не обходит");
            chain.add("в проекте " + project + " роли нет — проект не виден");
            sees = false;
        }
        boolean bypass = realmRole != null && BYPASS_REALM_ROLES.contains(realmRole);
        canWrite = bypass || (role != null && !"reader".equals(role));
        if (sees) chain.add(canWrite
            ? (bypass ? "писать может как администратор LORE" : "писать может: роль «" + role + "» не только для чтения")
            : "писать не может: " + (role == null ? "роли в проекте нет" : "роль «reader» — только чтение"));
        Set<String> profiles = role == null ? Set.of()
            : ProjectRbacService.ROLE_AGENT_MATRIX.getOrDefault(role, Set.of());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("project", project);
        out.put("realm_role", realmRole);
        out.put("project_role", role);
        out.put("scope_enforced", scopeEnforced);
        out.put("sees", sees);
        out.put("can_write", canWrite);
        out.put("agent_profiles", profiles.stream().sorted().toList());
        out.put("chain", chain);
        return out;
    }
}
