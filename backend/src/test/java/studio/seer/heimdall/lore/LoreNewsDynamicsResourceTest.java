package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S7A_NEWS/S7A-11 — параметры GET /lore/news/v2/dynamics без БД.
 * Фильтры ленты по СОБЫТИЮ (автор, кто, вид, записи) к объёмным метрикам не применимы —
 * сервер называет их в {@code meta.ignored_filters}, а не молча игнорирует.
 */
class LoreNewsDynamicsResourceTest {

    @Test
    void фильтрыСобытия_названыНеприменимыми() {
        assertEquals(List.of("author", "who", "kind", "els"),
            LoreNewsV2Resource.dynamicsIgnoredFilters("agent", "Мара", "closed", "task:S/T-1"));
        assertEquals(List.of("who"), LoreNewsV2Resource.dynamicsIgnoredFilters(null, "Мара", " ", null));
        assertEquals(List.of(), LoreNewsV2Resource.dynamicsIgnoredFilters(null, null, null, null));
    }
}
