package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Реестр раскладок типов lore.record/1 (SPEC-LORE-UXR-RECORD-CONTRACT 0.3, ADR-LORE-047,
 * D-2026-LORE-RECORD-LAYOUT-V03). Вид связи у ребра — ровно из
 * DOC-LORE-RECORD-RELATIONS-ADR-SPEC-TASK (D-2026-LORE-RECORD-RELATION-UML).
 *
 * Чистый юнит: реестр статический, Quarkus и БД не нужны.
 */
class LoreRecordRegistryTest {

    private static LoreRecordRegistry.TypeDef def(String type) {
        LoreRecordRegistry.TypeDef d = LoreRecordRegistry.get(type);
        assertNotNull(d, "тип " + type + " обязан быть в реестре");
        return d;
    }

    /** «REL:dir=relation» по всем рёбрам типа — для сверки с таблицей документа. */
    private static Set<String> relations(String type) {
        return def(type).relations().stream()
            .map(r -> r.rel() + ":" + r.dir() + "=" + r.relation())
            .collect(Collectors.toCollection(java.util.TreeSet::new));
    }

    @Test
    void typesNowAreSprintTaskAdrSpec() {
        assertEquals(List.of("sprint", "task", "adr", "spec"), LoreRecordRegistry.TYPES);
        assertNull(LoreRecordRegistry.get("decision"), "решение — позже (A6), сейчас его в реестре нет");
    }

    @Test
    void taskEdgesClassifiedExactlyAsInDoc() {
        Set<String> want = Set.of(
            "PART_OF:out=composition", "IN_PHASE:out=attribute", "TAGGED_WITH:out=attribute",
            "ROLE_HELD_BY:out=attribute", "EDITED_IN:in=attribute", "CLOSED_BY:out=realization",
            "REALIZES:out=realization", "JUSTIFIED_BY:out=realization", "PROMOTED_TO:in=realization",
            "LED_TO:in=realization", "GATES:in=association", "REFERENCES:out=association",
            "REFERENCES:in=association", "PRODUCED_BY:in=association", "RAISED_IN:in=aggregation",
            "HAS_STATE:out=composition", "ATTACHED_TO:in=composition");
        assertEquals(new java.util.TreeSet<>(want), relations("task"));
    }

    @Test
    void adrEdgesClassifiedExactlyAsInDoc() {
        Set<String> want = Set.of(
            "DECIDED_IN:in=aggregation", "RAISED_IN:in=aggregation",
            "DEPENDS_ON:out=association", "DEPENDS_ON:in=association",
            "SUPERSEDES:out=association", "SUPERSEDES:in=association",
            "REFERENCES_ADR:in=association", "REFERENCES:out=association", "REFERENCES:in=association",
            "BELONGS_TO:out=attribute", "BELONGS_TO_PROJECT:out=attribute", "TAGGED_WITH:out=attribute",
            "IMPLEMENTED_IN:out=realization", "IMPLEMENTED_IN_RELEASE:out=realization",
            "JUSTIFIED_BY:in=realization", "TRACED_TO:in=realization", "LED_TO:in=realization",
            "HAS_STATE:out=composition", "ATTACHED_TO:in=composition");
        assertEquals(new java.util.TreeSet<>(want), relations("adr"));
    }

    @Test
    void specEdgesClassifiedExactlyAsInDoc() {
        Set<String> want = Set.of(
            "DOCUMENTED_IN:in=attribute", "BELONGS_TO:out=attribute", "BELONGS_TO_PROJECT:out=attribute",
            "REFERENCES:out=association", "REFERENCES:in=association",
            "HAS_STATE:out=composition", "ATTACHED_TO:in=composition");
        assertEquals(new java.util.TreeSet<>(want), relations("spec"));
        assertTrue(def("spec").parts().isEmpty(), "у спеки нет parts (документ: «всё, кроме текста и Истории, — props и Зависимости»)");
    }

    @Test
    void sprintTasksAndPhasesAreCompositionParts() {
        LoreRecordRegistry.TypeDef s = def("sprint");
        Map<String, LoreRecordRegistry.Part> parts = s.parts().stream()
            .collect(Collectors.toMap(LoreRecordRegistry.Part::key, p -> p));
        assertEquals(Set.of("phases", "tasks"), parts.keySet());
        for (LoreRecordRegistry.Part p : parts.values()) {
            assertEquals("composition", p.relation(), p.key());
            assertEquals("strict", p.owned(), p.key());
            assertEquals("PART_OF", p.rel(), p.key());
            assertEquals("in", p.dir(), p.key());
        }
        assertEquals("order_index", parts.get("tasks").orderBy());
        assertEquals("task", parts.get("tasks").type());
        assertEquals("phase", parts.get("phases").type());
    }

    @Test
    void sprintDependsOnIsAssociationTabBothDirectionsWithKindAndReason() {
        LoreRecordRegistry.LinkTab deps = def("sprint").linkTabs().stream()
            .filter(t -> t.key().equals("deps")).findFirst().orElseThrow();
        assertEquals("Зависимости", deps.label());
        assertEquals(2, deps.rels().size());
        Map<String, LoreRecordRegistry.TabRel> byDir = deps.rels().stream()
            .collect(Collectors.toMap(LoreRecordRegistry.TabRel::dir, r -> r));
        assertEquals("зависит от", byDir.get("out").label());
        assertEquals("блокирует", byDir.get("in").label());
        for (LoreRecordRegistry.TabRel r : deps.rels()) {
            assertEquals("DEPENDS_ON", r.rel());
            assertEquals("association", r.relation());
            assertEquals(List.of("kind", "reason"), r.edgeProps());
        }
    }

