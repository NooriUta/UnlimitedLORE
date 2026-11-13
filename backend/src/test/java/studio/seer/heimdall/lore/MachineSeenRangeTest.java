package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * SPRINT_UXR_POLISH_UAT_1113/PU-18 — V82 терял даты машины (находка «Стабильности» 13.11):
 * каноническая вершина получала first_seen_at последнего входа, а при её отсутствии — без
 * дат вовсе. Правило: first_seen_at = min, last_seen_at = max по вариантам И канонической.
 * Прод 13.11: LORCETUS 07:46/12:24, LorCetus 09:35/09:35, lorcetus 18:49/18:49.
 */
class MachineSeenRangeTest {

    private static Map<String, Object> m(String id, String first, String last) {
        Map<String, Object> r = new HashMap<>();
        r.put("machine_id", id); r.put("first_seen_at", first); r.put("last_seen_at", last);
        return r;
    }

    @Test
    void canonicalPresent_firstIsEarliestOfAll_lastIsLatestOfAll() {
        String[] r = AgentMachine.seenRange(List.of(
            m("LORCETUS", "2026-11-13T07:46:00Z", "2026-11-13T12:24:00Z"),
            m("LorCetus", "2026-11-13T09:35:00Z", "2026-11-13T09:35:00Z"),
            m("lorcetus", "2026-11-13T18:49:00Z", "2026-11-13T18:49:00Z")));
        assertEquals("2026-11-13T07:46:00Z", r[0]);
        assertEquals("2026-11-13T18:49:00Z", r[1]);
    }

    @Test
    void canonicalAbsent_datesFromVariants_notEmpty() {
        String[] r = AgentMachine.seenRange(List.of(
            m("LORCETUS", "2026-11-13T07:46:00Z", "2026-11-13T12:24:00Z"),
            m("LorCetus", "2026-11-13T09:35:00Z", "2026-11-13T09:35:00Z")));
        assertEquals("2026-11-13T07:46:00Z", r[0]);
        assertEquals("2026-11-13T12:24:00Z", r[1]);
    }

    @Test
    void nullsIgnored_fractionalSecondsComparedAsInstants() {
        String[] r = AgentMachine.seenRange(List.of(
            m("A", null, "2026-11-13T12:24:00.5Z"),
            m("a", "2026-11-13T07:46:00.123456Z", null),
            m("b", "2026-11-13T07:46:00Z", "2026-11-13T12:24:00.25Z")));
        assertEquals("2026-11-13T07:46:00Z", r[0]);
        assertEquals("2026-11-13T12:24:00.5Z", r[1]);
    }

    @Test
    void noDatesAtAll_nullNull_nothingToWrite() {
        String[] r = AgentMachine.seenRange(List.of(m("A", null, null), m("a", "", null)));
        assertNull(r[0]);
        assertNull(r[1]);
    }
}
