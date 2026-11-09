package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MODEL-TYPES — раздел {@code types} модели:
 * граф (schema:types) + обогащение (LoreRecordRegistry). Тест-план задачи:
 * (1) поля типа совпадают с lore.record/1; (2) ни одного @-поля и system-поля;
 * (3) только в схеме → unclassified, только в обогащении → SUPPLIES;
 * (4) missing уменьшается, когда раздел есть.
 */
class LoreModelTypesTest {

    /** Подставная схема графа: свойства вершины и Hist задачи (+ системные и лишнее). */
    private static Map<String, List<String>> schema() {
        return Map.of(
            "KnowTask", List.of("task_uid", "task_id", "title", "status_raw", "order_index", "bookkeeping", "brand_new_prop"),
            "KnowTaskHist", List.of("state_uid", "valid_from", "valid_to", "content_hash", "status_raw", "note_md",
                "effort_days", "changed_by", "changed_by_kind"),
            "KnowSprint", List.of("sprint_id", "name"),
            "KnowSprintHist", List.of("state_uid", "valid_from", "valid_to", "status_raw", "priority", "context_md"),
            "KnowADR", List.of("adr_id", "name", "status"),
            "KnowADRHist", List.of("state_uid", "context_md", "decision_md"),
            "KnowSpec", List.of("spec_id", "title"),
            "KnowSpecHist", List.of("state_uid", "content_md", "status", "version"));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> type(Map<String, Object> types, String t) { return (Map<String, Object>) types.get(t); }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> fields(Map<String, Object> type) { return (List<Map<String, Object>>) type.get("fields"); }

    @Test
    @SuppressWarnings("unchecked")
    void fieldsMatchTheRecordContractForEveryType() {
        Map<String, Object> types = LoreModelTypes.build(schema());
        assertEquals(LoreRecordRegistry.TYPES, List.copyOf(types.keySet()));
        for (String t : LoreRecordRegistry.TYPES) {
            List<Map<String, Object>> contract = (List<Map<String, Object>>) LoreRecordRegistry.schemaJson(t).get("fields");
            assertEquals(contract.stream().map(f -> f.get("key")).toList(),
                fields(type(types, t)).stream().map(f -> f.get("key")).toList(), t + ": те же поля, что lore.record/1");
            for (Map<String, Object> f : fields(type(types, t))) assertEquals("visible", f.get("visibility"), t + "." + f.get("key"));
        }
        assertEquals("task_uid", type(types, "task").get("key"), "деловой ключ, не @rid");
    }

    @Test
    void noSystemFieldEverLeaves() {
        Map<String, Object> types = LoreModelTypes.build(schema());
        String s = types.toString();
        for (String sys : List.of("@rid", "valid_to", "state_uid", "content_hash"))
            assertFalse(s.contains(sys), "system-поле в модели: " + sys);
        assertNoAtKeys(types);
    }

    @Test
    @SuppressWarnings("unchecked")
    void schemaOnlyIsUnclassifiedAndEnrichmentOnlyIsSupplies() {
        Map<String, Object> task = type(LoreModelTypes.build(schema()), "task");
        List<String> unclassified = (List<String>) task.get("unclassified");
        assertTrue(unclassified.contains("brand_new_prop"), "новое свойство схемы без обогащения — unclassified: " + unclassified);
        assertFalse(unclassified.contains("status_raw"), "сопоставленное свойство не unclassified");
        List<String> internal = (List<String>) task.get("internal");
        assertTrue(internal.contains("bookkeeping") && internal.contains("changed_by"), "технические — internal: " + internal);
        Map<String, Object> status = fields(task).stream().filter(f -> "status".equals(f.get("key"))).findFirst().orElseThrow();
        assertEquals("CONFIRMS", status.get("source"), "status ↔ status_raw есть и в схеме");
        assertEquals("status_raw", status.get("property"));
        assertTrue(fields(task).stream().anyMatch(f -> "SUPPLIES".equals(f.get("source"))),
            "часть полей паспорта в подставной схеме не объявлена — SUPPLIES");
    }

    @Test
    void missingShrinksWhenTypesArePresent() {
        assertTrue(String.valueOf(LoreModel.build(List.of()).get("missing")).contains("types"));
        Map<String, Object> m = LoreModel.build(List.of(), schema());
        assertFalse(String.valueOf(m.get("missing")).contains("\"types\"") || ((List<?>) m.get("missing")).contains("types"),
            "раздел types есть — его нет в missing: " + m.get("missing"));
        assertTrue(m.containsKey("types"));
        assertNoAtKeys(m);
    }

    private static void assertNoAtKeys(Object o) {
        if (o instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> e : map.entrySet()) {
                assertFalse(String.valueOf(e.getKey()).startsWith("@"), "@-ключ: " + e.getKey());
                assertNoAtKeys(e.getValue());
            }
        } else if (o instanceof List<?> l) {
            for (Object x : l) assertNoAtKeys(x);
        }
    }
}
