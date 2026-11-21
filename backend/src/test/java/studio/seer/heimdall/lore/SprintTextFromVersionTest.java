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
    void аннотация_спеки_из_открытой_версии_а_не_из_первой() {
        // ревизия 19.11: summary[0] без valid_to IS NULL — первая попавшаяся версия, паспорт показывал старую аннотацию
        for (String slice : new String[]{"specs", "spec_by_id"}) {
            String s = sql(slice, slice.equals("specs") ? Map.of() : Map.of("id", "SPEC-X"));
            assertTrue(s.contains("out('HAS_STATE')[valid_to IS NULL].summary[0]"), slice + ": " + s);
        }
    }

    @Test
    void бэкфилл_автосвязей_и_гигиена_видят_тексты_спринта_в_версии() {
        String b = LoreLinkResource.BACKFILL_BODIES.get("sprint");
        assertTrue(b.contains("COALESCE(out('HAS_STATE')[valid_to IS NULL].context_md[0], context_md) AS context_md"), b);
        assertTrue(b.contains("COALESCE(out('HAS_STATE')[valid_to IS NULL].outcome_md[0], outcome_md) AS outcome_md"), b);
        LoreTidyResource.Target t = LoreTidyResource.TARGETS.stream()
            .filter(x -> x.type().equals("KnowSprint")).findFirst().orElseThrow();
        assertTrue(t.histFields().contains("context_md"), "context_md спринта сверяется с версией: " + t);
    }

    @Test
    void список_спринтов_читает_контекст_из_открытой_версии() {
        String s = sql("sprints", Map.of());
        assertTrue(s.contains("COALESCE(out('HAS_STATE')[valid_to IS NULL].context_md[0], context_md) AS context_md"), s);
    }
}
