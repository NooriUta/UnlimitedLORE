package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-03 — обратный импорт tag:* (OQ-062-TAG-REGISTRY-IMPORT): вершины KnowTag
 * и поля на их рёбрах TAGGED_WITH → виды tag:&lt;slug&gt;. Импорт «из графа в граф» (SPEC-MODEL-EXPORT-064 §3а.3):
 * строки — как их отдаёт чтение тегов (tag_id + поля по рёбрам), данные не мигрируются.
 */
class KnowRegistryTagImportTest {

    static List<Map<String, Object>> rows() {
        List<Map<String, Object>> rows = new ArrayList<>();
        rows.add(row("security-review", Map.of("reviewer", "agent-full", "verdict", "accepted"), Map.of("reviewer", "ann"), null));
        rows.add(row("customer-visible"));
        rows.add(row("breaking-change", Map.of("since", "1.18"), Map.of("since", "1.19")));
        rows.add(row("estimate", Map.of("points", "3"), Map.of("points", 5)));
        return rows;
    }

    @SafeVarargs
    static Map<String, Object> row(String tag, Map<String, Object>... edges) {
        Map<String, Object> r = new HashMap<>();
        r.put("tag_id", tag);
        List<Object> fl = new ArrayList<>();
        for (Map<String, Object> e : edges) fl.add(e);
        r.put("fl", fl);
        return r;
    }

    /** Покрытие: каждый тег справочника — вид tag:*, повторов нет. */
    @Test
    void everyTagOfTheDirectoryBecomesAKind() {
        List<Map<String, Object>> kinds = KnowRegistry.tagKinds(FieldDeclaredGuardTest.model(), rows(), AgentScopeFilter.FAMILY_AGENTS);
        assertEquals(List.of("tag:breaking-change", "tag:customer-visible", "tag:estimate", "tag:security-review"),
            kinds.stream().map(k -> k.get("kind")).toList());
    }

    @Test
    void fieldSchemaComesFromEdgesAndTypesAreInferred() {
        Map<String, Object> k = KnowRegistry.tagKinds(FieldDeclaredGuardTest.model(), rows(), AgentScopeFilter.FAMILY_AGENTS)
            .stream().filter(x -> "tag:security-review".equals(x.get("kind"))).findFirst().orElseThrow();
        assertEquals(Map.of("reviewer", Map.of("type", "string"), "verdict", Map.of("type", "string")), k.get("field_schema"));
        assertEquals(3, k.get("uses"));
        assertEquals("tag_id", k.get("id_field"));
        assertEquals(KnowRegistry.SOURCE_TAG, k.get("source"));
        // гейт MDL-05 тройки: поле тега — на ребре
        for (Map<String, Object> f : KnowRegistryGeneratorTest.fields(k)) {
            assertEquals("edge", f.get("layer"));
            assertEquals("TAGGED_WITH", f.get("rel"));
        }
        Map<String, Object> est = KnowRegistry.tagKinds(FieldDeclaredGuardTest.model(), rows(), AgentScopeFilter.FAMILY_AGENTS)
            .stream().filter(x -> "tag:estimate".equals(x.get("kind"))).findFirst().orElseThrow();
        assertEquals(Map.of("points", Map.of("type", "number")), est.get("field_schema"));
    }

    @Test
    void tagWithoutFieldsIsALegalDegenerateKind() {
        Map<String, Object> k = KnowRegistry.tagKinds(FieldDeclaredGuardTest.model(), rows(), AgentScopeFilter.FAMILY_AGENTS)
            .stream().filter(x -> "tag:customer-visible".equals(x.get("kind"))).findFirst().orElseThrow();
        assertEquals(Map.of(), k.get("field_schema"));
        assertEquals(List.of(), k.get("fields"));
    }

    @Test
    void renameGuardAndRolesAreCarried() {
        Map<String, Object> k = KnowRegistry.tagKinds(FieldDeclaredGuardTest.model(), rows(), AgentScopeFilter.FAMILY_AGENTS).get(0);
        assertTrue(KnowRegistryGeneratorTest.names(k, "guards", "name").containsAll(List.of("rename-guard", "tag-token")));
        assertEquals(List.of("architect", "developer", "full"), k.get("roles"));
    }

    /** «tag:x» и «x» — один вид; двойник в выдаче — отказ, а не тихое слияние (UNIQUE kind). */
    @Test
    void duplicateTagIdsAreRefused() {
        List<Map<String, Object>> rows = new ArrayList<>(rows());
        rows.add(row("tag:estimate"));
        IllegalStateException e = assertThrows(IllegalStateException.class,
            () -> KnowRegistry.tagKinds(FieldDeclaredGuardTest.model(), rows, AgentScopeFilter.FAMILY_AGENTS));
        assertTrue(e.getMessage().contains("tag:estimate"), e.getMessage());
    }
}
