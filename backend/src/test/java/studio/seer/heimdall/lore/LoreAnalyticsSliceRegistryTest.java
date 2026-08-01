package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * AN-11 (ADR-LORE-030 §3): отдельных MCP-инструментов на аналитику НЕ существует
 * намеренно — UI и агенты читают одни и те же слайсы через /lore/slices +
 * query_slice (один путь чтения, паттерн MCPSYNC-01). Этот тест — гарантия,
 * что каждый слайс аналитики присутствует в ТОМ ЖЕ реестре, который отдаёт
 * каталог, и не требует параметров (агент не должен узнавать о слайсе случайно
 * или угадывать его сигнатуру).
 *
 * Чистый юнит: LoreSlices — статический реестр, Quarkus и БД не нужны.
 */
class LoreAnalyticsSliceRegistryTest {

    private static final List<String> ANALYTICS_SLICES = List.of(
        "feature_vp_analytics",  // AN-01: VP-fit по корням линейки
        "product_hygiene",       // AN-02: срез E — гигиена связок
        "strategic_coverage",    // AN-03: срез B — покрытие вехами
        "invest_profile"         // AN-04: срез D — инвестиционный профиль
    );

    @Test
    void everyAnalyticsSliceIsInTheSharedCatalog() {
        for (String id : ANALYTICS_SLICES) {
            assertTrue(LoreSlices.ids().contains(id),
                "слайс " + id + " обязан быть в реестре LoreSlices — его отдают "
                    + "и /lore/slices, и MCP query_slice");
            LoreSlices.SliceDef def = LoreSlices.get(id);
            assertNotNull(def, "определение слайса " + id);
            assertTrue(def.required().isEmpty(),
                "слайсы аналитики беспараметрические: required у " + id
                    + " обязан быть пуст, иначе каталог обещает не ту сигнатуру");
        }
    }
}
