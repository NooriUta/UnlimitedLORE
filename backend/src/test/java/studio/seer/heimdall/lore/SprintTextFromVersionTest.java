package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MIG-03 · в новой схеме тексты спринта (context_md, outcome_md) живут только в версии
 * (KnowSprintHist). Агент-ревизия 19.11.2026: паспорт спринта (sprint_tree) и список (sprints) читали их с записи — на
 * новой базе «Контекст» и «Итог» пусты. Правило: открытая версия, иначе запись — верно на обеих схемах.
 */
class SprintTextFromVersionTest {

    private static String sql(String slice, Map<String, String> p) {
        return LoreSlices.compose(slice, p).sql();
    }

    @Test
    void паспорт_спринта_читает_тексты_из_открытой_версии() {
        String s = sql("sprint_tree", Map.of("id", "S"));
        assertTrue(s.contains("COALESCE(out('HAS_STATE')[valid_to IS NULL].context_md[0], context_md) AS context_md"), s);
        assertTrue(s.contains("COALESCE(out('HAS_STATE')[valid_to IS NULL].outcome_md[0], outcome_md) AS outcome_md"), s);
    }

    @Test
    void список_спринтов_читает_контекст_из_открытой_версии() {
        String s = sql("sprints", Map.of());
        assertTrue(s.contains("COALESCE(out('HAS_STATE')[valid_to IS NULL].context_md[0], context_md) AS context_md"), s);
    }
}
