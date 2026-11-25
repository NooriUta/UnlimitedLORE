package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_EXT_AUDIT_1190/AUD-SUPERADMIN (issue SeidrStudio/UnlimitedLORE#8).
 *
 * <p>Роль, которой создаётся проект, пишется в LORE одним словом — {@code superadmin}
 * (так её кладёт в X-Seer-Role мост Keycloak и так её ждут проверки). Роль realm'а
 * Keycloak называется {@code super-admin}, и прежний текст отказа подсказывал именно
 * её: человек ставил {@code LORE_SEER_ROLE=super-admin} и снова получал 403.
 * Теперь написание с дефисом — синоним, а отказ называет то значение, которое пропускает.
 */
class SuperAdminRoleNameTest {

    private static final LoreResourceBase RESOURCE = new LoreResourceBase() {};

    @Test
    void hyphenatedSpellingIsASynonym() {
        assertEquals("superadmin", SeerRoleFromTokenFilter.normalizeRole("super-admin"));
        assertEquals("superadmin", SeerRoleFromTokenFilter.normalizeRole(" Super-Admin "));
        assertEquals("superadmin", SeerRoleFromTokenFilter.normalizeRole("super_admin"));
        assertEquals("superadmin", SeerRoleFromTokenFilter.normalizeRole("superadmin"));
        assertEquals("admin", SeerRoleFromTokenFilter.normalizeRole("admin"));
        assertEquals(null, SeerRoleFromTokenFilter.normalizeRole(null));
    }

    @Test
    void superAdminGuardAcceptsBothSpellings() {
        assertDoesNotThrow(() -> RESOURCE.requireSuperAdmin("superadmin"));
        assertDoesNotThrow(() -> RESOURCE.requireSuperAdmin("super-admin"));
        assertDoesNotThrow(() -> RESOURCE.requireAdmin("super-admin"));
    }

    @Test
    void refusalNamesTheValueThatActuallyPasses() {
        LoreExceptions.Forbidden e = assertThrows(LoreExceptions.Forbidden.class,
            () -> RESOURCE.requireSuperAdmin("admin"));
        String msg = e.getMessage();
        assertTrue(msg.contains("LORE_SEER_ROLE=superadmin"), msg);
        assertFalse(msg.contains("super-admin role required"), msg);
    }
}
