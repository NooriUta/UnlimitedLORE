package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * AL-95: строки матрицы D4, которые {@link ProjectRbacServiceMatrixTest} не
 * покрывает, плюс инварианты матрицы целиком.
 *
 * <p>Соседний тест проверяет owner, architect, business-analyst и reader —
 * четыре строки из семи. Остальные три (developer, pm, marketer, tester)
 * существовали только в константе: опечатка в них не поймалась бы ничем.
 * Разделение файлов сохранено, чтобы не переписывать уже работающий тест;
 * дублирующих кейсов (null, неизвестная роль, reader) здесь нет намеренно.
 *
 * <p>Проверяются и положительные, и отрицательные клетки: тест, который
 * смотрит только «кому можно», пропустит расширение прав.
 */
class AgentRoleDelegationTest {

    /** Роли агентов из справочника {@code agent_role} на 2026-08-02. */
    private static final Set<String> DICT_AGENT_ROLES = Set.of(
        "full", "architect", "developer", "tester", "pm", "analyst", "marketer");

    @ParameterizedTest(name = "{0} делегирует {1}")
    @CsvSource({
        "developer, developer", "developer, tester",
        "pm, pm", "pm, product-analyst", "pm, analyst", "pm, tester",
        "marketer, marketer",
        "tester, tester",
    })
    void roleDelegatesProfile(String projectRole, String agentScope) {
        assertTrue(ProjectRbacService.delegationAllowed(projectRole, agentScope),
            projectRole + " обязан делегировать " + agentScope);
    }

    @ParameterizedTest(name = "{0} НЕ делегирует {1}")
    @CsvSource({
        // full не делегирует никто, кроме owner — иначе агент шире владельца
        "developer, full", "pm, full", "marketer, full", "tester, full",
        // роль не выдаёт прав соседней специальности
        "developer, architect", "developer, pm", "developer, analyst", "developer, marketer",
        "pm, developer", "pm, architect", "pm, marketer",
        "marketer, developer", "marketer, tester", "marketer, analyst", "marketer, pm",
        "tester, developer", "tester, architect", "tester, pm", "tester, analyst",
    })
    void roleDoesNotDelegateProfile(String projectRole, String agentScope) {
        assertFalse(ProjectRbacService.delegationAllowed(projectRole, agentScope),
            projectRole + " НЕ должен делегировать " + agentScope);
    }

    // ── Инварианты матрицы целиком ───────────────────────────────────────────

    @Test
    void ownerIsTheOnlyRoleThatDelegatesEverything() {
        Set<String> byOwner = ProjectRbacService.ROLE_AGENT_MATRIX.get("owner");
        for (var e : ProjectRbacService.ROLE_AGENT_MATRIX.entrySet()) {
            if ("owner".equals(e.getKey())) continue;
            assertTrue(byOwner.containsAll(e.getValue()),
                e.getKey() + " делегирует профиль, которого нет у owner — матрица перестала быть вложенной");
            assertFalse(e.getValue().containsAll(byOwner),
                e.getKey() + " делегирует столько же, сколько owner — роль потеряла смысл");
        }
    }

    @Test
    void everyDictionaryRoleIsDelegatableBySomebody() {
        // Роль, которую не делегирует НИКТО, — мёртвая: агента с ней завести
        // можно, а работать он не сможет ни в одном проекте.
        for (String role : DICT_AGENT_ROLES) {
            boolean delegated = ProjectRbacService.ROLE_AGENT_MATRIX.values().stream()
                .anyMatch(set -> set.contains(role));
            assertTrue(delegated, "роль " + role + " не делегирует ни одна роль человека — мёртвая роль");
        }
    }

    @Test
    void matrixKnowsEveryDictionaryRoleAndNamesTheGapExplicitly() {
        Set<String> known = ProjectRbacService.ROLE_AGENT_MATRIX.values().stream()
            .flatMap(Set::stream).collect(Collectors.toSet());
        for (String role : DICT_AGENT_ROLES) {
            assertTrue(known.contains(role),
                "роль " + role + " есть в справочнике, но матрица D4 её не знает");
        }
        // Обратная сторона: профиль, известный матрице и Keycloak, но
        // отсутствующий в справочнике agent_role, — агента с ним завести
        // нельзя. На 2026-08-02 это ровно product-analyst; запись в
        // справочник — действие человека (семейство dict HUMAN_ONLY).
        Set<String> onlyInMatrix = new LinkedHashSet<>(known);
        onlyInMatrix.removeAll(DICT_AGENT_ROLES);
        assertEquals(Set.of("product-analyst"), onlyInMatrix,
            "список расхождений справочника и матрицы изменился — свериться с AL-105");
    }
}
