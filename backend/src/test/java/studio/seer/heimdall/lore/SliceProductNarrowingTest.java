package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_PROJECT_SCOPE/PS-PRODUCT-FILTER (владелица 21.11.2026): «считаем продукт логической группировкой проектов;
 * на верхний фильтр выносим продукт — фильтр по продукту делаем для бэка». {@code ?scope_products=} раскрывается в
 * проекты продуктов и дальше идёт тем же путём, что {@code ?scope_projects=} (сужает, но не расширяет права).
 */
class SliceProductNarrowingTest {

    static final Map<String, List<String>> PROJECTS_OF = Map.of(
        "HARPA", List.of("AIDA/core-services", "NooriUta/UnlimitedLORE"),
        "HEIMDALL", List.of("NooriUta/AIDA"),
        "OMILORE", List.of("NooriUta/UnlimitedLORE"),
        "FREYJA", List.of());

    static Map<String, String> given(String... kv) {
        Map<String, String> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put(kv[i], kv[i + 1]);
        return m;
    }

    @Test
    void productBecomesItsProjects() {
        Map<String, String> g = given("scope_products", "HARPA");
        Map<String, Object> meta = SliceProjectNarrowing.expandProducts(g, PROJECTS_OF);
        assertFalse(g.containsKey("scope_products"), "параметр продуктов вынут — срез его не знает");
        assertEquals("AIDA/core-services,NooriUta/UnlimitedLORE", g.get("scope_projects"));
        assertEquals(List.of("HARPA"), meta.get("products"));
    }

    @Test
    void severalProductsUnionWithoutDuplicates() {
        Map<String, String> g = given("scope_products", "HARPA,OMILORE");
        SliceProjectNarrowing.expandProducts(g, PROJECTS_OF);
        assertEquals("AIDA/core-services,NooriUta/UnlimitedLORE", g.get("scope_projects"));
    }

    @Test
    void withProjectsChosenTooItIsIntersection() {
        Map<String, String> g = given("scope_products", "HARPA", "scope_projects", "NooriUta/UnlimitedLORE,NooriUta/AIDA");
        SliceProjectNarrowing.expandProducts(g, PROJECTS_OF);
        assertEquals("NooriUta/UnlimitedLORE", g.get("scope_projects"));
    }

    @Test
    void productWithoutProjectsIsHonestlyEmptyNotEverything() {
        Map<String, String> g = given("scope_products", "FREYJA");
        Map<String, Object> meta = SliceProjectNarrowing.expandProducts(g, PROJECTS_OF);
        assertEquals(SliceProjectNarrowing.NO_PROJECT, g.get("scope_projects"), "у продукта нет проектов — пусто по выбору, а не всё");
        assertEquals(List.of("FREYJA"), meta.get("without_projects"));
    }

    @Test
    void unknownProductIsNamed() {
        Map<String, String> g = given("scope_products", "NOPE,HEIMDALL");
        Map<String, Object> meta = SliceProjectNarrowing.expandProducts(g, PROJECTS_OF);
        assertEquals("NooriUta/AIDA", g.get("scope_projects"));
        assertEquals(List.of("NOPE"), meta.get("unknown"));
    }

    @Test
    void noParamNoChange() {
        Map<String, String> g = given("x", "1");
        assertNull(SliceProjectNarrowing.expandProducts(g, PROJECTS_OF));
        assertEquals(Set.of("x"), g.keySet());
    }

    @Test
    void expandedThenNarrowedByRights() {
        Map<String, String> g = given("scope_products", "HARPA");
        SliceProjectNarrowing.expandProducts(g, PROJECTS_OF);
        SliceProjectNarrowing.Result r = SliceProjectNarrowing.apply("sprints", g, Set.of("NooriUta/UnlimitedLORE"));
        assertEquals(Set.of("NooriUta/UnlimitedLORE"), r.scope());
        assertEquals(List.of("AIDA/core-services"), r.meta().get("dropped"));
    }
}
