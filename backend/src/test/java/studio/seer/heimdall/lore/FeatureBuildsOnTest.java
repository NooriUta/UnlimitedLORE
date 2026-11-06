package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_PRODUCT_BACKLOG/AN-09 · decision:D-2026-LORE-FEATURE-BUILDS-ON-EDGE (владелица 06.11).
 *
 * <p>Линейка фич «опирается на → открывает дорогу» жила текстовыми ссылками в
 * блоке «Место в линейке» context_md. Принцип слоя — истина в рёбрах (D5):
 * связь теперь ребро BUILDS_ON (фича → фича, на которую она опирается).
 */
class FeatureBuildsOnTest {

    @Test
    void schemaStepCreatesTheEdgeType() {
        LoreSchemaMigrations.Step step = LoreSchemaMigrations.STEPS.stream()
            .filter(s -> s.name().equals("feature_builds_on")).findFirst().orElseThrow(
                () -> new AssertionError("шаг схемы feature_builds_on не зарегистрирован"));
        assertEquals(60, step.version());
        assertEquals(17, step.compatMajor(), "аддитивно");
        assertEquals(List.of("CREATE EDGE TYPE BUILDS_ON IF NOT EXISTS EXTENDS E"), step.sql());
    }

    @Test
    void featuresSliceReturnsBothDirections() {
        String sql = LoreSlices.compose("features", Map.of()).sql();
        assertTrue(sql.contains("out('BUILDS_ON').uc_id AS builds_on_ids"), "опирается на: " + sql);
        assertTrue(sql.contains("in('BUILDS_ON').uc_id AS enables_ids"), "открывает дорогу: " + sql);
    }

    @Test
    void featureLinkKnowsTheRel() {
        assertEquals("BUILDS_ON", LoreProductResource.featureEdgeOf("builds_on"));
        assertNull(LoreProductResource.featureEdgeOf("nonsense"));
    }
}
