package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * SPRINT_UXR_S9_SCALE_OPT/S9-09 — история на 100+ версий: пагинация, фильтр по
 * автору и по изменённому полю, порядок. Чистая функция над уже атрибутированными
 * строками (хронология по valid_from). Обрезка выдачи видна в {@code page}.
 */
class LoreHistoryPageTest {

    /** n версий: чётные — правка агента со сменой статуса, нечётные — человек, только тело. */
    private static List<Map<String, Object>> rows(int n) {
        List<Map<String, Object>> out = new ArrayList<>();
        String status = "s0";
        for (int i = 0; i < n; i++) {
            if (i % 2 == 0) status = "s" + i;
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("state_uid", "v" + i);
            r.put("status_raw", status);
            r.put("content_hash", "h" + i);
            r.put("author", Map.of("kind", i % 2 == 0 ? "agent" : "human"));
            out.add(r);
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> list(Map<String, Object> p) { return (List<Map<String, Object>>) p.get("rows"); }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> page(Map<String, Object> p) { return (Map<String, Object>) p.get("page"); }

    @Test
    void noParamsReturnsEverythingInOrder() {
        Map<String, Object> p = LoreEntityHistory.page(rows(120), null, null, null, null, null);
        assertEquals(120, list(p).size());
        assertEquals("v0", list(p).get(0).get("state_uid"));
        assertEquals(120, page(p).get("total"));
        assertEquals(false, page(p).get("has_more"));
    }

    @Test
    void pagingNewestFirstSaysThereIsMore() {
        Map<String, Object> p = LoreEntityHistory.page(rows(120), null, null, "desc", 0, 50);
        assertEquals(50, list(p).size());
        assertEquals("v119", list(p).get(0).get("state_uid"), "desc — новые сверху");
        assertEquals(true, page(p).get("has_more"), "обрезка видна, а не молчит");
        Map<String, Object> last = LoreEntityHistory.page(rows(120), null, null, "desc", 100, 50);
        assertEquals(20, list(last).size());
        assertEquals(false, page(last).get("has_more"));
    }

    @Test
    void filterByAuthorKind() {
        Map<String, Object> p = LoreEntityHistory.page(rows(10), "agent", null, null, null, null);
        assertEquals(5, list(p).size());
        assertEquals(5, page(p).get("total"), "total — после фильтра");
    }

    @Test
    void filterByChangedField() {
        // статус меняется на каждой чётной версии, кроме самой первой (v0 — первая версия, считается изменением)
        Map<String, Object> s = LoreEntityHistory.page(rows(10), null, "status", null, null, null);
        assertEquals(List.of("v0", "v2", "v4", "v6", "v8"),
            list(s).stream().map(r -> r.get("state_uid")).toList());
        Map<String, Object> c = LoreEntityHistory.page(rows(10), null, "content", null, null, null);
        assertEquals(10, list(c).size(), "хэш тела меняется в каждой версии");
    }

    @Test
    void badParamsAreReported() {
        assertNotNull(LoreEntityHistory.pageError("robot", null, null, null, null));
        assertNotNull(LoreEntityHistory.pageError(null, "title", null, null, null));
        assertNotNull(LoreEntityHistory.pageError(null, null, "sideways", null, null));
        assertNotNull(LoreEntityHistory.pageError(null, null, null, -1, null));
        assertNotNull(LoreEntityHistory.pageError(null, null, null, null, 0));
        assertNotNull(LoreEntityHistory.pageError(null, null, null, null, LoreEntityHistory.PAGE_MAX + 1));
        assertNull(LoreEntityHistory.pageError("human", "status", "desc", 0, 50));
    }
}
