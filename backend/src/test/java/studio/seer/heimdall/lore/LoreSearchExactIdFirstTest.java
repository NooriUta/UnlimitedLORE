package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Приёмка препрода 14.11.2026: поиск по точному коду SPRINT_UXR_S9_SCALE_OPT первой строкой давал спеку
 * SPEC-LORE-UXR-CRITIQUE-R3-SCALE (выше BM25 × приоритет типа), Shift+Enter открыл не то. Правило: запись,
 * чей код РАВЕН запросу (без учёта регистра и пробелов по краям), — первой; остальные по счёту.
 */
class LoreSearchExactIdFirstTest {

    static Map<String, Object> hit(String id, double score) {
        Map<String, Object> h = new LinkedHashMap<>();
        h.put("ref_id", id);
        h.put("score", score);
        return h;
    }

    @Test
    void exactCodeGoesFirst() {
        List<Map<String, Object>> hits = new ArrayList<>(List.of(
            hit("SPEC-LORE-UXR-CRITIQUE-R3-SCALE", 0.9), hit("SPRINT_UXR_S9_SCALE_OPT", 0.4), hit("SPRINT_UXR_S9_SCALE_OPT/S9-05", 0.6)));
        LoreSearchResource.sortHits(hits, "  sprint_uxr_s9_scale_opt ");
        assertEquals("SPRINT_UXR_S9_SCALE_OPT", hits.get(0).get("ref_id"));
        assertEquals(Boolean.TRUE, hits.get(0).get("exact"));
        assertEquals("SPEC-LORE-UXR-CRITIQUE-R3-SCALE", hits.get(1).get("ref_id"), "остальные — по счёту");
    }

    @Test
    void noExactMatchKeepsScoreOrder() {
        List<Map<String, Object>> hits = new ArrayList<>(List.of(hit("A", 0.2), hit("B", 0.9)));
        LoreSearchResource.sortHits(hits, "scale");
        assertEquals("B", hits.get(0).get("ref_id"));
        assertFalse(hits.get(0).containsKey("exact"));
    }
}
