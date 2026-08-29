package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Отказ проектного гейта обязан РАЗЛИЧАТЬ причины (найдено владельцем 30.08.2026).
 *
 * Прежнее сообщение сливало три случая в одну строку: «роль владельца там не
 * делегирует этот профиль (или клиент/владелец/роль не сопоставлены в графе)».
 * На практике это увело в сторону: отказ на AIDA/MIDGARD выглядел как нехватка
 * прав у профиля `full`, тогда как роли в проекте не существовало вовсе, и
 * никакая правка профиля не помогла бы.
 *
 * Тот же инвариант, что И-6 в SPEC-QG-ARCHITECTURE: «не найдено» и «не
 * выполнилось» обязаны различаться снаружи. Здесь — «роли нет» против «роль
 * слабая»: состояния разные, чинятся по-разному, читались одинаково.
 */
class ProjectDenialMessageTest {

    private static final String CLIENT = "lore-mcp-full";
    private static final String OWNER = "52f6fad5-3fe6-42b2-8393-f5e667ac8c8f";
    private static final String PROJECT = "AIDA/MIDGARD";

    /** Случай владельца: роли в проекте нет. Сообщение обязано вести к выдаче роли. */
    @Test
    void missingRoleSaysSoAndPointsAtTheFix() {
        String m = LoreProductResource.denialMessage(CLIENT, OWNER, null, PROJECT, "full");
        assertTrue(m.contains("НЕТ роли"), m);
        assertTrue(m.contains("Люди"), "должно вести в админку, где роль выдаётся: " + m);
        assertTrue(m.contains("projects_without_role"), "должно называть срез для поиска остальных дыр: " + m);
        // Главное: НЕ должно обвинять профиль — именно это увело в сторону.
        assertTrue(m.contains("Права профиля тут ни при чём"), m);
    }

    /** Роль есть, но слабая — здесь как раз про профиль, и роль названа явно. */
    @Test
    void weakRoleNamesBothTheRoleAndTheScope() {
        String m = LoreProductResource.denialMessage(CLIENT, OWNER, "reader", PROJECT, "full");
        assertTrue(m.contains("'reader'"), m);
        assertTrue(m.contains("'full'"), m);
        assertTrue(m.contains("не делегирует"), m);
    }

    /** Агент без владельца — третья, ещё раз другая починка. */
    @Test
    void ownerlessAgentIsItsOwnCase() {
        String m = LoreProductResource.denialMessage(CLIENT, null, null, PROJECT, "full");
        assertTrue(m.contains("OWNED_BY"), m);
        assertTrue(m.contains(CLIENT), m);
    }

    @Test
    void unidentifiedCallerIsItsOwnCase() {
        String m = LoreProductResource.denialMessage(null, null, null, PROJECT, "full");
        assertTrue(m.contains("client_id"), m);
    }

    /**
     * ПОЛОЖИТЕЛЬНЫЙ КОНТРОЛЬ различимости. Четыре проверки выше прошли бы и на
     * реализации, которая клеит все подсказки в одну строку и отдаёт её всегда.
     * Здесь требуется именно РАЗНОЕ: если два случая снова совпадут дословно,
     * дефект вернулся, а тесты выше об этом промолчат.
     */
    @Test
    void thefourCasesAreActuallyDistinct() {
        String noClient = LoreProductResource.denialMessage(null, null, null, PROJECT, "full");
        String noOwner  = LoreProductResource.denialMessage(CLIENT, null, null, PROJECT, "full");
        String noRole   = LoreProductResource.denialMessage(CLIENT, OWNER, null, PROJECT, "full");
        String weak     = LoreProductResource.denialMessage(CLIENT, OWNER, "reader", PROJECT, "full");
        assertNotEquals(noClient, noOwner);
        assertNotEquals(noOwner, noRole);
        assertNotEquals(noRole, weak);
        assertNotEquals(noClient, weak);
    }
}
