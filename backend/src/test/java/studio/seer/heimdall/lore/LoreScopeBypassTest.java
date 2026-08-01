package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * AL-94 fix: агент не обходит проектный read-скоуп ни при какой realm-роли.
 *
 * <p>Дефект первой редакции: проверка роли стояла первой, а write-путь требует
 * {@code admin} — значит с этой ролью приходят и узкие профили агентов, и
 * ветка «скоуп агента от владельца» была недостижима. Агент с профилем pm мог
 * читать слайсы всего корпуса, минуя проекты своего владельца.
 *
 * <p>Тесты держат именно ПОРЯДОК проверок, а не отдельные ветки: сломать это
 * можно только вернув проверку роли выше опознания агента.
 */
class LoreScopeBypassTest {

    @Test
    void agentWithAdminRoleDoesNotBypassScope() {
        // Ровно тот случай, который был дырой: агент приходит с admin, потому
        // что этого требует write-путь.
        assertFalse(AidaLoreResource.bypassesScope("admin", "agent-pm-client"));
    }

    @Test
    void agentWithSuperadminRoleDoesNotBypassScope() {
        // Даже superadmin в заголовке не делает агента шире его владельца:
        // делегирование ограничено D4, роль в токене этого не отменяет.
        assertFalse(AidaLoreResource.bypassesScope("superadmin", "agent-full-client"));
    }

    @Test
    void agentWithoutRoleDoesNotBypassScope() {
        assertFalse(AidaLoreResource.bypassesScope(null, "some-client"));
    }

    @Test
    void humanAdminBypassesScope() {
        // Пока admin администрирует весь корпус — сужение до проектных ролей
        // отдельное решение владельца. Если оно будет принято, этот кейс
        // меняется осознанно, а не тихо.
        assertTrue(AidaLoreResource.bypassesScope("admin", null));
    }

    @Test
    void humanSuperadminBypassesScope() {
        assertTrue(AidaLoreResource.bypassesScope("superadmin", null));
    }

    @Test
    void humanViewerDoesNotBypassScope() {
        assertFalse(AidaLoreResource.bypassesScope("viewer", null));
    }

    @Test
    void unknownRoleDoesNotBypassScope() {
        // Fail-closed: незнакомая роль сужается до своих проектов, а не
        // получает всё. Опечатка в роли не должна открывать корпус.
        assertFalse(AidaLoreResource.bypassesScope("Admin", null));
        assertFalse(AidaLoreResource.bypassesScope("", null));
        assertFalse(AidaLoreResource.bypassesScope(null, null));
    }
}
