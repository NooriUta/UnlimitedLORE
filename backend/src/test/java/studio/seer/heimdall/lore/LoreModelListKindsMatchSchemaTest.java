package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_WORK_ANY_KIND/WK-01 · сторож «поле-список в модели = LIST в схеме 1.18».
 *
 * <p>В 1.18 модель — источник схемы. Вид продукта — набор tech | service (ADR-LORE-044), перенос пишет
 * {@code KnowDictEntry.kind} списком (LIST), а модель описывала поле видом text — одно значение строкой.
 * Правило общее: поле, у которого в схеме переноса тип LIST, в модели — список ({@code multi: true});
 * и наоборот — несвязевое поле {@code multi} в схеме не строка. Связи (ref) сюда не входят: их значения —
 * рёбра, а не свойство.
 */
class LoreModelListKindsMatchSchemaTest {

    record Hit(String id, String kind, boolean multi, String property, String dbType) {}

    static List<Hit> hits() throws Exception {
        Map<String, Map<String, String>> schema = LoreModelDateKindsMatchSchemaTest.schema();
        List<Hit> out = new ArrayList<>();
        for (Map.Entry<String, LoreModelTypes.Graph> e : LoreModelTypes.GRAPH.entrySet()) {
            String t = e.getKey();
            LoreRecordRegistry.TypeDef def = LoreRecordRegistry.get(t);
            if (def == null) def = LoreRecordRegistry.childDef(t);
            if (def == null) continue;
            Map<String, String> props = LoreModelDateKindsMatchSchemaTest.propsOf(schema, e.getValue());
            for (LoreRecordRegistry.Field f : def.fields()) {
                if ("ref".equals(f.kind())) continue;
                Map<String, Object> fm = new HashMap<>();
                fm.put("key", f.key());
                if (f.write() != null && f.write().field() != null) fm.put("write", Map.of("field", f.write().field()));
                String prop = LoreModelTypes.propertyOf(t, fm, props.keySet());
                out.add(new Hit(t + "." + f.key(), f.kind(), f.multi(), prop, prop == null ? null : props.get(prop)));
            }
        }
        return out;
    }

    @Test
    void listPropertyIsMultiFieldInModel() throws Exception {
        List<String> bad = new ArrayList<>();
        for (Hit h : hits()) if ("LIST".equals(h.dbType()) && !h.multi())
            bad.add(h.id() + ": в схеме " + h.property() + " LIST, а в модели одно значение (" + h.kind() + ")");
        assertTrue(bad.isEmpty(), "список в схеме, но не список в модели:\n  " + String.join("\n  ", bad));
    }

    @Test
    void multiFieldIsNotAStringInSchema() throws Exception {
        List<String> bad = new ArrayList<>();
        for (Hit h : hits()) if (h.multi() && "STRING".equals(h.dbType()))
            bad.add(h.id() + ": в модели список, а в схеме " + h.property() + " STRING");
        assertTrue(bad.isEmpty(), "список в модели, но строка в схеме:\n  " + String.join("\n  ", bad));
    }

    /** Положительный контроль: вид продукта — набор и в модели, и в схеме переноса (вершина и версия). */
    @Test
    void productKindIsMultiEnumOverList() throws Exception {
        Hit k = hits().stream().filter(h -> h.id().equals("product.kind")).findFirst().orElseThrow();
        assertEquals("enum", k.kind(), "вид продукта — перечисление tech | service");
        assertTrue(k.multi(), "вид продукта — набор (multi)");
        assertEquals("LIST", k.dbType(), "в схеме переноса " + k.property());
        assertEquals("LIST", LoreModelDateKindsMatchSchemaTest.schema().get("KnowDictEntryHist").get("kind"), "версия хранит набор тоже");
    }

    /** Сверка модели и схемы базы (LoreModelConsistency): поле-список совместимо со свойством LIST, одиночное — нет. */
    @Test
    void consistencyAcceptsListForMultiFieldOnly() {
        assertTrue(LoreModelConsistency.compatible("enum", true, "LIST"));
        assertTrue(LoreModelConsistency.compatible("text", true, "LIST"));
        assertFalse(LoreModelConsistency.compatible("enum", false, "LIST"), "одно значение против списка — расхождение");
        assertFalse(LoreModelConsistency.compatible("enum", true, "STRING"), "набор против строки — расхождение");
        assertTrue(LoreModelConsistency.compatible("enum", false, "STRING"));
    }
}
