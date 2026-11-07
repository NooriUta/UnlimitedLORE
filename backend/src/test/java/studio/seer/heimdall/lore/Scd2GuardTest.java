package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** SPRINT_UXR_S2_GRAPH_MEMORY/S2-09 — чистая логика оптимистической блокировки SCD2. */
class Scd2GuardTest {

    @Test
    void guardedCloseRequiresStillOpenRowAndExitsBeforeAnyWrite() {
        String s = Scd2Guard.guardedClose("KnowSprintHist", false);
        assertTrue(s.contains("WHERE @rid = :oldrid AND valid_to IS NULL"), s);
        assertFalse(s.contains("status_raw"), "без expected статус не сверяется: " + s);
        assertTrue(s.contains("IF ($closed.size() = 0) { RETURN \"" + Scd2Guard.CONFLICT_MARK + "\"; }"), s);
        assertTrue(Scd2Guard.guardedClose("KnowTaskHist", true).contains("AND status_raw = :expected_raw"));
    }

    @Test
    void conflictMarkIsRecognisedOnlyAsTheScriptResult() {
        assertTrue(Scd2Guard.isConflict(List.of(Map.of("value", Scd2Guard.CONFLICT_MARK))));
        assertFalse(Scd2Guard.isConflict(List.of(Map.of("@rid", "#1:2"))));
        assertFalse(Scd2Guard.isConflict(List.of()));
        assertFalse(Scd2Guard.isConflict(null));
    }

    @Test
    void expectedStatusAcceptsTokenOrRaw() {
        assertTrue(Scd2Guard.statusMatches(null, "🔄 IN PROGRESS"), "без expected — всегда да");
        assertTrue(Scd2Guard.statusMatches("active", "🔄 IN PROGRESS"));
        assertTrue(Scd2Guard.statusMatches("🔄 IN PROGRESS", "🔄 IN PROGRESS"));
        assertFalse(Scd2Guard.statusMatches("planned", "🔄 IN PROGRESS"));
        assertFalse(Scd2Guard.statusMatches("planned", null), "«было» названо, а открытой версии нет");
    }

    @Test
    void firstMismatchComparesNumbersByValueAndStatusByToken() {
        Map<String, Object> cur = Map.of("priority", "high", "effort_days", 1, "status_raw", "✅ DONE");
        assertNull(Scd2Guard.firstMismatch(Map.of("priority", "high", "effort_days", 1.0, "status", "done"), cur));
        assertEquals("priority", Scd2Guard.firstMismatch(Map.of("priority", "low"), cur));
        assertEquals("status", Scd2Guard.firstMismatch(Map.of("status", "active"), cur));
        assertNull(Scd2Guard.firstMismatch(null, cur));
    }

    @Test
    void conflictBodyIsAdditiveToLoreErrorAndCarriesCurrent() {
        var r = Scd2Guard.conflict("d", Map.of("rid", "#1:1", "status_raw", "🔄 IN PROGRESS"));
        assertEquals(409, r.getStatus());
        @SuppressWarnings("unchecked") Map<String, Object> b = (Map<String, Object>) r.getEntity();
        assertEquals("CONFLICT", b.get("error"));
        assertEquals("d", b.get("detail"));
        @SuppressWarnings("unchecked") Map<String, Object> cur = (Map<String, Object>) b.get("current");
        assertEquals("active", cur.get("status"));
        assertFalse(cur.containsKey("rid"), "внутренний rid наружу не отдаётся");
    }
}
