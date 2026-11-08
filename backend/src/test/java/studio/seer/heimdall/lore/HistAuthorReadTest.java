package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-12 — читатели автора версии: история (S2-03) и индекс
 * для ленты новостей v2 ({@link HistAuthorIndex}). Без базы.
 */
class HistAuthorReadTest {

    private static Map<String, Object> row(String vf, String by, String kind) {
        Map<String, Object> r = new HashMap<>();
        r.put("valid_from", vf);
        r.put("changed_by", by);
        r.put("changed_by_kind", kind);
        return r;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> author(Map<String, Object> r, List<Map<String, Object>> journal) {
        return (Map<String, Object>) LoreEntityHistory.attribute(List.of(r), journal).get(0).get("author");
    }

    // ── история: автор из строки — факт, журнал не нужен ──────────────────────

    @Test
    void historyTakesTheAuthorFromTheRow() {
        Map<String, Object> a = author(row("2026-11-07T10:00:00Z", "lore-mcp-full", "agent"), List.of());
        assertEquals("agent", a.get("kind"));
        assertEquals("lore-mcp-full", a.get("caller"));
        assertEquals("lore-mcp-full", a.get("client_id"));
        assertEquals("hist", a.get("source"));

        Map<String, Object> h = author(row("2026-11-07T10:00:00Z", "kc-sub-1", "human"), List.of());
        assertEquals("human", h.get("kind"));
        assertEquals("kc-sub-1", h.get("kc_sub"));
    }

    @Test
    void rowAuthorBeatsAContradictingJournalPoint() {
        Map<String, Object> journalPoint = Map.of("ts", "2026-11-07T10:00:01Z", "source", "someone-else",
            "segment", "human", "value", 200);
        Map<String, Object> a = author(row("2026-11-07T10:00:00Z", "lore-mcp-full", "agent"), List.of(journalPoint));
        assertEquals("agent", a.get("kind"), "строка истории — факт из токена, журнал — догадка по времени");
        assertEquals("hist", a.get("source"));
    }

    @Test
    void rowWithoutAuthorKeepsTheOldHonestPath() {
        // Положительный контроль: старая версия без автора — «неизвестно», не «человек».
        Map<String, Object> a = author(row("2026-11-01T10:00:00Z", null, null), List.of());
        assertEquals("unknown", a.get("kind"));
        assertEquals("none", a.get("source"));
        // Записанное «неизвестно» (без токена) тоже не превращается в человека.
        Map<String, Object> u = author(row("2026-11-07T10:00:00Z", null, "unknown"), List.of());
        assertEquals("unknown", u.get("kind"));
    }

    // ── индекс для новостей ─────────────────────────────────────────────────

    private static Map<String, Object> idxRow(String id, String vf, String by, String kind) {
        Map<String, Object> r = row(vf, by, kind);
        r.put("ref_id", id);
        return r;
    }

    private static HistAuthorIndex index() {
        return HistAuthorIndex.of(Map.of(
            "task", List.of(
                idxRow("S/T1", "2026-11-07T10:00:00.000Z", "kc-sub-1", "human"),
                idxRow("S/T1", "2026-11-07T11:00:00Z", "lore-mcp-full", "agent"),
                idxRow("S/T1", "2026-11-07T12:00:00Z", null, "unknown")),
            "adr", List.of(idxRow("ADR-1", "2026-11-07T09:00:00Z", "kc-sub-1", "human"))), List.of());
    }

    @Test
    void indexFindsTheAuthorOfTheVersionOpenedAtThatMoment() {
        HistAuthorIndex idx = index();
        HistAuthorIndex.Who h = idx.authorOf("task", "S/T1", Instant.parse("2026-11-07T10:00:00Z"));
        assertEquals("kc-sub-1", h.by());
        assertEquals(Boolean.FALSE, h.agent());
        HistAuthorIndex.Who a = idx.authorOf("task", "S/T1", Instant.parse("2026-11-07T11:00:00.400Z"));
        assertEquals("lore-mcp-full", a.by());
        assertEquals(Boolean.TRUE, a.agent());
        assertEquals("kc-sub-1", idx.authorOf("adr", "ADR-1", Instant.parse("2026-11-07T09:00:00Z")).by());
    }

    @Test
    void indexNeverBorrowsTheAuthorOfAnEarlierVersion() {
        HistAuthorIndex idx = index();
        // Событие в момент, когда версии с автором не открывалось, — «неизвестно».
        HistAuthorIndex.Who w = idx.authorOf("task", "S/T1", Instant.parse("2026-11-07T10:30:00Z"));
        assertNull(w.by());
        assertNull(w.agent(), "неизвестно — это agent=null, не «человек»");
        // Версия без токена — неизвестно, не человек.
        assertNull(idx.authorOf("task", "S/T1", Instant.parse("2026-11-07T12:00:00Z")).agent());
        assertNull(idx.authorOf("task", "S/NOPE", Instant.parse("2026-11-07T10:00:00Z")).agent());
        assertNull(idx.authorOf("decision", "D-1", Instant.parse("2026-11-07T10:00:00Z")).agent());
    }

    @Test
    void indexAdaptsToTheCallerAuthorType() {
        record Author(String who, Boolean agent) {}
        Author a = index().authorOf("task", "S/T1", Instant.parse("2026-11-07T11:00:00Z"), Author::new);
        assertEquals(new Author("lore-mcp-full", true), a);
    }

    @Test
    void loadReadsEveryChainAndReportsAFailedOneInsteadOfHidingIt() {
        HistAuthorIndex idx = HistAuthorIndex.load((sql, p) -> {
            if (sql.contains("FROM KnowSpecHist")) throw new RuntimeException("boom");
            if (sql.contains("FROM KnowTaskHist"))
                return List.of(idxRow("S/T9", "2026-11-07T10:00:00Z", "kc-sub-9", "human"));
            return List.of();
        });
        assertEquals("kc-sub-9", idx.authorOf("task", "S/T9", Instant.parse("2026-11-07T10:00:00Z")).by());
        assertEquals(1, idx.errors().size(), idx.errors().toString());
        assertTrue(idx.errors().get(0).startsWith("KnowSpecHist"), idx.errors().toString());
    }

    @Test
    void sqlReadsOnlyAuthoredVersionsOfTheChain() {
        String sql = HistAuthorIndex.sql("KnowTaskHist");
        assertTrue(sql.contains("in('HAS_STATE').task_uid[0] AS ref_id"), sql);
        assertTrue(sql.contains("changed_by_kind IS NOT NULL"), sql);
        assertTrue(HistAuthorIndex.sql("KnowDictEntryHist").startsWith("SELECT code AS ref_id"));
    }
}
