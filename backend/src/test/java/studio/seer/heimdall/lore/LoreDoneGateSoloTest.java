package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * ADR-LORE-014-D4: исключение из гейта самопринятия для полного носителя.
 *
 * Проверяется ПОРЯДОК разрешения, а не сам факт исключения. Наивная реализация
 * («роль admin → соло разрешено») отменила бы правило целиком: write-эндпоинты
 * и так требуют admin, поэтому с этой ролью приходят и узкие профили агентов.
 * Исключение стало бы всеобщим, а гейт — мёртвым кодом.
 */
class LoreDoneGateSoloTest {

    /** Тестовый носитель: подменяет только то, что читает isFullScopeCaller. */
    private static LoreResourceBase caller(String agentScope) {
        return new LoreResourceBase() {
            @Override
            String callerAgentScope() { return agentScope; }
        };
    }

    @Test
    void fullAgentWorksSolo() {
        assertTrue(caller("full").isFullScopeCaller("admin"));
    }

    /**
     * Ядро теста: узкий агент приходит с ТОЙ ЖЕ ролью admin (иначе его не
     * пустили бы на write-путь вовсе) — и соло ему не разрешено. Если эта
     * проверка падает, исключение стало всеобщим.
     */
    @Test
    void narrowAgentDoesNotWorkSoloEvenWithAdminRole() {
        for (String scope : new String[]{"architect", "developer", "pm", "tester", "analyst", "marketer"}) {
            assertFalse(caller(scope).isFullScopeCaller("admin"),
                "профиль " + scope + " получил соло — исключение стало всеобщим");
            assertFalse(caller(scope).isFullScopeCaller("superadmin"), scope);
        }
    }

    /** Человек (скоупа нет) — решает realm-роль. */
    @Test
    void humanIsDecidedByRealmRole() {
        assertTrue(caller(null).isFullScopeCaller("admin"));
        assertTrue(caller(null).isFullScopeCaller("superadmin"));
        assertFalse(caller(null).isFullScopeCaller("viewer"));
        assertFalse(caller(null).isFullScopeCaller(null));
    }

    /**
     * Скоуп сильнее роли. Даже если узкому агенту когда-нибудь выдадут
     * superadmin, соло он не получит: разделение ролей у него осмысленно —
     * есть кому принимать работу.
     */
    @Test
    void scopeOutranksRole() {
        assertFalse(caller("developer").isFullScopeCaller("superadmin"));
        assertTrue(caller("full").isFullScopeCaller("viewer"));
    }
}
