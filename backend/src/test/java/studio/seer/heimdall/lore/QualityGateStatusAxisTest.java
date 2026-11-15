package studio.seer.heimdall.lore;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MD-04 — состояние гейта качества на общей оси статусов.
 *
 * <p>До правки состояние гейта (draft / active / stale / retired, ADR-LORE-053-D7) шло в список и
 * паспорт голым кодом: тип не входил в {@code statuses} модели и не имел категории, поэтому
 * значка, подписи и деления «открыт / закрыт» у гейта не было (проверка на препроде 15.11.2026).
 */
class QualityGateStatusAxisTest {

    @Test
    void everyGateStateHasCategoryOnTheAxis() {
        assertEquals("not_started", LoreStatusCategory.of("quality_gate", "draft"));
        assertEquals("in_force", LoreStatusCategory.of("quality_gate", "active"));
        assertEquals("in_progress", LoreStatusCategory.of("quality_gate", "stale"));
        assertEquals("withdrawn", LoreStatusCategory.of("quality_gate", "retired"));
    }

    /** Положительный контроль: набор категорий покрывает ровно состояния цикла гейта. */
    @Test
    void categoriesCoverExactlyTheGateLifecycle() {
        assertEquals(new java.util.TreeSet<>(QgGateLifecycle.STATUSES),
            new java.util.TreeSet<>(LoreStatusCategory.GATE_MAP.keySet()));
    }

    @Test
    void unknownGateStateStaysUnknownAndOpen() {
        assertEquals(LoreStatusCategory.UNKNOWN, LoreStatusCategory.of("quality_gate", "paused"));
        assertEquals(LoreStatusCategory.UNKNOWN, LoreStatusCategory.of("quality_gate", ""));
    }

    /** «Работает» у гейта — действует, а не «в работе» задачи: одно слово active, разные типы. */
    @Test
    void activeMeansDifferentThingsForGateAndTask() {
        assertEquals("in_force", LoreStatusCategory.of("quality_gate", "active"));
        assertEquals("in_progress", LoreStatusCategory.of("task", "active"));
    }

    @Test
    void gateSlicesCarryStatusCategory() {
        for (String slice : List.of("quality_gates", "quality_gate_by_id")) {
            LoreStatusCategory.StatusSource src = LoreStatusCategory.SLICE_STATUS.get(slice);
            assertNotNull(src, "срез " + slice + " обязан нести категорию состояния гейта");
            assertEquals("quality_gate", src.type());
            assertEquals("status", src.field());
        }
    }

    @Test
    void modelServesGateStatusBlockFromItsDictionary() {
        List<Map<String, Object>> dict = List.of(
            row("draft", "Задуман", 10), row("active", "Работает", 20),
            row("stale", "Молчит", 30), row("retired", "Выведен", 40));
        Map<String, Object> m = LoreModel.build(dict);
        assertTrue(((List<?>) m.get("statuses_known")).contains("quality_gate"));
        @SuppressWarnings("unchecked")
        Map<String, Object> block = (Map<String, Object>) ((Map<String, Object>) m.get("statuses")).get("quality_gate");
        assertNotNull(block, "в модели нет блока статусов гейта");
        assertEquals("qg_status", block.get("dict"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> entries = (List<Map<String, Object>>) block.get("entries");
        assertEquals(List.of("draft", "active", "stale", "retired"), entries.stream().map(e -> e.get("code")).toList());
        assertEquals(List.of("Задуман", "Работает", "Молчит", "Выведен"), entries.stream().map(e -> e.get("title")).toList());
        assertEquals(List.of("not_started", "in_force", "in_progress", "withdrawn"),
            entries.stream().map(e -> e.get("category")).toList());
    }

    private static Map<String, Object> row(String code, String label, int order) {
        return Map.of("dict_type", "qg_status", "code", code, "label_ru", label, "label_en", code,
            "icon", "play-button", "color", "var(--suc)", "sort_order", order, "is_active", true);
    }
}
