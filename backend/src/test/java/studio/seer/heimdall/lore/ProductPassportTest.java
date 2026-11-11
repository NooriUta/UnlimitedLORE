package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S4_UI_SHELL_LISTS/S4-PRODUCTS-NODE (дописка владелицы 11.11: «добавь ещё паспорт и
 * объект»): продукт — полноценный тип паспорта v2. Продукт — статья словаря
 * ({@code KnowDictEntry dict_type='product'}), ключ — код. Шапка: код, название, цвет (из данных,
 * не выдуман). Вкладки: Компоненты (IN_PRODUCT) · Фичи и сценарии · Боли · Выгоды · Работы ·
 * Роли — всё через компоненты продукта (продукт ← компонент ← сценарий → боль/выгода/работа/роль),
 * тем же путём, что product_sprints. Своих рёбер к болям и ролям у продукта нет — и не выдумано.
 */
class ProductPassportTest {

    private static final List<String> TABS =
        List.of("components", "features", "pains", "gains", "jobs", "actors", "children");

    @Test
    void productIsAPassportTypeReadOnly() {
        assertTrue(LoreRecordRegistry.TYPES.contains("product"), "тип product не заведён");
        assertTrue(LoreRecordRegistry.READ_ONLY.contains("product"), "путей записи у продукта в фасаде нет");
        Map<String, Object> s = LoreRecordRegistry.schemaJson("product");
        assertNotNull(s);
        @SuppressWarnings("unchecked") List<Map<String, Object>> fields = (List<Map<String, Object>>) s.get("fields");
        List<String> head = new ArrayList<>();
        for (Map<String, Object> f : fields) {
            assertEquals(false, f.get("editable"), "product." + f.get("key") + " не правится");
            if ("head".equals(f.get("group"))) head.add((String) f.get("key"));
        }
        assertEquals(List.of("title", "code", "color"), head, "шапка: название, код, цвет");
    }

    @Test
    void sourceSliceAndGraph() {
        LoreRecordResource.Source src = LoreRecordResource.sourceOf("product");
        assertNotNull(src);
        assertEquals("product_by_id", src.slice());
        LoreSlices.SliceDef d = LoreSlices.get("product_by_id");
        assertNotNull(d, "срез product_by_id не зарегистрирован");
        assertEquals(List.of(src.param()), d.required());
        String sql = d.baseSql();
        assertTrue(sql.contains("FROM KnowDictEntry") && sql.contains("dict_type = 'product'")
            && sql.contains("code = :" + src.param()), sql);
        assertTrue(sql.contains("color") && sql.contains("in('IN_PRODUCT').component_id"), sql);
        assertTrue(LoreSlices.SHARED_SLICES.containsKey("product_by_id"), "продукты — общий справочник, как products");
        LoreModelTypes.Graph g = LoreModelTypes.GRAPH.get("product");
        assertNotNull(g);
        assertEquals("KnowDictEntry", g.vertex());
        assertEquals("code", g.key());
        assertFalse(LoreModelTypes.TYPE_COLOR.containsKey("product"));
        assertTrue(LoreModelTypes.NO_TYPE_COLOR.contains("product"), "канона --section-products в v1 нет");
    }

    @Test
    void valuesFromProductRow() {
        Map<String, Object> row = new HashMap<>();
        row.put("code", "LORE");
        row.put("label_ru", "Лор");
        row.put("label_en", "Lore");
        row.put("color", "#E0A13D");
        row.put("icon", "compass");
        row.put("is_active", true);
        row.put("parent_code", List.of("AIDA"));
        row.put("components", List.of("HND", "SEIDRKIT"));
        row.put("git_projects", List.of("AIDA/UnlimitedLORE"));
        Map<String, Object> v = LoreRecordValues.values("product", row);
        assertEquals("Лор", v.get("title"));
        assertEquals("LORE", v.get("code"));
        assertEquals("#E0A13D", v.get("color"), "цвет — из данных продукта");
        assertEquals("AIDA", v.get("parent"));
        assertEquals(List.of("HND", "SEIDRKIT"), v.get("components"));
        assertEquals(List.of("AIDA/UnlimitedLORE"), v.get("projects"));
        row.remove("label_ru");
        row.remove("color");
        Map<String, Object> v2 = LoreRecordValues.values("product", row);
        assertEquals("LORE", v2.get("title"), "без подписи — код");
        assertNull(v2.get("color"), "нет цвета — null, не выдуман");
    }

