package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-MCP-CHANGED-RANGE (владелица 11.11.2026): после ревью
 * «закрыли 27, 42 на доработку» агенту нечем было посмотреть правки за период —
 * {@code open_tasks} отдаёт 155 строк в порядке спринтов, {@code closed_tasks} по объёму
 * целиком уже не читается.
 *
 * <p>Общие параметры любого среза: {@code changed_from}/{@code changed_to} (ISO-дата или
 * дата-время, границы включительно, UTC) и {@code sort=changed_at:desc|asc}. Фильтр и
 * сортировка — до страницы, total — после фильтра. Срез без {@code changed_at} — отказ,
 * а не тихое игнорирование.</p>
 */
class SliceChangedRangeTest {

    private static Map<String, String> given(String... kv) {
        Map<String, String> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(kv[i], kv[i + 1]);
        return m;
    }

    private static Map<String, Object> row(String id, String changedAt) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("id", id);
        r.put("changed_at", changedAt);
        return r;
    }

    /** Корпус: границы суток UTC и «через пробел» — оба вида времени, что отдают срезы. */
    private static Map<String, Object> body() {
        List<Map<String, Object>> rows = new ArrayList<>();
        rows.add(row("a", "2026-11-09T23:59:59.999Z"));
        rows.add(row("b", "2026-11-10T00:00:00.000Z"));   // полночь UTC — первая миллисекунда from
        rows.add(row("c", "2026-11-10 12:00:00"));
        rows.add(row("d", "2026-11-11T23:59:59.999Z"));   // последняя миллисекунда to-даты
        rows.add(row("e", "2026-11-12T00:00:00.000Z"));   // уже следующие сутки
        rows.add(row("f", null));                          // времени нет — в период не попадает
        return new LinkedHashMap<>(Map.of("rows", rows));
    }

    @SuppressWarnings("unchecked")
    private static List<String> ids(Map<String, Object> body) {
        List<String> out = new ArrayList<>();
        for (Object r : (List<Object>) body.get("rows")) out.add(String.valueOf(((Map<String, Object>) r).get("id")));
        return out;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> page(Map<String, Object> body) {
        return (Map<String, Object>) body.get("page");
    }

    @Test
    void rangeParamsAreTakenOutOfSliceParams() {
        Map<String, String> g = given("project", "NooriUta/X", "changed_from", "2026-11-10", "changed_to", "2026-11-11",
            "sort", "changed_at:desc");
        assertNotNull(SlicePage.extract(g));
        assertEquals(Map.of("project", "NooriUta/X"), g, "changed_from/changed_to/sort не уходят в compose");
    }

    @Test
    void dateBoundsAreInclusiveWholeDaysUtc() {
        Map<String, Object> b = body();
        SlicePage.apply(b, SlicePage.extract(given("changed_from", "2026-11-10", "changed_to", "2026-11-11")));
        assertEquals(List.of("b", "c", "d"), ids(b), "from-дата с полуночи UTC, to-дата — до конца суток");
    }

    @Test
    void dateTimeBoundsAreInclusive() {
        Map<String, Object> b = body();
        SlicePage.apply(b, SlicePage.extract(given(
            "changed_from", "2026-11-10T00:00:00Z", "changed_to", "2026-11-10T12:00:00Z")));
        assertEquals(List.of("b", "c"), ids(b), "обе границы-моменты включительно");
    }

    @Test
    void openEndedRange() {
        Map<String, Object> b = body();
        SlicePage.apply(b, SlicePage.extract(given("changed_from", "2026-11-11")));
        assertEquals(List.of("d", "e"), ids(b));
    }

    @Test
    void sortDescAndAscByChangedAtNullsLast() {
        Map<String, Object> b = body();
        SlicePage.apply(b, SlicePage.extract(given("sort", "changed_at:desc")));
        assertEquals(List.of("e", "d", "c", "b", "a", "f"), ids(b));
        Map<String, Object> b2 = body();
        SlicePage.apply(b2, SlicePage.extract(given("sort", "changed_at:asc")));
        assertEquals(List.of("a", "b", "c", "d", "e", "f"), ids(b2), "строка без времени — в хвосте в обе стороны");
    }

    @Test
    void filterAndSortBeforePageTotalAfterFilter() {
        Map<String, Object> b = body();
        SlicePage.apply(b, SlicePage.extract(given("changed_from", "2026-11-10", "changed_to", "2026-11-11",
            "sort", "changed_at:desc", "limit", "2")));
        assertEquals(List.of("d", "c"), ids(b), "сначала фильтр и сортировка, потом limit");
        Map<String, Object> p = page(b);
        assertEquals(3, p.get("total"), "total — после фильтра");
        assertEquals(true, p.get("has_more"));
        assertEquals("2026-11-10", p.get("changed_from"));
        assertEquals("2026-11-11", p.get("changed_to"));
        assertEquals("changed_at:desc", p.get("sort"));
        assertEquals("UTC", p.get("time_zone"));
    }

    @Test
    void sliceWithoutChangedAtIsRefused() {
        Map<String, Object> b = new LinkedHashMap<>(Map.of("rows", List.of(Map.of("id", "x"))));
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
            () -> SlicePage.apply(b, SlicePage.extract(given("changed_from", "2026-11-10"))));
        assertTrue(e.getMessage().contains("changed_at"), e.getMessage());
        Map<String, Object> b2 = new LinkedHashMap<>(Map.of("rows", List.of(Map.of("id", "x"))));
        assertThrows(IllegalArgumentException.class,
            () -> SlicePage.apply(b2, SlicePage.extract(given("sort", "changed_at:asc"))),
            "сортировка по времени среза без времени — тоже отказ");
    }

    @Test
    void badDateIsRefused() {
        assertThrows(IllegalArgumentException.class, () -> SlicePage.extract(given("changed_from", "11.11.2026")));
        assertThrows(IllegalArgumentException.class, () -> SlicePage.extract(given("changed_to", "вчера")));
        assertThrows(IllegalArgumentException.class, () -> SlicePage.extract(given("sort", "title:asc")));
        assertThrows(IllegalArgumentException.class,
            () -> SlicePage.extract(given("changed_from", "2026-11-12", "changed_to", "2026-11-11")),
            "from позже to — ошибка запроса, а не пустой ответ");
    }

    @Test
    void emptyAnswerUnderRangeSaysColumnWasNotChecked() {
        Map<String, Object> b = new LinkedHashMap<>(Map.of("rows", List.of()));
        SlicePage.apply(b, SlicePage.extract(given("changed_from", "2026-11-10")));
        assertEquals(0, page(b).get("total"));
        assertTrue(String.valueOf(page(b).get("warning")).contains("changed_at"),
            "пустая выдача не позволяет проверить, есть ли у среза время, — это сказано");
    }
}
