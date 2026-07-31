package studio.seer.heimdall.lore;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

import java.util.Map;
import java.util.Set;

/**
 * AL-68/ADR-LORE-036: резолвер «клиент KC → агент → владелец → роль владельца
 * в проекте → разрешён ли профиль агента здесь» (матрица D4) + сама матрица.
 *
 * <p>Собран как самостоятельный, полностью протестированный сервис — WIRING в
 * реальный запрос (чтение {@code client_id} вызывающего агента из JWT) сюда
 * НЕ входит и сделан отдельным шагом. Причина: клейм с client_id клиента
 * (обычно {@code azp}, но не проверено на живом токене lore-mcp-*) нигде в
 * кодовой базе ещё не читается, и ошибка в имени клейма тихо превратит
 * проверку в always-deny — тот самый обрыв работающих агентов, от которого
 * предостерегает note AL-66. Резолвер сам по себе безопасен: не встроен —
 * не может ничего сломать, а протестирован полностью на графовых фикстурах.
 *
 * <p><b>Инвариант «профиль вне набора роли = запрет, не сужение»</b> (ADR-036):
 * неизвестная роль, отсутствие роли (проект не виден) и профиль вне набора
 * роли — все три ветки возвращают {@code false}, ни одна не пропускает по
 * умолчанию.
 */
@ApplicationScoped
public class ProjectRbacService {

    @Inject
    LoreIngestService ingestService;

    /**
     * Матрица «роль человека в проекте × профиль агента» (ADR-LORE-036-D4).
     * Спорные клетки (`✅?`) решены в пользу «да» — see [[ADR-LORE-036-D4]]
     * / [[OQ-RBAC-MATRIX-CELLS]], закрыт решением, привязанным к D4.
     * Коды ролей — те, что предложены владельцу для словаря project_role
     * в задаче AL-81 (owner/architect/pm/developer/business-analyst/
     * marketer/tester/reader); коды профилей — те же, что в
     * {@code AgentScopeFilter.FAMILY_AGENTS}.
     */
    static final Map<String, Set<String>> ROLE_AGENT_MATRIX = Map.of(
        "owner",             Set.of("full", "architect", "pm", "developer",
                                     "product-analyst", "analyst", "marketer", "tester"),
        "architect",         Set.of("architect", "developer", "tester"),
        "pm",                Set.of("pm", "product-analyst", "analyst", "tester"),
        "developer",         Set.of("developer", "tester"),
        "business-analyst",  Set.of("product-analyst", "analyst"),
        "marketer",          Set.of("marketer"),
        "tester",            Set.of("tester")
        // "reader" сознательно отсутствует строкой: пустой набор и есть
        // допустимое значение по умолчанию для роли без явной записи ниже.
    );

    /** Чистая функция, без похода в граф — отдельно юнит-тестируема. */
    static boolean delegationAllowed(String projectRole, String agentScope) {
        if (projectRole == null || agentScope == null) return false;
        Set<String> allowed = ROLE_AGENT_MATRIX.get(projectRole);
        return allowed != null && allowed.contains(agentScope);
    }

    /**
     * client_id клиента KC → kc_sub владельца, либо {@code null}, если клиент
     * не связан ни с одним актором-агентом в графе ([[AL-83]]: агент без
     * владельца — отказ, не пропуск, а не «нет входа в цепочку»).
     */
    String ownerKcSub(String clientId) {
        if (clientId == null || clientId.isBlank()) return null;
        var rows = ingestService.queryPublic(
            "SELECT out('OWNED_BY').kc_sub AS owners FROM KnowActor "
            + "WHERE kind = 'agent' AND client_id = :cid", Map.of("cid", clientId));
        if (rows.isEmpty()) return null;
        Object owners = rows.get(0).get("owners");
        if (!(owners instanceof java.util.List<?> l) || l.isEmpty()) return null;
        return String.valueOf(l.get(0));
    }

    /**
     * Роль владельца (kc_sub) в проекте (slug), либо {@code null} — нет роли,
     * значит по матрице D4 «проект не виден вовсе» ([[AL-82]]).
     */
    String ownerRoleInProject(String kcSub, String project) {
        if (kcSub == null || project == null) return null;
        var rows = ingestService.queryPublic(
            "SELECT role FROM HAS_PROJECT_ROLE WHERE @out.kc_sub = :sub AND @in.slug = :proj",
            Map.of("sub", kcSub, "proj", project));
        if (rows.isEmpty()) return null;
        return String.valueOf(rows.get(0).get("role"));
    }

    /**
     * Композит трёх шагов диаграммы D4: client_id → владелец → роль в
     * проекте → сверка с матрицей. {@code false} на любом обрыве цепочки
     * (осиротевший клиент, владелец без роли в этом проекте, профиль вне
     * набора роли) — сознательно один и тот же вердикт, разные причины
     * различимы через отдельные методы выше при отладке/логировании.
     */
    public boolean agentAllowedInProject(String clientId, String project, String agentScope) {
        String owner = ownerKcSub(clientId);
        if (owner == null) return false;
        String role = ownerRoleInProject(owner, project);
        return delegationAllowed(role, agentScope);
    }
}
