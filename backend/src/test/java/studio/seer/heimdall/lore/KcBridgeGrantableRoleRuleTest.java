package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Какие realm-роли мост выдаёт из админки. Регресс 04.11.2026 (владелец: «в
 * админке есть роли по проектам, а есть полные роли, и через админку они не
 * выдаются»): мост держал список {@code admin|viewer} и отказывал любой другой
 * роли realm'а, а карточка человека их и не показывала.
 *
 * <p>Правило — от противного: выдаётся любая роль realm'а, кроме super-admin
 * (D11, эскалация только в консоли KC) и служебных ролей самого Keycloak.
 * Существует ли роль, проверяет уже сам вызов (404 от KC).
 */
class KcBridgeGrantableRoleRuleTest {

    @Test
    void ordinaryRealmRolesAreGrantable() {
        assertTrue(KcBridge.isGrantableRealmRole("admin"));
        assertTrue(KcBridge.isGrantableRealmRole("viewer"));
        assertTrue(KcBridge.isGrantableRealmRole("full"),
            "роль, заведённая в realm руками, обязана выдаваться — ради неё и чинили");
        assertTrue(KcBridge.isGrantableRealmRole("lore-editor"));
    }

    @Test
    void superAdminStaysOutOfBridge() {
        assertFalse(KcBridge.isGrantableRealmRole("super-admin"), "D11: только консоль KC");
    }

    @Test
    void keycloakServiceRolesAreNotGrantable() {
        assertFalse(KcBridge.isGrantableRealmRole("default-roles-omilore"));
        assertFalse(KcBridge.isGrantableRealmRole("offline_access"));
        assertFalse(KcBridge.isGrantableRealmRole("uma_authorization"));
    }

    @Test
    void blankIsNotARole() {
        assertFalse(KcBridge.isGrantableRealmRole(null));
        assertFalse(KcBridge.isGrantableRealmRole(""));
        assertFalse(KcBridge.isGrantableRealmRole("  "));
    }
}
