package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Pure-logic coverage of the sprint auto-status derivation rule
 * (LoreStatusResource.rawToToken / deriveSprintTarget) — no live DB, so it
 * runs in CI without touching any ArcadeDB instance.
 */
class LoreSprintAutoStatusTest {

    @Test
    void rawToToken_maps_emoji_prefixes() {
        assertEquals("done",             LoreStatusResource.rawToToken("✅ DONE"));
        assertEquals("active",           LoreStatusResource.rawToToken("🔄 IN PROGRESS"));
        assertEquals("partial",          LoreStatusResource.rawToToken("🟡 PARTIAL"));
        assertEquals("ready_for_deploy", LoreStatusResource.rawToToken("🚀 READY FOR DEPLOY"));
        assertEquals("planned",          LoreStatusResource.rawToToken("📋 PLANNED"));
        assertEquals("todo",             LoreStatusResource.rawToToken("⬜ TODO"));
        assertEquals("blocked",          LoreStatusResource.rawToToken("🔴 BLOCKED"));
        assertEquals("cancelled",        LoreStatusResource.rawToToken("🚫 CANCELLED"));
    }

    @Test
    void rawToToken_keyword_fallback_for_legacy_rows() {
        assertEquals("done",   LoreStatusResource.rawToToken("DONE"));
        assertEquals("active", LoreStatusResource.rawToToken("IN PROGRESS"));
        assertNull(LoreStatusResource.rawToToken(null));
        assertNull(LoreStatusResource.rawToToken("something unrecognised"));
    }

    @Test
    void planned_with_progress_promotes_to_active() {
        assertEquals("active",
            LoreStatusResource.deriveSprintTarget("planned", List.of("done", "active", "planned")));
        assertEquals("active",
            LoreStatusResource.deriveSprintTarget("todo", List.of("partial", "planned")));
        assertEquals("active",
            LoreStatusResource.deriveSprintTarget("backlog", List.of("ready_for_deploy", "todo")));
    }

    @Test
    void all_tasks_done_promotes_to_done() {
        assertEquals("done",
            LoreStatusResource.deriveSprintTarget("planned", List.of("done", "done", "done")));
        // even from active
        assertEquals("done",
            LoreStatusResource.deriveSprintTarget("active", List.of("done")));
    }

    @Test
    void guarded_states_are_never_overridden() {
        assertNull(LoreStatusResource.deriveSprintTarget("blocked",   List.of("done", "done")));
        assertNull(LoreStatusResource.deriveSprintTarget("cancelled", List.of("done")));
        assertNull(LoreStatusResource.deriveSprintTarget("deferred",  List.of("active")));
        // RFD is an intentional hold: all-done must NOT flip it to done
        assertNull(LoreStatusResource.deriveSprintTarget("ready_for_deploy", List.of("done", "done")));
    }

    @Test
    void no_change_when_nothing_started_or_already_correct() {
        // no progress yet → stays planned
        assertNull(LoreStatusResource.deriveSprintTarget("planned", List.of("planned", "todo")));
        // empty sprint → nothing to derive
        assertNull(LoreStatusResource.deriveSprintTarget("planned", List.of()));
        // already active, not all done → no-op
        assertNull(LoreStatusResource.deriveSprintTarget("active", List.of("active", "planned")));
        // already done → no-op
        assertNull(LoreStatusResource.deriveSprintTarget("done", List.of("done", "done")));
    }
}
