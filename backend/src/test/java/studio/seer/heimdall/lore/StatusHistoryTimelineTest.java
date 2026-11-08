package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;
import studio.seer.heimdall.lore.news.AuthorResolver;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** S2-13: «статус в момент t» и «кто записал версию» по истории StatusHistoryService. */
class StatusHistoryTimelineTest {

    private static Map<String, Object> v(String id, String from, String to, String st, String known, String by, String kind) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", id); m.put("valid_from", from); m.put("valid_to", to); m.put("status_raw", st);
        m.put("status_known_from", known); m.put("changed_by", by); m.put("changed_by_kind", kind);
        return m;
    }

    private static Instant t(String s) { return Instant.parse(s); }

    @Test
    void status_at_moment_follows_versions_and_does_not_invent_before_known_from() {
        StatusHistoryTimeline h = new StatusHistoryTimeline();
        h.add("adr", List.of(
            // бэкфилл V68: открытая версия с прошлой датой, статус известен лишь с момента бэкфилла
            v("ADR-1", "2026-01-01 10:00:00", "2026-11-10T00:00:00Z", "PROPOSED", "2026-11-08T00:00:00Z", null, "unknown"),
            v("ADR-1", "2026-11-10T00:00:00Z", null, "ACCEPTED", "2026-11-10T00:00:00Z", "kc-sub-1", "human")));
        assertTrue(h.available("adr"));
        assertFalse(h.available("decision"), "тип не прочитан — недоступен, а не «пуст»");
        assertEquals(Optional.empty(), h.statusAt("adr", "ADR-1", t("2026-06-01T00:00:00Z")),
            "до status_known_from статус неизвестен");
        assertEquals(Optional.of("PROPOSED"), h.statusAt("adr", "ADR-1", t("2026-11-09T00:00:00Z")));
        assertEquals(Optional.of("ACCEPTED"), h.statusAt("adr", "ADR-1", t("2026-11-10T00:00:00Z")),
            "граница: новая версия действует с valid_from включительно");
        assertEquals(Optional.empty(), h.statusAt("adr", "ADR-2", t("2026-11-10T00:00:00Z")));
    }

    @Test
    void author_of_version_open_at_moment() {
        StatusHistoryTimeline h = new StatusHistoryTimeline();
        h.add("task", List.of(
            v("S/T1", "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z", "📋 PLANNED", null, "lore-mcp", "agent"),
            v("S/T1", "2026-11-02T00:00:00Z", null, "✅ DONE", null, null, null)));
        AuthorResolver.Author a = h.authorOf("task", "S/T1", t("2026-11-01T12:00:00Z"));
        assertEquals("lore-mcp", a.who());
        assertEquals(Boolean.TRUE, a.agent());
        assertEquals(null, h.authorOf("task", "S/T1", t("2026-11-03T00:00:00Z")).agent(),
            "версия без автора — неизвестно, не человек");
    }

    @Test
    void load_marks_failed_type_unavailable() {
        StatusHistoryTimeline h = StatusHistoryTimeline.load((sql, p) -> {
            if (sql.contains("KnowDecisionHist")) throw new IllegalStateException("upstream 502");
            return List.of();
        });
        assertTrue(h.available("adr"));
        assertFalse(h.available("decision"));
    }
}
