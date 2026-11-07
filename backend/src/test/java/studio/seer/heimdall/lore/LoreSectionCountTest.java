package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S1_HONEST_API/S1-07 — одно правило счётчиков:
 * «открытые · в скоупе · с текущими фильтрами», закрытые отдельно («142 · +361»).
 * Форма — SPEC-LORE-UXR-S1-CONTRACTS, контракт 3 (SectionCount в src/api/contracts/s1.ts);
 * деление открыто/закрыто — категории S1-06 ({@link LoreStatusCategory}).
 */
class LoreSectionCountTest {

    private static Map<String, Object> row(String field, Object value) {
        Map<String, Object> m = new HashMap<>();
        if (value != null) m.put(field, value);
        return m;
    }

    private static Map<String, Object> body(List<Map<String, Object>> rows) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("rows", rows);
        return b;
    }

    @Test
    void acceptedADR_считаетсяОткрытым_закрытые_отдельнымСлагаемым() {
        Map<String, Object> c = LoreSectionCount.count("adrs", body(List.of(
            row("status", "accepted"), row("status", "accepted"),
            row("status", "proposed"), row("status", "superseded"),
            row("status", "deprecated"))), Map.of());
        assertEquals("adrs", c.get("section"));
        assertEquals(3, c.get("open"));
        assertEquals(2, c.get("closed"));
        @SuppressWarnings("unchecked")
        Map<String, Integer> by = (Map<String, Integer>) c.get("byCategory");
        assertEquals(2, by.get("in_force"));
        assertEquals(1, by.get("in_progress"));
        assertEquals(2, by.get("withdrawn"));
        assertNull(by.get("finished"), "byCategory — только встреченные категории (Partial<Record>)");
    }

    @Test
    void задачи_свободныйТекстСтатуса_иНераспознанное_открыто() {
        Map<String, Object> c = LoreSectionCount.count("open_tasks", body(List.of(
            row("status_raw", "✅ MERGED — #847"),
            row("status_raw", "🚫 CANCELLED"),
            row("status_raw", "🔄 IN PROGRESS"),
            row("status_raw", null))), Map.of());
        assertEquals(2, c.get("open"), "in_progress + unknown: нераспознанное не прячем");
        assertEquals(2, c.get("closed"));
        @SuppressWarnings("unchecked")
        Map<String, Integer> by = (Map<String, Integer>) c.get("byCategory");
        assertEquals(1, by.get("unknown"));
        assertEquals(1, by.get("finished"));
        assertEquals(1, by.get("withdrawn"));
    }

    @Test
    void пустаяВыдача_нули_аНеОтсутствие() {
        Map<String, Object> c = LoreSectionCount.count("specs", body(List.of()), Map.of());
        assertEquals(0, c.get("open"));
        assertEquals(0, c.get("closed"));
        assertEquals("complete", c.get("completeness"));
    }

    @Test
    void скоупИФильтры_вОтвете_числоНеВыдаётсяЗаГлобальное() {
        Map<String, Object> b = body(List.of(row("status", "accepted")));
        Map<String, Object> scope = new LinkedHashMap<>();
        scope.put("applied", true);
        scope.put("projects", 2);
        b.put("scope", scope);
        Map<String, String> filters = new LinkedHashMap<>();
        filters.put("project", "UnlimitedLORE");
        Map<String, Object> c = LoreSectionCount.count("adrs", b, filters);
        assertEquals(scope, c.get("scope"));
        assertEquals(Map.of("project", "UnlimitedLORE"), c.get("filters"));
    }

    @Test
    void безСкоупа_scopeNull_иФильтрыПустые() {
        Map<String, Object> c = LoreSectionCount.count("adrs", body(List.of()), null);
        assertTrue(c.containsKey("scope"), "ключ есть всегда — «без скоупа» ≠ «сервер не сказал»");
        assertNull(c.get("scope"));
        assertEquals(Map.of(), c.get("filters"));
    }

    @Test
    void обрезаннаяВыдача_partial_неизвестнаяПолнота_unknown() {
        Map<String, Object> cut = body(List.of(row("status", "accepted")));
        cut.put("truncated", true);
        assertEquals("partial", LoreSectionCount.count("adrs", cut, Map.of()).get("completeness"));

        Map<String, Object> unk = body(List.of(row("status", "accepted")));
        unk.put("truncated", "unknown");
        assertEquals("unknown", LoreSectionCount.count("adrs", unk, Map.of()).get("completeness"));
    }

    @Test
    void порядокКлючей_какВКонтракте() {
        Map<String, Object> c = LoreSectionCount.count("adrs", body(List.of()), Map.of());
        assertEquals(List.of("section", "open", "closed", "byCategory", "scope", "filters", "completeness"),
            List.copyOf(c.keySet()));
    }

    @Test
    void считаемыеСрезы_тольКоСоСтатусом() {
        assertTrue(LoreSectionCount.isCountable("adrs"));
        assertTrue(LoreSectionCount.isCountable("open_tasks"));
        assertFalse(LoreSectionCount.isCountable("releases"));
        assertFalse(LoreSectionCount.isCountable(null));
    }

    @Test
    void несчитаемыйСрез_отказ() {
        org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class,
            () -> LoreSectionCount.count("releases", body(List.of()), Map.of()));
    }

    @Test
    void фильтрыСтраницы_неВходятВСчётчик() {
        Map<String, String> given = new LinkedHashMap<>();
        given.put("project", "X");
        given.put("limit", "10");
        given.put("offset", "20");
        given.put("fields", "id");
        assertEquals(Map.of("project", "X"), LoreSectionCount.filtersOf(given));
    }
}
