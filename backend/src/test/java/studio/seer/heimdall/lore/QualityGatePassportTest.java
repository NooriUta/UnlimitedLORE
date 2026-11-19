package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MD-04, «второй заход» по QG — паспорт v2 гейта качества
 * (quality_gate, вершина QualityGate). До него гейт был виден только на странице QG v1 и в поиске:
 * recordHref('quality_gate') давал null, а тип в lore-model.json не описан вовсе.
 *
 * <p>Повод — SPRINT_QG_REBUILD (ADR-LORE-053, D7): у гейта появляются состояния жизненного цикла
 * draft / active / stale / retired, владелец-проект ребром BELONGS_TO_PROJECT и два поля снятия —
 * {@code retired_at} (ставит путь записи) и {@code retired_reason}. Их пишет код, значит они обязаны
 * быть объявлены в модели (правило двух слоёв), иначе поле живёт только в данных.
 *
 * <p>Только чтение: гейт пишется своим путём POST /lore/quality-gate (MCP qg_new), у фасада путей
 * записи нет.
 */
class QualityGatePassportTest {

    static final String T = "quality_gate";

    @Test
    void typeIsAReadOnlyPassport() {
        assertTrue(LoreRecordRegistry.TYPES.contains(T), "нет паспорта v2 гейта качества");
        assertTrue(LoreRecordRegistry.READ_ONLY.contains(T), "путей записи у фасада нет — только чтение");
        assertEquals("project", LoreRecordRegistry.TYPES.get(LoreRecordRegistry.TYPES.size() - 1), "проект — последним");
    }

    @Test
    void sourceIsOneRowByBusinessKey() {
        LoreRecordResource.Source s = LoreRecordResource.sourceOf(T);
        assertNotNull(s);
        assertEquals("quality_gate_by_id", s.slice());
        LoreSlices.SliceDef d = LoreSlices.get(s.slice());
        assertNotNull(d);
        assertEquals(List.of(s.param()), d.required());
        assertTrue(d.baseSql().contains("FROM QualityGate"), d.baseSql());
    }

    /** Поля жизненного цикла (ADR-LORE-053 D7) доходят до паспорта: срез их отдаёт, а не теряет. */
    @Test
    void sliceCarriesLifecycleAndOwner() {
        String sql = LoreSlices.get("quality_gate_by_id").baseSql();
        for (String col : List.of("status", "retired_at", "retired_reason", "last_run_status"))
            assertTrue(sql.contains(col), "quality_gate_by_id не отдаёт " + col + ": " + sql);
        assertTrue(sql.contains("out('BELONGS_TO_PROJECT').slug AS projects"),
            "владелец гейта — проект ребром BELONGS_TO_PROJECT, а не строковым полем: " + sql);
        assertTrue(sql.contains("out('BELONGS_TO').component_id AS components"),
            "компонент — связью, списком: " + sql);
    }

    @Test
    void graphKnowsTheVertexAndKey() {
        LoreModelTypes.Graph g = LoreModelTypes.GRAPH.get(T);
        assertNotNull(g, "без вершины вкладки по ребру не читаются");
        assertEquals("QualityGate", g.vertex());
        assertEquals("qg_id", g.key());
    }

    /** Модель объявляет поля, которые пишет код: статус со словарём qg_status и оба поля снятия. */
    @Test
    @SuppressWarnings("unchecked")
    void modelDeclaresLifecycleFields() {
        Map<String, Map<String, Object>> fields = fieldsOf(T);
        assertEquals("qg_status", fields.get("status").get("dict"), "статус гейта — из словаря qg_status");
        assertEquals("date", fields.get("retired_at").get("kind"));
        assertEquals("text", fields.get("retired_reason").get("kind"));
        for (String key : List.of("projects", "components"))
            assertEquals("ref", fields.get(key).get("kind"), key + " — связью, не строкой");
        assertEquals("BELONGS_TO_PROJECT", ((Map<String, Object>) fields.get("projects").get("ref")).get("rel"));
        assertEquals("BELONGS_TO", ((Map<String, Object>) fields.get("components").get("ref")).get("rel"));
    }

