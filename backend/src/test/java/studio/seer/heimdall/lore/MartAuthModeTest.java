package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_DB_RESILIENCE/DBR-01 + DBR-06 (решение D-DB-ACCESS-SPLIT):
 * рантайм ходит в ArcadeDB своим API-токеном без updateSchema, накатка схемы —
 * отдельным запуском под root.
 *
 * <ul>
 *   <li>режим token без токена — отказ, а не тихий откат на root (общий кред и
 *       есть анти-паттерн: один неверный пароль запирал root всем, прод лёг 31.07);</li>
 *   <li>накатка под токеном невозможна по построению — отказ с понятной причиной;</li>
 *   <li>«только накатить» без самой накатки — опечатка конфигурации, отказ.</li>
 * </ul>
 */
class MartAuthModeTest {

    @Test
    void basicModeKeepsTodaysHeader() {
        assertEquals("Basic cm9vdDpwdw==", MartCredentials.header("basic", "root", "pw", Optional.empty()));
    }

    @Test
    void tokenModeSendsBearerAndNeverTheRootPassword() {
        String h = MartCredentials.header("token", "root", "pw", Optional.of("at-abc"));
        assertEquals("Bearer at-abc", h);
    }

    @Test
    void tokenModeWithoutTokenRefusesInsteadOfFallingBackToRoot() {
        IllegalStateException e = assertThrows(IllegalStateException.class,
            () -> MartCredentials.header("token", "root", "pw", Optional.empty()));
        assertTrue(e.getMessage().contains("ARCADEDB_API_TOKEN"), e.getMessage());
        assertThrows(IllegalStateException.class,
            () -> MartCredentials.header("token", "root", "pw", Optional.of("  ")));
    }

    @Test
    void unknownModeIsAConfigErrorNotBasic() {
        assertThrows(IllegalStateException.class, () -> MartCredentials.header("tokn", "root", "pw", Optional.of("at-x")));
    }

    @Test
    void migrationUnderTokenIsRefusedWithReason() {
        String p = LoreSchemaMigrationRunner.modeProblem(true, false, "token");
        assertTrue(p != null && p.contains("updateSchema"), String.valueOf(p));
    }

    @Test
    void migrateOnlyWithoutMigrateIsRefused() {
        assertTrue(LoreSchemaMigrationRunner.modeProblem(false, true, "basic") != null);
    }

    @Test
    void validCombinationsPass() {
        assertNull(LoreSchemaMigrationRunner.modeProblem(true, true, "basic"));    // шаг накатки в CD
        assertNull(LoreSchemaMigrationRunner.modeProblem(false, false, "token"));  // рантайм
        assertNull(LoreSchemaMigrationRunner.modeProblem(true, false, "basic"));   // как сегодня
        assertNull(LoreSchemaMigrationRunner.modeProblem(false, false, "basic"));
    }
}
