package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * DBR-18: проба живости мостов. Главное — негатив: настроенный мост с
 * неработающим секретом даёт DOWN с причиной, а не UP.
 */
class LoreBridgeProbeCheckTest {

    @Test
    void workingBridgeIsUp() {
        var p = LoreBridgeProbeCheck.fresh(null, 1000, true, () -> null);
        assertTrue(p.probed());
        assertTrue(p.up());
    }

    /** Отозванный секрет: настроен, проба вернула причину → DOWN. */
    @Test
    void revokedSecretIsDownWithReason() {
        var p = LoreBridgeProbeCheck.fresh(null, 1000, true, () -> "Forgejo ответил 401");
        assertFalse(p.up());
        assertEquals("Forgejo ответил 401", p.error());
    }

    /** Исключение пробы — тоже DOWN, не тихий UP. */
    @Test
    void probeExceptionIsDown() {
        var p = LoreBridgeProbeCheck.fresh(null, 1000, true, () -> { throw new IllegalStateException("kc token 401"); });
        assertFalse(p.up());
        assertTrue(p.error().contains("kc token 401"));
    }

    /** Не настроен — наружу не ходим, UP с probed=false. */
    @Test
    void notConfiguredIsNotProbed() {
        AtomicInteger calls = new AtomicInteger();
        var p = LoreBridgeProbeCheck.fresh(null, 1000, false, () -> { calls.incrementAndGet(); return null; });
        assertFalse(p.probed());
        assertTrue(p.up());
        assertNull(p.error());
        assertEquals(0, calls.get());
    }

    /** В пределах TTL проба не повторяется; после TTL — повторяется. */
    @Test
    void cachedWithinTtl() {
        AtomicInteger calls = new AtomicInteger();
        var first = LoreBridgeProbeCheck.fresh(null, 0, true, () -> { calls.incrementAndGet(); return null; });
        var again = LoreBridgeProbeCheck.fresh(first, 60_000, true, () -> { calls.incrementAndGet(); return "x"; });
        assertEquals(1, calls.get());
        assertTrue(again.up());
        var later = LoreBridgeProbeCheck.fresh(first, LoreBridgeProbeCheck.TTL.toMillis() + 1, true,
            () -> { calls.incrementAndGet(); return "Forgejo ответил 401"; });
        assertEquals(2, calls.get());
        assertFalse(later.up());
    }

    /** Мост настроили после кэша «не настроен» — проба идёт сразу, не ждёт TTL. */
    @Test
    void configurationChangeBypassesCache() {
        var notConfigured = LoreBridgeProbeCheck.fresh(null, 0, false, () -> null);
        var now = LoreBridgeProbeCheck.fresh(notConfigured, 10, true, () -> "kc token 401");
        assertTrue(now.probed());
        assertFalse(now.up());
    }
}
