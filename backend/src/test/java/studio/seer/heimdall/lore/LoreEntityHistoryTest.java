package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-03: общий запрос истории SCD2 по карте
 * {@link LoreSlices#HIST_PARENT} и атрибуция правки «человек / агент».
 */
class LoreEntityHistoryTest {

    /** Каждая цепочка карты обязана иметь запрос — иначе «История» у типа молча пуста. */
    @Test
    void everyHistChainHasAQueryKeyedByItsParentId() {
        for (Map.Entry<String, LoreSlices.HistParent> e : LoreSlices.HIST_PARENT.entrySet()) {
            String type = e.getValue().entityType();
            String sql = LoreEntityHistory.sql(type);
            assertTrue(sql.contains("FROM " + e.getKey() + " "), type + ": " + sql);
            assertTrue(sql.contains(e.getValue().idField()), type + ": " + sql);
            assertTrue(sql.contains(":id"), type + ": id обязан идти параметром, не склейкой");
            assertTrue(sql.contains("ORDER BY valid_from"), type + ": цепочка по времени");
        }
        assertEquals(LoreSlices.HIST_PARENT.size(), LoreEntityHistory.types().size());
    }

    @Test
    void unknownTypeIsRejectedNotAnsweredEmpty() {
        assertThrows(IllegalArgumentException.class, () -> LoreEntityHistory.sql("nope"));
        assertThrows(IllegalArgumentException.class, () -> LoreEntityHistory.sql(null));
    }

    @Test
    void taskProjectGoesThroughItsSprintAndDecisionAlsoThroughItsAdr() {
        assertTrue(LoreEntityHistory.sql("task").contains("out('PART_OF').out('BELONGS_TO_PROJECT')"));
        assertTrue(LoreEntityHistory.sql("decision").contains("out('DECIDED_IN').out('BELONGS_TO_PROJECT')"));
        assertTrue(LoreEntityHistory.isGlobal("dict_entry"));
        assertFalse(LoreEntityHistory.isGlobal("spec"));
    }

    private static Map<String, Object> row(String validFrom, String sourceCommit) {
        Map<String, Object> r = new HashMap<>();
        r.put("valid_from", validFrom);
        r.put("source_commit", sourceCommit);
        return r;
    }

    private static Map<String, Object> point(Object ts, String source, String axis, double status) {
        return Map.of("ts", ts, "source", source, "segment", axis, "value", status);
    }

    @Test
    void journalPointNextToTheRevisionNamesTheAuthorAndAxis() {
        // DATETIME в форме рендера ArcadeDB, точка журнала — epoch millis чуть позже.
        long at = java.time.Instant.parse("2026-11-07T10:00:00.000Z").toEpochMilli();
        List<Map<String, Object>> out = LoreEntityHistory.attribute(
            List.of(row("2026-11-07 10:00:00.000", null), row("2026-11-07 12:00:00", null)),
            List.of(point(at + 40, "claude-fleet", "agent", 200),
                    point(at + 7_200_000L + 15, "omiloreadmin", "human", 200)));
        @SuppressWarnings("unchecked")
        Map<String, Object> a0 = (Map<String, Object>) out.get(0).get("author");
        @SuppressWarnings("unchecked")
        Map<String, Object> a1 = (Map<String, Object>) out.get(1).get("author");
        assertEquals("agent", a0.get("kind"));
        assertEquals("claude-fleet", a0.get("caller"));
        assertEquals("journal", a0.get("source"));
        assertEquals("human", a1.get("kind"));
        assertEquals("omiloreadmin", a1.get("caller"));
    }

    @Test
    void failedCallsAndFarPointsDoNotAttribute() {
        long at = java.time.Instant.parse("2026-11-07T10:00:00Z").toEpochMilli();
        List<Map<String, Object>> out = LoreEntityHistory.attribute(
            List.of(row("2026-11-07T10:00:00Z", null)),
            List.of(point(at + 10, "x", "agent", 409),                 // упавший вызов правку не делал
                    point(at + 10 * 60_000L, "y", "human", 200)));     // десять минут спустя — чужая правка
        @SuppressWarnings("unchecked")
        Map<String, Object> a = (Map<String, Object>) out.get(0).get("author");
        assertEquals("unknown", a.get("kind"));
        assertNull(a.get("caller"));
        assertTrue(String.valueOf(a.get("reason")).length() > 10, "«не знаем» объясняется, а не молчит");
    }

    @Test
    void gitIngestWithoutJournalIsIngestNotUnknown() {
        List<Map<String, Object>> out = LoreEntityHistory.attribute(
            List.of(row("2026-06-01 00:00:00", "abc1234")), List.of());
        @SuppressWarnings("unchecked")
        Map<String, Object> a = (Map<String, Object>) out.get(0).get("author");
        assertEquals("ingest", a.get("kind"));
        assertEquals("abc1234", a.get("commit"));
    }

    @Test
    void unauthenticatedCallerStaysUnauthNotHuman() {
        long at = java.time.Instant.parse("2026-11-07T10:00:00Z").toEpochMilli();
        List<Map<String, Object>> out = LoreEntityHistory.attribute(
            List.of(row("2026-11-07T10:00:00Z", null)),
            List.of(point(String.valueOf(at + 5), "anon", "unauth", 200)));
        @SuppressWarnings("unchecked")
        Map<String, Object> a = (Map<String, Object>) out.get(0).get("author");
        assertEquals("unauth", a.get("kind"));
    }

    @Test
    void scopeKeepsRowsWithAnAllowedProjectAndGlobalTypesUnscoped() {
        List<Map<String, Object>> rows = List.of(
            new HashMap<>(Map.of("projects", List.of("a"), "projects_via", List.of())),
            new HashMap<>(Map.of("projects", List.of(), "projects_via", List.of("b"))));
        assertEquals(2, LoreEntityHistory.scope("decision", rows, null).size());
        assertEquals(1, LoreEntityHistory.scope("decision", rows, Set.of("b")).size());
        assertEquals(0, LoreEntityHistory.scope("decision", rows, Set.of("c")).size());
        assertEquals(2, LoreEntityHistory.scope("dict_entry", rows, Set.of("c")).size());
    }
}
