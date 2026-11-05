package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SE-01 / 05.11.2026 (сессия Völva): слайс {@code releases} отвечал 400
 * «unknown param: limit» и отдавал полные description_md всех релизов (~20 тыс.
 * знаков на семь релизов) — агенту, которому нужен был «какой релиз текущий».
 *
 * <p>Правило для ВСЕХ слайсов, а не для releases: {@code limit}/{@code offset}
 * — зарезервированные параметры страницы. Они не доходят до compose (иначе
 * «unknown param»), проверяются здесь и применяются к строкам ответа; ответ
 * несёт {@code page} с total/has_more, чтобы урезанная выдача не выглядела
 * полной.</p>
 */
class SlicePageTest {

    private static Map<String, String> given(String... kv) {
        Map<String, String> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(kv[i], kv[i + 1]);
        return m;
    }

    private static List<Map<String, Object>> rows(int n) {
        List<Map<String, Object>> r = new ArrayList<>();
        for (int i = 0; i < n; i++) r.add(Map.of("i", i));
        return r;
    }

    @Test
    void limitAndOffsetAreTakenOutOfSliceParams() {
        Map<String, String> g = given("project", "NooriUta/X", "limit", "2", "offset", "1");
        SlicePage p = SlicePage.extract(g);
        assertEquals(Map.of("project", "NooriUta/X"), g, "limit/offset не уходят в compose");
        assertEquals(2, p.limit());
        assertEquals(1, p.offset());
        // и compose с остатком больше не падает на «unknown param: limit»
        assertDoesNotThrow(() -> LoreSlices.compose("releases", g));
    }

    @Test
    void noPagingMeansNoChange() {
        SlicePage p = SlicePage.extract(given("project", "x"));
        assertNull(p);
        Map<String, Object> body = new LinkedHashMap<>(Map.of("rows", rows(5)));
        SlicePage.apply(body, null);
        assertEquals(5, ((List<?>) body.get("rows")).size());
        assertFalse(body.containsKey("page"));
    }

    @Test
    void pageCutsRowsAndSaysWhatWasCut() {
        Map<String, Object> body = new LinkedHashMap<>(Map.of("rows", rows(7)));
        SlicePage.apply(body, SlicePage.extract(given("limit", "3", "offset", "2")));
        List<?> r = (List<?>) body.get("rows");
        assertEquals(3, r.size());
        assertEquals(Map.of("i", 2), r.get(0));
        @SuppressWarnings("unchecked") Map<String, Object> page = (Map<String, Object>) body.get("page");
        assertEquals(7, page.get("total"));
        assertEquals(true, page.get("has_more"));
        assertEquals(3, page.get("limit"));
        assertEquals(2, page.get("offset"));
    }

    @Test
    void lastPageHasNoMore() {
        Map<String, Object> body = new LinkedHashMap<>(Map.of("rows", rows(4)));
        SlicePage.apply(body, SlicePage.extract(given("limit", "3", "offset", "3")));
        assertEquals(1, ((List<?>) body.get("rows")).size());
        @SuppressWarnings("unchecked") Map<String, Object> page = (Map<String, Object>) body.get("page");
        assertEquals(false, page.get("has_more"));
    }

    @Test
    void offsetPastEndIsEmptyNotError() {
        Map<String, Object> body = new LinkedHashMap<>(Map.of("rows", rows(2)));
        SlicePage.apply(body, SlicePage.extract(given("offset", "10")));
        assertEquals(0, ((List<?>) body.get("rows")).size());
    }

    @Test
    void fieldsProjectionDropsHeavyColumns() {
        // «какой релиз текущий» без description_md всех релизов
        Map<String, Object> body = new LinkedHashMap<>(Map.of("rows", List.of(
            Map.of("release_id", "v2", "is_current", true, "description_md", "много текста"),
            Map.of("release_id", "v1", "is_current", false, "description_md", "ещё больше"))));
        Map<String, String> g = given("fields", "release_id, is_current", "limit", "1");
        SlicePage p = SlicePage.extract(g);
        assertTrue(g.isEmpty(), "fields тоже не уходит в compose");
        SlicePage.apply(body, p);
        List<?> r = (List<?>) body.get("rows");
        assertEquals(List.of(Map.of("release_id", "v2", "is_current", true)), r);
    }

    @Test
    void unknownFieldFailsWithAvailableColumns() {
        // Völva 05.11: молча отсутствующее поле агент читает как «значения нет» —
        // вывод о данных вместо вывода о запросе. Слайсы отдают null-поля явно,
        // поэтому колонка, которой нет НИ В ОДНОЙ строке, — опечатка или чужая колонка.
        Map<String, Object> body = new LinkedHashMap<>(Map.of("rows", List.of(
            Map.of("release_id", "v2", "is_current", true))));
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
            () -> SlicePage.apply(body, SlicePage.extract(given("fields", "release_id,is_curent"))));
        assertTrue(e.getMessage().contains("is_curent"), e.getMessage());
        assertTrue(e.getMessage().contains("is_current"), "перечислены доступные колонки: " + e.getMessage());
    }

    @Test
    void nullValuedFieldIsNotUnknown() {
        java.util.Map<String, Object> row = new java.util.HashMap<>();
        row.put("a", 1); row.put("b", null);
        Map<String, Object> body = new LinkedHashMap<>(Map.of("rows", List.of(row)));
        assertDoesNotThrow(() -> SlicePage.apply(body, SlicePage.extract(given("fields", "b"))));
    }

    @Test
    void emptyResultCannotJudgeFields() {
        Map<String, Object> body = new LinkedHashMap<>(Map.of("rows", List.of()));
        assertDoesNotThrow(() -> SlicePage.apply(body, SlicePage.extract(given("fields", "whatever"))));
    }

    @Test
    void fieldsAloneWithoutPaging() {
        Map<String, Object> body = new LinkedHashMap<>(Map.of("rows", List.of(Map.of("a", 1, "b", 2))));
        SlicePage.apply(body, SlicePage.extract(given("fields", "a")));
        assertEquals(List.of(Map.of("a", 1)), body.get("rows"));
    }

    @Test
    void badValuesAreRefusedLoudly() {
        assertThrows(IllegalArgumentException.class, () -> SlicePage.extract(given("fields", " , ")));
        assertThrows(IllegalArgumentException.class, () -> SlicePage.extract(given("fields", "a;DROP")));
        assertThrows(IllegalArgumentException.class, () -> SlicePage.extract(given("limit", "0")));
        assertThrows(IllegalArgumentException.class, () -> SlicePage.extract(given("limit", "-1")));
        assertThrows(IllegalArgumentException.class, () -> SlicePage.extract(given("limit", "abc")));
        assertThrows(IllegalArgumentException.class, () -> SlicePage.extract(given("offset", "-3")));
        assertThrows(IllegalArgumentException.class,
            () -> SlicePage.extract(given("limit", String.valueOf(SlicePage.MAX_LIMIT + 1))));
    }
}