    /**
     * SPRINT_QG_REBUILD/QG-01, решение владелицы 19.11.2026 «2а»: признак scope = global | project.
     * Его пишет путь записи гейта — значит, он объявлен в модели (правило двух слоёв) и доходит до
     * паспорта и списка.
     */
    @Test
    void modelAndSlicesCarryScope() {
        Map<String, Map<String, Object>> fields = fieldsOf(T);
        assertNotNull(fields.get("scope"), "признака общий/проектный нет в модели гейта");
        assertEquals("enum", fields.get("scope").get("kind"));
        for (String slice : List.of("quality_gates", "quality_gate_by_id"))
            assertTrue(LoreSlices.get(slice).baseSql().contains(" scope"), slice + " не отдаёт scope");
    }

    /**
     * Повод решения: проектный скоуп прятал общий гейт от участника другого проекта. Под скоупом
     * гейт виден, если он общий ИЛИ хотя бы один его проект разрешён.
     */
    @Test
    void globalGateIsVisibleUnderAnyProjectScope() {
        for (String slice : List.of("quality_gates", "quality_gate_by_id")) {
            assertTrue(LoreSlices.PROJECT_SCOPED.containsKey(slice), slice + " не под проектным скоупом");
            assertFalse(LoreSlices.SCOPE_PENDING.containsKey(slice), slice + " всё ещё в списке «скоуп не решён»");
            java.util.Map<String, String> given = new java.util.HashMap<>();
            for (String r : LoreSlices.get(slice).required()) given.put(r, "x");
            String sql = LoreSlices.compose(slice, given, java.util.Set.of("org/a")).sql();
            assertTrue(sql.contains("scope = 'global'"), "общий гейт отрезан скоупом: " + sql);
            assertTrue(sql.contains("out('BELONGS_TO_PROJECT').slug CONTAINS :__scope0"), sql);
        }
    }

    /** Гейт — в общем меню, в группе «Работа», после релизов. */
    @Test
    void gateIsAWorkSection() {
        List<String> nav = LoreModelNavTest.navSections(LoreModelGoldenTest.modelDoc());
        assertTrue(nav.contains(T), "раздела «Гейты качества» нет в меню: " + nav);
        assertEquals("everywhere", LoreModelFile.content().audience().get(T));
    }

    /**
     * Гейт как конец ребра (ссылка из другого паспорта): вид — quality_gate, а код — qg_id. У гейта
     * есть строковое поле sprint_id, и при прежнем порядке ключей он назывался бы кодом спринта.
     */
    @Test
    void gateAsEdgeEndIsNamedByItsOwnKey() {
        assertEquals("quality_gate", LoreRecordEdgeLinks.kindOf("QualityGate", "QG-LORE-SCHEMA"));
        List<String> ids = LoreRecordEdgeLinks.ID_FIELDS;
        assertTrue(ids.contains("qg_id"), "qg_id не читается у конца ребра");
        assertTrue(ids.indexOf("qg_id") < ids.indexOf("sprint_id"),
            "qg_id должен идти раньше sprint_id: иначе гейт назван кодом своего спринта");
        assertEquals("sprint", LoreRecordEdgeLinks.kindOf("KnowSprint", "SPRINT_X"), "положительный контроль");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Map<String, Object>> fieldsOf(String type) {
        Map<String, Object> doc = LoreModelGoldenTest.modelDoc();
        Map<String, Map<String, Object>> out = new java.util.LinkedHashMap<>();
        Map<String, Object> t = ((Map<String, Map<String, Object>>) doc.get("types")).get(type);
        assertNotNull(t, "типа " + type + " нет в модели /lore/model");
        for (Map<String, Object> f : (List<Map<String, Object>>) t.get("fields")) out.put((String) f.get("key"), f);
        assertFalse(out.isEmpty(), "типа " + type + " нет в lore-model.json");
        return out;
    }
}
