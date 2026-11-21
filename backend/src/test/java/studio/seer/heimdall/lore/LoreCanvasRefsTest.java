package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Холст «зачем» (SPEC-LORE-UXR-WHY-CANVAS-TECH): стикер привязан к записи парой {@code ref_type} + {@code ref_id}
 * (переживает перенос базы, @rid — нет; решение владелицы 19–20.11.2026). Чтобы стикер показал название записи и
 * открыл её паспорт, GET холста отдаёт у привязанного стикера {@code ref_title} и {@code ref_state}:
 * {@code found} — запись есть; {@code missing} — ссылка битая («запись не найдена», а не пусто);
 * {@code unknown_type} — тип ссылки серверу неизвестен. Чистый JUnit: поиск записей подменён.
 */
class LoreCanvasRefsTest {

    private static Map<String, Object> item(String uid, String type, String id) {
        Map<String, Object> m = new HashMap<>();
        m.put("item_uid", uid);
        m.put("kind", "sticker");
        m.put("ref_type", type);
        m.put("ref_id", id);
        return m;
    }

    @Test
    void ссылки_группируются_по_типу_без_повторов() {
        List<Map<String, Object>> items = List.of(item("a", "adr", "ADR-1"), item("b", "adr", "ADR-1"),
            item("c", "task", "S/T-1"), item("d", null, null));
        assertEquals(Map.of("adr", List.of("ADR-1"), "task", List.of("S/T-1")), LoreCanvas.refIdsByType(items));
    }

    @Test
    void запрос_названий_по_ветке_поиска() {
        LoreCanvas.RefSource s = LoreCanvas.refSource("adr");
        assertNotNull(s);
        assertEquals("SELECT adr_id AS ref_id, name AS title FROM KnowADR WHERE adr_id IN :ids", s.sql());
        // тип без названия в поиске, но связываемый рёбрами — существование проверяется, название — код
        LoreCanvas.RefSource c = LoreCanvas.refSource("component");
        assertNotNull(c);
        assertTrue(c.sql().startsWith("SELECT component_id AS ref_id"), c.sql());
        assertNull(LoreCanvas.refSource("zz_unknown"));
    }

    @Test
    void найденная_битая_и_неизвестная_ссылка_различаются() {
        List<Map<String, Object>> items = new ArrayList<>(List.of(
            item("a", "adr", "ADR-1"), item("b", "adr", "ADR-404"), item("c", "zz_unknown", "X-1"), item("d", null, null)));
        List<String> asked = new ArrayList<>();
        LoreCanvas.annotateRefs(items, (sql, p) -> {
            asked.add(sql);
            @SuppressWarnings("unchecked") List<String> ids = (List<String>) p.get("ids");
            assertEquals(List.of("ADR-1", "ADR-404"), ids);
            return List.of(Map.of("ref_id", "ADR-1", "title", "Холст на xyflow"));
        });
        assertEquals(1, asked.size(), "один запрос на тип, не на стикер");
        assertEquals("found", items.get(0).get("ref_state"));
        assertEquals("Холст на xyflow", items.get(0).get("ref_title"));
        assertEquals("missing", items.get(1).get("ref_state"), "битая ссылка — «запись не найдена», а не пусто");
        assertNull(items.get(1).get("ref_title"));
        assertEquals("unknown_type", items.get(2).get("ref_state"));
        assertFalse(items.get(3).containsKey("ref_state"), "непривязанный стикер — без состояния ссылки");
    }

    @Test
    void сбой_чтения_названий_не_выдаётся_за_битую_ссылку() {
        List<Map<String, Object>> items = new ArrayList<>(List.of(item("a", "adr", "ADR-1")));
        LoreCanvas.annotateRefs(items, (sql, p) -> { throw new IllegalStateException("upstream 502"); });
        assertEquals("unchecked", items.get(0).get("ref_state"), "не смогли проверить ≠ записи нет");
        assertEquals("upstream 502", items.get(0).get("ref_error"));
    }
}
