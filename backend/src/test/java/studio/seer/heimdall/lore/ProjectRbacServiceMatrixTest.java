package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * AL-68: чистая проверка матрицы D4 (ADR-LORE-036) — без БД и без Quarkus,
 * транскрипция таблицы решения проверяется отдельно от графового резолвера.
 */
class ProjectRbacServiceMatrixTest {

    @Test
    void ownerDelegatesEveryProfileIncludingFull() {
        for (String profile : new String[]{"full", "architect", "pm", "developer",
                "product-analyst", "analyst", "marketer", "tester"}) {
            assertTrue(ProjectRbacService.delegationAllowed("owner", profile),
                "владелец проекта делегирует все профили, включая " + profile);
        }
    }

    @Test
    void architectDelegatesOnlyArchitectDeveloperTester() {
        assertTrue(ProjectRbacService.delegationAllowed("architect", "architect"));
        assertTrue(ProjectRbacService.delegationAllowed("architect", "developer"));
        assertTrue(ProjectRbacService.delegationAllowed("architect", "tester"));
        assertFalse(ProjectRbacService.delegationAllowed("architect", "full"),
            "агент не может быть шире владельца — full не делегируется архитектором");
        assertFalse(ProjectRbacService.delegationAllowed("architect", "pm"));
        assertFalse(ProjectRbacService.delegationAllowed("architect", "marketer"));
    }

    @Test
    void readerDelegatesNothing() {
        for (String profile : new String[]{"full", "architect", "pm", "developer",
                "product-analyst", "analyst", "marketer", "tester"}) {
            assertFalse(ProjectRbacService.delegationAllowed("reader", profile),
                "читатель не делегирует ничего, включая " + profile);
        }
    }

    @Test
    void unknownRoleDeniesByDefault() {
        // Инвариант ADR-036: профиль вне набора роли = запрет, не сужение —
        // распространяется и на роль, которой нет в матрице вовсе.
        assertFalse(ProjectRbacService.delegationAllowed("some-future-role", "full"));
    }

    @Test
    void nullRoleOrScopeDeniesByDefault() {
        assertFalse(ProjectRbacService.delegationAllowed(null, "full"));
        assertFalse(ProjectRbacService.delegationAllowed("owner", null));
    }

    /**
     * SPRINT_LORE_ADMIN_POLISH/AP-03: мастер «Дать человеку агента» выдавал профиль, который роль
     * владельца не делегирует, без слова. Ответ сервера ДО выдачи — по каждому проекту владельца:
     * его роль и делегирует ли она профиль (та же матрица D4, что на записи), а не копия в UI.
     */
    @Test
    void delegationPlanNamesEveryOwnerProjectWithItsVerdict() {
        java.util.List<java.util.Map<String, Object>> roles = java.util.List.of(
            java.util.Map.of("slug", "AIDA/GLADSHEIM", "role", "pm"),
            java.util.Map.of("slug", "AIDA/miniLORE", "role", "owner"),
            java.util.Map.of("slug", "NooriUta/volva", "role", "reader"));
        var plan = ProjectRbacService.delegationPlan(roles, "full");
        org.junit.jupiter.api.Assertions.assertEquals(3, plan.size());
        org.junit.jupiter.api.Assertions.assertEquals(
            java.util.List.of("AIDA/GLADSHEIM", "AIDA/miniLORE", "NooriUta/volva"),
            plan.stream().map(p -> p.get("project")).toList(), "проекты по алфавиту");
        org.junit.jupiter.api.Assertions.assertEquals(false, plan.get(0).get("delegates"));
        org.junit.jupiter.api.Assertions.assertEquals("pm", plan.get(0).get("role"));
        org.junit.jupiter.api.Assertions.assertEquals(true, plan.get(1).get("delegates"));
        org.junit.jupiter.api.Assertions.assertEquals(false, plan.get(2).get("delegates"));
        // pm делегирует pm — там агент пишет
        org.junit.jupiter.api.Assertions.assertEquals(true,
            ProjectRbacService.delegationPlan(roles.subList(0, 1), "pm").get(0).get("delegates"));
        // строка без проекта не превращается в «проект null»
        org.junit.jupiter.api.Assertions.assertTrue(ProjectRbacService.delegationPlan(
            java.util.List.of(java.util.Map.of("role", "owner")), "full").isEmpty());
    }

    @Test
    void businessAnalystDelegatesBothAnalystProfilesNotDeveloper() {
        assertTrue(ProjectRbacService.delegationAllowed("business-analyst", "product-analyst"));
        assertTrue(ProjectRbacService.delegationAllowed("business-analyst", "analyst"));
        assertFalse(ProjectRbacService.delegationAllowed("business-analyst", "developer"));
    }
}