    @Test
    void sprintAttributeEdgesLiveInProps() {
        LoreRecordRegistry.TypeDef s = def("sprint");
        Set<String> propKeys = s.props().stream().flatMap(p -> p.fields().stream()).collect(Collectors.toSet());
        for (String key : List.of("components", "projects", "releases", "milestones")) {
            assertTrue(propKeys.contains(key), "props спринта обязаны нести " + key + ": " + propKeys);
            LoreRecordRegistry.Field f = s.field(key);
            assertEquals("attribute", f.relation(), key);
            assertEquals("ref", f.kind(), key);
            assertTrue(f.multi(), key);
        }
        Set<String> sections = s.props().stream().map(LoreRecordRegistry.PropSection::section)
            .filter(java.util.Objects::nonNull).collect(Collectors.toSet());
        assertTrue(sections.containsAll(Set.of("Планирование", "Модули")), "разделы спринта: " + sections);
    }

    @Test
    void adrHasThreeBodySectionsEachItsOwnAdrSetField() {
        List<LoreRecordRegistry.Body> body = def("adr").body();
        assertEquals(List.of("context_md", "decision_md", "consequences_md"),
            body.stream().map(LoreRecordRegistry.Body::key).toList());
        for (LoreRecordRegistry.Body b : body) {
            assertTrue(b.editable(), b.key());
            assertEquals("/lore/adr", b.write().endpoint(), b.key());
            assertEquals(b.key(), b.write().field(), "каждый раздел пишется своим полем adr_set: " + b.key());
        }
        assertEquals(List.of("context_md", "outcome_md"),
            def("sprint").body().stream().map(LoreRecordRegistry.Body::key).toList());
    }

    @Test
    void taskPropSectionsAndDictionaries() {
        LoreRecordRegistry.TypeDef t = def("task");
        Set<String> sections = t.props().stream().map(LoreRecordRegistry.PropSection::section)
            .filter(java.util.Objects::nonNull).collect(Collectors.toSet());
        assertTrue(sections.containsAll(Set.of("Роли", "Оценка", "Классы")), "разделы задачи: " + sections);
        assertEquals("task_type", t.field("task_type").dict());
        assertEquals("work_class", t.field("work_class").dict());
        assertEquals("task_status", t.field("status").dict());
        assertEquals("sprint_status", def("sprint").field("status").dict());
        assertEquals("priority", def("sprint").field("priority").dict());
        assertEquals("enum", t.field("task_type").kind());
    }

    @Test
    void everyPropAndColumnPointsAtAFieldOfItsType() {
        for (String type : LoreRecordRegistry.TYPES) {
            LoreRecordRegistry.TypeDef d = def(type);
            for (LoreRecordRegistry.PropSection s : d.props())
                for (String k : s.fields())
                    assertNotNull(d.field(k), type + ": prop «" + k + "» без поля в реестре");
            for (LoreRecordRegistry.Part p : d.parts()) {
                LoreRecordRegistry.TypeDef child = LoreRecordRegistry.childDef(p.type());
                assertNotNull(child, type + "." + p.key() + ": нет описания типа ребёнка " + p.type());
                List<String> all = new java.util.ArrayList<>(p.columns());
                all.addAll(p.optionalColumns());
                for (String c : all)
                    assertNotNull(child.field(c), type + "." + p.key() + ": колонка «" + c + "» не из реестра " + p.type());
            }
        }
    }

    @Test
    void sprintTreePhasesThenTasksPlusOutsidePhasesBranch() {
        LoreRecordRegistry.TypeDef s = def("sprint");
        List<LoreRecordRegistry.TreeNode> tree = s.tree();
        assertEquals(2, tree.size());
        assertEquals("phases", tree.get(0).part());
        assertEquals("tasks", tree.get(0).children().get(0).part());
        assertEquals("phase_uid", tree.get(0).children().get(0).groupBy());
        assertEquals("tasks", tree.get(1).part());
        assertEquals("вне фаз", tree.get(1).label());
        assertEquals(List.of("status", "task_type", "code", "title", "executor", "effort"),
            tree.get(1).columns());
        assertEquals(Set.of("work_class", "author", "reviewer", "actual", "realizes_uc", "prs"),
            new HashSet<>(tree.get(1).optionalColumns()));
    }

    @Test
    void schemaJsonCarriesLayoutAndRelations() {
        Map<String, Object> js = LoreRecordRegistry.schemaJson("adr");
        assertEquals("adr", js.get("type"));
        @SuppressWarnings("unchecked") Map<String, Object> layout = (Map<String, Object>) js.get("layout");
        assertTrue(layout.keySet().containsAll(Set.of("body", "props", "parts", "link_tabs", "tree")), layout.keySet().toString());
        assertFalse(((List<?>) js.get("fields")).isEmpty());
        assertFalse(((List<?>) js.get("relations")).isEmpty());
        assertNull(LoreRecordRegistry.schemaJson("nope"));
    }
}
