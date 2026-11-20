package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13 · Связь «зависит от» в модели и путях записи — без БД.
 *
 * <p>Одна связь DEPENDS_ON у задачи, спринта и вехи (у фазы своего паспорта нет — её зависимости видны на
 * другом конце и в срезе deps_of): другой конец — любой из четырёх типов ({@code targetType any}), свойства
 * ребра — вид (справочник {@code dependency_kind}) и причина, путь привязки — один обработчик.
 */
class LoreDependencyModelTest {

    private static LoreRecordRegistry.Relation rel(String type, String key) {
        return LoreRecordRegistry.get(type).relations().stream().filter(r -> r.key().equals(key)).findFirst()
            .orElseThrow(() -> new AssertionError(type + ": нет связи " + key));
    }

    @Test
    void dependsOnIsHistoric() {
        assertTrue(LoreEdgeHistory.historic("DEPENDS_ON"), "связь историчная — снятая зависимость закрывается, а не стирается");
        assertEquals("outE('DEPENDS_ON')[valid_to IS NULL].inV()", LoreEdgeHistory.out("DEPENDS_ON"));
    }

    @Test
    void taskSprintAndMilestoneCarryBothSidesWithKindAndReason() {
        for (String type : List.of("task", "sprint", "milestone")) {
            LoreRecordRegistry.Relation out = rel(type, "dependsOn"), in = rel(type, "blocks");
            assertEquals("DEPENDS_ON", out.rel());
            assertEquals("out", out.dir());
            assertEquals("in", in.dir());
            // владелица 20.11.2026: подписи «выровнять» — одни у всех типов
            assertEquals("Зависит от", out.label(), type);
            assertEquals("От неё зависят", in.label(), type);
            for (LoreRecordRegistry.Relation r : List.of(out, in)) {
                assertEquals("any", r.targetType(), type + "." + r.key() + ": другой конец — любой из четырёх типов");
                assertEquals("link_tab", r.place());
                assertEquals("association", r.relation());
                assertTrue(r.manageable(), type + "." + r.key() + ": путь привязки есть");
                assertEquals(List.of("kind", "reason"), r.props().stream().map(LoreRecordRegistry.EdgeProp::key).toList());
                assertEquals(LoreDependency.DICT, r.props().get(0).dict());
                assertNotNull(LoreRecordRelationRoutes.find(type, "DEPENDS_ON", r.dir()), type + ": маршрут " + r.dir());
                assertEquals(LoreRecordRelationRoutes.Handler.DEPENDS_ON, LoreRecordRelationRoutes.find(type, "DEPENDS_ON", r.dir()).handler());
            }
            assertTrue(LoreRecordRelationRoutes.find(type, "DEPENDS_ON", "in").reversed(), "«от неё зависят» — запись на другом конце");
        }
        assertEquals(LoreRecordRelationRoutes.Handler.ADR_DEPENDS_ON, LoreRecordRelationRoutes.find("adr", "DEPENDS_ON", "out").handler(),
            "ADR → ADR — свой путь, не зависимость планирования");
    }

    @Test
    void schemaCarriesEdgePropsForTheKit() {
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rels = (List<Map<String, Object>>) LoreRecordRegistry.schemaJson("task").get("relations");
        Map<String, Object> dep = rels.stream().filter(r -> "dependsOn".equals(r.get("key"))).findFirst().orElseThrow();
        @SuppressWarnings("unchecked") List<Map<String, Object>> props = (List<Map<String, Object>>) dep.get("props");
        assertEquals("kind", props.get(0).get("key"));
        assertEquals("Вид", props.get(0).get("label"));
        assertEquals("reason", props.get(1).get("key"));
        Map<String, Object> phase = rels.stream().filter(r -> "phase".equals(r.get("key"))).findFirst().orElseThrow();
        assertFalse(phase.containsKey("props"), "у связи без свойств ребра ключа нет");
    }

    @Test
    void dependencyLinksAreReadByEdgeWithTheirProps() {
        assertTrue(LoreRecordValues.readByEdge("task").contains("dependsOn"));
        assertTrue(LoreRecordValues.readByEdge("sprint").contains("blocks"), "у спринта — тоже по ребру, а не строкой sprint_tree");
        assertTrue(LoreRecordValues.readByEdge("milestone").contains("dependsOn"));
        String sql = LoreRecordEdgeLinks.sql("task", rel("task", "dependsOn"));
        assertTrue(sql.contains("outE('DEPENDS_ON')[valid_to IS NULL]"), sql);
        assertTrue(sql.contains("kind") && sql.contains("reason"), "свойства ребра читаются: " + sql);
        List<Map<String, Object>> links = LoreRecordEdgeLinks.links(rel("task", "dependsOn"), List.of(Map.of(
            "end_vertex", "KnowPhase", "end_id", "SPRINT_B/PHASE_1", "end_title", "Фаза", "kind", "hard", "reason", "ждём")), null);
        assertEquals(1, links.size());
        assertEquals("phase", links.get(0).get("type"));
        assertEquals(Map.of("kind", "hard", "reason", "ждём"), links.get(0).get("values"));
    }

    @Test
    void depsSlicesAreScopedByBothEnds() {
        for (String slice : List.of("deps", "deps_of")) {
            String scope = LoreSlices.PROJECT_SCOPED.get(slice);
            assertNotNull(scope, slice + " под проектным скоупом");
            assertEquals(2, scope.split("&").length, slice + ": видны оба конца — как у sprint_deps");
            assertTrue(scope.contains("@out.out('PART_OF').out('BELONGS_TO_PROJECT').slug"), "задача и фаза — через проект спринта");
            assertTrue(scope.contains("?@in.@type = 'KnowMilestone'"), "веха проекта не имеет — видна всем");
        }
        Map<String, String> p = Map.of("type", "task", "id", "SPRINT_A/T1");
        String sql = LoreSlices.compose("deps_of", p, java.util.Set.of("AIDA/UnlimitedLORE")).sql();
        assertTrue(sql.contains("valid_to IS NULL") && sql.contains("CONTAINS :__scope0"), sql);
        assertTrue(AidaLoreResource.HIDDEN_COUNTED.contains("deps"), "скрытые скоупом зависимости — числом");
    }

    @Test
    void phaseIsAKnownEndOfEdgeLinks() {
        assertEquals("phase", LoreRecordEdgeLinks.kindOf("KnowPhase", "SPRINT_B/PHASE_1"));
        assertTrue(LoreRecordEdgeLinks.ID_FIELDS.contains("phase_uid"));
    }
}
