package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPEC-QG-JOB-CONTRACT §7: рутина выключена до явного enabled=true; каденция —
 * ISO-8601 интервал, неразобранное значение даёт каденцию рутины, а не ноль.
 */
class QgSchedulerConfigTest {

    private static Function<String, Optional<String>> cfg(Map<String, String> m) {
        return k -> Optional.ofNullable(m.get(k));
    }

    @Test
    void routineIsOffUntilExplicitlyEnabled() {
        assertFalse(QgScheduler.enabled("qg-x", cfg(Map.of())));
        assertFalse(QgScheduler.enabled("qg-x", cfg(Map.of("lore.qg.routines.qg-x.enabled", "yes"))));
        assertTrue(QgScheduler.enabled("qg-x", cfg(Map.of("lore.qg.routines.qg-x.enabled", " TRUE "))));
    }

    @Test
    void intervalOverridesCadenceAndGarbageFallsBack() {
        Duration day = Duration.ofDays(1);
        assertEquals(day, QgScheduler.every("qg-x", day, cfg(Map.of())));
        assertEquals(Duration.ofHours(6),
            QgScheduler.every("qg-x", day, cfg(Map.of("lore.qg.routines.qg-x.every", "PT6H"))));
        assertEquals(day, QgScheduler.every("qg-x", day, cfg(Map.of("lore.qg.routines.qg-x.every", "каждый день"))));
        assertEquals(day, QgScheduler.every("qg-x", day, cfg(Map.of("lore.qg.routines.qg-x.every", "PT10S"))),
            "меньше минуты — не интервал рутины, а опечатка");
    }

    @Test
    void supervisorReportsAbortedCountAsWarnOnlyWhenNonZero() {
        QgSupervisorRoutine s = new QgSupervisorRoutine();
        assertEquals("PASS", s.normalize(java.util.List.of(new QgRoutine.RawFact("aborted_runs", 0, "t"))).get(0).status());
        assertEquals("WARN", s.normalize(java.util.List.of(new QgRoutine.RawFact("aborted_runs", 2, "t"))).get(0).status());
    }
}
