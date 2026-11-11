package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-MCP-CHANGED-RANGE, остаток: {@code /lore/slice/{id}/count} учитывает
 * период {@code changed_from}/{@code changed_to} так же, как сам срез. До правки параметры периода
 * уходили в compose фильтрами и давали 400 «unknown param» — счётчик «закрыто за сегодня» не
 * сходился со списком «закрыто за сегодня», потому что его не было вовсе.
 */
class SliceCountChangedRangeTest {

    private static Map<String, Object> row(String uid, String status, String changedAt) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("task_uid", uid);
        r.put("status_raw", status);
        r.put("changed_at", changedAt);
        return r;
    }

    private static Map<String, Object> body() {
        List<Map<String, Object>> rows = new ArrayList<>();
        rows.add(row("S/A", "✅ DONE", "2026-11-09T23:59:59.999Z"));   // вне периода
        rows.add(row("S/B", "✅ DONE", "2026-11-10T00:00:00.000Z"));   // полночь UTC — внутри
        rows.add(row("S/C", "🔄 IN PROGRESS", "2026-11-10 15:00:00"));  // внутри
        rows.add(row("S/D", "📋 PLANNED", null));                       // без времени — вне
        return new LinkedHashMap<>(Map.of("rows", rows));
    }

    private static Map<String, String> given(String... kv) {
        Map<String, String> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(kv[i], kv[i + 1]);
        return m;
    }

    @Test
    void periodParamsDoNotReachComposeAsFilters() {
        Map<String, String> f = LoreSectionCount.filtersOf(given("project", "P", "changed_from", "2026-11-10",
            "changed_to", "2026-11-10", "sort", "changed_at:desc"));
        assertEquals(Map.of("project", "P"), f, "период — не фильтр среза: в compose он дал бы 400 unknown param");
    }

    @Test
    @SuppressWarnings("unchecked")
    void countHonoursTheSamePeriodAsTheSlice() {
        SlicePage page = SlicePage.extract(given("changed_from", "2026-11-10", "changed_to", "2026-11-10"));
        Map<String, Object> c = LoreSectionCount.count("open_tasks", body(), given("project", "P"), page);
        assertEquals(1, c.get("open"));
        assertEquals(1, c.get("closed"));
        Map<String, String> filters = (Map<String, String>) c.get("filters");
        assertEquals("2026-11-10", filters.get("changed_from"), "учтённый период назван в ответе");
        assertEquals("2026-11-10", filters.get("changed_to"));
        assertEquals("P", filters.get("project"));
    }

    @Test
    void withoutPeriodEveryRowCounts() {
        Map<String, Object> c = LoreSectionCount.count("open_tasks", body(), given(), null);
        assertEquals(4, (int) c.get("open") + (int) c.get("closed"));
    }

    @Test
    void sliceWithoutChangedAtRefusesThePeriod() {
        Map<String, Object> b = new LinkedHashMap<>(Map.of("rows", List.of(Map.of("task_uid", "S/A", "status_raw", "✅ DONE"))));
        SlicePage page = SlicePage.extract(given("changed_from", "2026-11-10"));
        assertThrows(IllegalArgumentException.class, () -> LoreSectionCount.count("open_tasks", b, given(), page),
            "период к срезу без changed_at — отказ, а не счёт всего подряд");
    }
}
