package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S9_SCALE_OPT/S9-09 — история на 100+ версий, вторая серверная часть:
 * фильтр по КОНКРЕТНОМУ автору ({@code author} = caller) и свёртка подряд идущих
 * правок одного агента в одну строку с числом ({@code collapse=agent}).
 * Свёртка — до страницы: total и has_more считаются по свёрнутым строкам.
 */
class LoreHistoryCollapseTest {

    private static Map<String, Object> row(int i, String kind, String caller) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("state_uid", "v" + i);
        r.put("valid_from", "2026-11-10T10:" + String.format("%02d", i % 60) + ":00Z");
        r.put("status_raw", "s" + i);
        r.put("content_hash", "h" + i);
        Map<String, Object> a = new LinkedHashMap<>();
        a.put("kind", kind);
        a.put("caller", caller);
        r.put("author", a);
        return r;
    }

    /** v0 человек, v1..v100 — агент bot-a (100 правок подряд), v101 человек, v102..v103 — bot-b, v104 — bot-a. */
    private static List<Map<String, Object>> chain() {
        List<Map<String, Object>> out = new ArrayList<>();
        out.add(row(0, "human", "anna"));
        for (int i = 1; i <= 100; i++) out.add(row(i, "agent", "bot-a"));
        out.add(row(101, "human", "anna"));
        out.add(row(102, "agent", "bot-b"));
        out.add(row(103, "agent", "bot-b"));
        out.add(row(104, "agent", "bot-a"));
        return out;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> list(Map<String, Object> p) { return (List<Map<String, Object>>) p.get("rows"); }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> page(Map<String, Object> p) { return (Map<String, Object>) p.get("page"); }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> collapsed(Map<String, Object> r) { return (Map<String, Object>) r.get("collapsed"); }

    private static List<Object> uids(Map<String, Object> p) { return list(p).stream().map(r -> r.get("state_uid")).toList(); }

    @Test
    void collapseFoldsRunOfOneAgentIntoOneRowWithCount() {
        Map<String, Object> p = LoreEntityHistory.page(chain(), null, null, null, "agent", null, null, null);
        // v0 | v1..v100 -> v100 (x100) | v101 | v102..v103 -> v103 (x2) | v104 (один — не свёрнут)
        assertEquals(List.of("v0", "v100", "v101", "v103", "v104"), uids(p));
        Map<String, Object> run = collapsed(list(p).get(1));
        assertNotNull(run, "свёрнутая строка несёт collapsed");
        assertEquals(100, run.get("count"));
        assertEquals("v1", run.get("first_state_uid"));
        assertEquals("2026-11-10T10:01:00Z", run.get("first_valid_from"));
        assertEquals(2, collapsed(list(p).get(3)).get("count"));
        assertNull(collapsed(list(p).get(0)), "человек не сворачивается");
        assertNull(collapsed(list(p).get(4)), "одиночная правка агента — без collapsed");
        assertEquals(5, page(p).get("total"), "total — по свёрнутым строкам");
        assertEquals("agent", page(p).get("collapse"));
    }

    @Test
    void differentAgentsAreNotMergedTogether() {
        List<Map<String, Object>> c = new ArrayList<>();
        c.add(row(0, "agent", "bot-a"));
        c.add(row(1, "agent", "bot-b"));
        c.add(row(2, "agent", "bot-b"));
        Map<String, Object> p = LoreEntityHistory.page(c, null, null, null, "agent", null, null, null);
        assertEquals(List.of("v0", "v2"), uids(p));
    }

    @Test
    void collapseThenPageNewestFirst() {
        Map<String, Object> p = LoreEntityHistory.page(chain(), null, null, null, "agent", "desc", 0, 2);
        assertEquals(List.of("v104", "v103"), uids(p));
        assertEquals(5, page(p).get("total"));
        assertEquals(true, page(p).get("has_more"));
        Map<String, Object> rest = LoreEntityHistory.page(chain(), null, null, null, "agent", "desc", 2, 50);
        assertEquals(List.of("v101", "v100", "v0"), uids(rest));
        assertEquals(100, collapsed(list(rest).get(1)).get("count"), "свёртка та же при desc");
        assertEquals(false, page(rest).get("has_more"));
    }

    @Test
    void filterByConcreteAuthor() {
        Map<String, Object> p = LoreEntityHistory.page(chain(), null, "bot-b", null, null, null, null, null);
        assertEquals(List.of("v102", "v103"), uids(p));
        assertEquals(2, page(p).get("total"));
        assertEquals("bot-b", page(p).get("author"));
        Map<String, Object> a = LoreEntityHistory.page(chain(), "agent", "bot-a", null, null, null, null, null);
        assertEquals(101, page(a).get("total"), "author и author_kind — вместе (И)");
        Map<String, Object> none = LoreEntityHistory.page(chain(), "human", "bot-a", null, null, null, null, null);
        assertEquals(0, page(none).get("total"));
    }

    @Test
    void withoutNewParamsNothingChanges() {
        Map<String, Object> p = LoreEntityHistory.page(chain(), null, null, null, null, null, null, null);
        assertEquals(chain().size(), list(p).size());
        assertFalse(list(p).stream().anyMatch(r -> r.containsKey("collapsed")));
        Map<String, Object> old = LoreEntityHistory.page(chain(), null, null, null, null, null);
        assertEquals(uids(old), uids(p), "старая сигнатура — тот же ответ");
    }

    @Test
    void badNewParamsAreReported() {
        assertNotNull(LoreEntityHistory.pageError(null, null, null, "human", null, null, null), "collapse только agent");
        assertNotNull(LoreEntityHistory.pageError(null, " ", null, null, null, null, null), "пустой author — ошибка, а не «все»");
        assertNotNull(LoreEntityHistory.pageError(null, "x".repeat(300), null, null, null, null, null));
        assertNull(LoreEntityHistory.pageError("agent", "bot-a", "status", "agent", "desc", 0, 50));
        assertTrue(LoreEntityHistory.COLLAPSE_MODES.contains("agent"));
    }
}
