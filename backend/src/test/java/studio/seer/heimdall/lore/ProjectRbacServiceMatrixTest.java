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

    @Test
    void businessAnalystDelegatesBothAnalystProfilesNotDeveloper() {
        assertTrue(ProjectRbacService.delegationAllowed("business-analyst", "product-analyst"));
        assertTrue(ProjectRbacService.delegationAllowed("business-analyst", "analyst"));
        assertFalse(ProjectRbacService.delegationAllowed("business-analyst", "developer"));
    }
}