    @Test
    void componentsAreRowLinksBothEnds() {
        Map<String, Object> row = Map.of("components", List.of("HND"), "sub_products", List.of("LORE-MOBILE"));
        List<Map<String, Object>> got = LoreRecordValues.rowLinks("product", row);
        assertEquals(List.of("IN_PRODUCT/in/component/HND", "PARENT_PRODUCT/in/product/LORE-MOBILE"),
            got.stream().map(m -> m.get("rel") + "/" + m.get("dir") + "/" + m.get("type") + "/" + m.get("id")).toList());
        // Обратная сторона: компонент показывает свой продукт полем-ссылкой и связью.
        LoreRecordRegistry.TypeDef c = LoreRecordRegistry.get("component");
        LoreRecordRegistry.Field f = c.field("products");
        assertNotNull(f, "у компонента нет поля «Продукты» — IN_PRODUCT не виден");
        assertEquals(List.of("product", "IN_PRODUCT", "out"), List.of(f.refType(), f.rel(), f.dir()));
        assertTrue(LoreSlices.get("component").baseSql().contains("out('IN_PRODUCT').code"), "срез component читает продукты");
        assertTrue(LoreSlices.get("components").baseSql().contains("out('IN_PRODUCT').code AS products"),
            "список компонентов несёт продукты — по ним v2 красит записи цветом продукта");
        assertEquals(List.of("LORE"), LoreRecordValues.values("component",
            Map.of("component_id", "HND", "products", List.of("LORE"))).get("products"), "значение поля «Продукты»");
        List<Map<String, Object>> cl = LoreRecordValues.rowLinks("component", Map.of("products", List.of("LORE")));
        assertTrue(cl.stream().anyMatch(m -> "IN_PRODUCT".equals(m.get("rel")) && "product".equals(m.get("type"))
            && "LORE".equals(m.get("id"))), cl.toString());
    }

    @Test
    void tabsReadBySlicesThroughProductComponents() {
        LoreRecordRegistry.TypeDef d = LoreRecordRegistry.get("product");
        for (String k : TABS) {
            LoreRecordRegistry.Relation r = d.relations().stream().filter(x -> x.key().equals(k)).findFirst().orElse(null);
            assertNotNull(r, "у паспорта продукта нет вкладки " + k);
            assertEquals("link_tab", r.place(), k);
            assertFalse(r.manageable(), k);
        }
        Map<String, String> want = new LinkedHashMap<>();
        for (String k : List.of("features", "pains", "gains", "jobs", "actors")) want.put(k, "product_" + k);
        assertEquals(want, LoreRecordValues.READ_BY_SLICE.get("product"));
        for (String k : want.keySet()) {
            String id = "product_" + k;
            LoreSlices.SliceDef def = LoreSlices.get(id);
            assertNotNull(def, "среза " + id + " нет");
            assertEquals(List.of("code"), def.required(), id);
            String sql = (def.baseSql() + " " + def.suffix()).replaceAll("\\s+", " ");
            assertFalse(sql.toUpperCase().contains("LIMIT"), id + ": молчаливый потолок");
            assertTrue(sql.toUpperCase().contains("ORDER BY"), id + ": без порядка страницы не стыкуются");
            assertTrue(sql.contains("out('BELONGS_TO').out('IN_PRODUCT').code CONTAINS :code"),
                id + ": путь через компоненты продукта, как product_sprints: " + sql);
            assertTrue(LoreSlices.SHARED_SLICES.containsKey(id) ^ LoreSlices.PROJECT_SCOPED.containsKey(id), id);
        }
        for (LoreRecordFrom.SliceLink sl : LoreRecordFrom.SLICE_LINKS.get("product")) {
            assertTrue(sl.paged(), sl.key());
            assertEquals("code", sl.param(), sl.key());
        }
    }

    @Test
    void surfaceOrder() {
        @SuppressWarnings("unchecked") Map<String, Object> t = (Map<String, Object>) LorePassportSurface.build().get("product");
        assertEquals(true, t.get("decided"));
        @SuppressWarnings("unchecked") List<Map<String, Object>> sections = (List<Map<String, Object>>) t.get("sections");
        List<String> keys = new ArrayList<>();
        for (Map<String, Object> m : sections) keys.add((String) m.get("key"));
        assertEquals(TABS, keys, "Компоненты · Фичи и сценарии · Боли · Выгоды · Работы · Роли · Подпродукты");
    }
}
