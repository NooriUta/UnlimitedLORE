package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_WORK_ANY_KIND/WK-03 · decision:D-2026-LORE-SERVES-EDGE.
 *
 * <p>Сервисный продукт служит технологическому: считаем (count), продаём
 * (sell), поддерживаем (support). Ребро SERVES продукт → продукт, вид —
 * свойство ребра. Без живой базы: шаг схемы, срез и проверка входа.
 */
class ProductServesTest {

    @Test
    void schemaStepCreatesTheEdgeTypeWithKind() {
        LoreSchemaMigrations.Step step = LoreSchemaMigrations.STEPS.stream()
            .filter(s -> s.name().equals("product_serves")).findFirst().orElseThrow(
                () -> new AssertionError("шаг схемы product_serves не зарегистрирован"));
        assertEquals(62, step.version());
        assertEquals(17, step.compatMajor(), "аддитивно");
        assertEquals(List.of("CREATE EDGE TYPE SERVES IF NOT EXISTS",
            "CREATE PROPERTY SERVES.kind IF NOT EXISTS STRING"), step.sql());
    }

    @Test
    void productsSliceReturnsWhomAndHow() {
        String sql = LoreSlices.compose("products", Map.of()).sql();
        assertTrue(sql.contains("out('SERVES').code AS serves_codes"), sql);
        assertTrue(sql.contains("outE('SERVES').kind AS serves_kinds"), sql);
    }

    @Test
    void servesWithoutKindIsRejectedBeforeAnyRead() {
        LoreProductAxisResource r = new LoreProductAxisResource();
        r.enabled = true;
        var resp = r.productLink(new LoreProductAxisResource.ProductLinkRequest(
            "HARPA", "serves", "AIDA", null, "add", null), "admin");
        assertEquals(400, resp.getStatus());
        assertTrue(String.valueOf(resp.getEntity()).contains("kind"), String.valueOf(resp.getEntity()));
        var bad = r.productLink(new LoreProductAxisResource.ProductLinkRequest(
            "HARPA", "serves", "AIDA", null, "add", "advertise"), "admin");
        assertEquals(400, bad.getStatus());
    }
}
