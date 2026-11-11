package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-06 · decision:D-2026-UXR-LINK-MENTION-EDGE.
 *
 * <p>«Связать» из упоминаний предлагает СУЩЕСТВУЮЩИЕ типы рёбер, допустимые для
 * пары сущностей; общий {@code REFERENCES} — запасной вариант. Каталог чистый
 * (без БД), поэтому его правила проверяются здесь, а запись — в live-DB тесте.
 */
class LoreLinkTypesTest {

    @Test
    void typedOptionsForAdrAndSprintComeFirstAndFallbackIsReferences() {
        List<LoreLinkTypes.Option> opts = LoreLinkTypes.optionsFor("adr", "sprint");
        assertTrue(opts.stream().anyMatch(o -> o.edgeType().equals("IMPLEMENTED_IN")
                && o.fromType().equals("adr") && o.toType().equals("sprint") && !o.fallback()),
            "ADR → спринт: IMPLEMENTED_IN обязан быть среди типизированных: " + opts);
        LoreLinkTypes.Option last = opts.get(opts.size() - 1);
        assertEquals("REFERENCES", last.edgeType(), "запасной тип — последним");
        assertTrue(last.fallback());
        assertEquals("adr", last.fromType(), "REFERENCES идёт от упоминающего к упомянутому");
        assertEquals("sprint", last.toType());
        assertEquals(1, opts.stream().filter(LoreLinkTypes.Option::fallback).count());
    }

    /**
     * Упоминание бывает с любой стороны: спринт упоминает ADR, а типизированное
     * ребро всё равно ADR → спринт. Вариант приходит развёрнутым, с явным
     * направлением — UI не догадывается, откуда куда.
     */
    @Test
    void reverseDirectionIsOfferedWithExplicitEnds() {
        List<LoreLinkTypes.Option> opts = LoreLinkTypes.optionsFor("sprint", "adr");
        LoreLinkTypes.Option impl = opts.stream()
            .filter(o -> o.edgeType().equals("IMPLEMENTED_IN")).findFirst().orElse(null);
        assertNotNull(impl, "развёрнутая пара тоже предлагает IMPLEMENTED_IN: " + opts);
        assertEquals("adr", impl.fromType());
        assertEquals("sprint", impl.toType());
        assertTrue(impl.reversed());
        LoreLinkTypes.Option fb = opts.get(opts.size() - 1);
        assertEquals("sprint", fb.fromType(), "запасной — всё равно от упоминающего");
        assertFalse(fb.reversed());
    }

    @Test
    void canonicalPairsFromTheTaskAreCovered() {
        // задача ↔ ADR, фича ↔ боль (фича — KnowUseCase после PL-28), решение → ADR
        assertTrue(LoreLinkTypes.isAllowed("task", "adr", "JUSTIFIED_BY"));
        assertTrue(LoreLinkTypes.isAllowed("use_case", "pain", "ADDRESSES"));
        assertTrue(LoreLinkTypes.isAllowed("use_case", "pain", "RELIEVES"));
        assertTrue(LoreLinkTypes.isAllowed("decision", "adr", "DECIDED_IN"));
        assertTrue(LoreLinkTypes.isAllowed("task", "use_case", "REALIZES"));
        assertTrue(LoreLinkTypes.isAllowed("runbook", "adr", "REFERENCES_ADR"));
    }

    @Test
    void directionMatters() {
        assertFalse(LoreLinkTypes.isAllowed("adr", "task", "JUSTIFIED_BY"),
            "JUSTIFIED_BY — задача → ADR, обратное направление ломает читателей-слайсы");
    }

    @Test
    void referencesIsAllowedForAnyKnownPairButNotSelfTypeUnknown() {
        assertTrue(LoreLinkTypes.isAllowed("pain", "release", "REFERENCES"));
        assertTrue(LoreLinkTypes.isAllowed("doc", "doc", "REFERENCES"));
        assertFalse(LoreLinkTypes.isAllowed("bogus", "adr", "REFERENCES"));
        assertTrue(LoreLinkTypes.optionsFor("bogus", "adr").isEmpty());
    }

    /**
     * Рёбра с побочным действием (ANSWERS закрывает вопрос, SUPERSEDES требует
     * статуса у старого ADR, DEPENDS_ON спринтов — проверки цикла и kind) и
     * структурные (HAS_STATE, PART_OF, BELONGS_TO…) через «Связать» не ставятся:
     * у них свои пути записи с этими правилами.
     */
    @Test
    void edgesWithSideEffectsOrStructuralAreNotOffered() {
        Set<String> offered = new HashSet<>();
        // Исключение — привязка к компоненту (SPRINT_UXR_S10_SEIDR_KIT_2/MD-AUTOLINK): BELONGS_TO
        // к LoreComponent — это «запись про компонент», её ставят и adr/decision/doc/sprint-пути.
        // Остальные BELONGS_TO (спринт → проект и т. п.) — по-прежнему структура, вне таблицы.
        LoreLinkTypes.PAIRS.stream()
            .filter(p -> !(p.edgeType().equals("BELONGS_TO") && p.toType().equals("component")))
            .forEach(p -> offered.add(p.edgeType()));
        for (String banned : List.of("ANSWERS", "SUPERSEDES", "HAS_STATE", "PART_OF", "BELONGS_TO",
                "BELONGS_TO_PROJECT", "IN_PHASE", "TAGGED_WITH", "DOC_CHILD_OF", "GATES")) {
            assertFalse(offered.contains(banned), banned + " не должен предлагаться в «Связать»");
        }
        assertFalse(LoreLinkTypes.isAllowed("sprint", "sprint", "DEPENDS_ON"));
    }

    /**
     * SPRINT_UXR_S10_SEIDR_KIT_2/MD-AUTOLINK: компонент в каталоге, рёбра — те, которыми
     * пути записи уже связывают записи с компонентом (adr/decision/doc/sprint → BELONGS_TO,
     * компонент → DOCUMENTED_IN → спека), а не придуманные.
     */
    @Test
    void componentIsInCatalogWithSchemaEdges() {
        LoreLinkTypes.Entity c = LoreLinkTypes.entity("component");
        assertNotNull(c, "компонент обязан быть в каталоге");
        assertEquals("LoreComponent", c.vertexClass());
        assertEquals("component_id", c.idField());
        assertEquals("component", c.family());
        for (String t : List.of("adr", "decision", "doc", "sprint"))
            assertTrue(LoreLinkTypes.isAllowed(t, "component", "BELONGS_TO"), t + " → component BELONGS_TO");
        assertFalse(LoreLinkTypes.isAllowed("spec", "component", "BELONGS_TO"),
            "у спеки компонент один (syncSpecComponent) — второй по упоминанию не ставится");
        assertFalse(LoreLinkTypes.isAllowed("component", "adr", "BELONGS_TO"), "направление — к компоненту");
        assertTrue(LoreLinkTypes.isAuto("adr", "BELONGS_TO", "component"));
        assertFalse(LoreLinkTypes.isAuto("decision", "DECIDED_IN", "adr"),
            "авто — только пары, помеченные явно");
    }

    @Test
    void everyPairUsesKnownTypesAndHasNoDuplicates() {
        Set<String> seen = new HashSet<>();
        for (LoreLinkTypes.Pair p : LoreLinkTypes.PAIRS) {
            assertNotNull(LoreLinkTypes.entity(p.fromType()), "неизвестный тип " + p.fromType());
            assertNotNull(LoreLinkTypes.entity(p.toType()), "неизвестный тип " + p.toType());
            assertTrue(seen.add(p.fromType() + "|" + p.edgeType() + "|" + p.toType()), "дубль " + p);
            assertFalse(p.edgeType().equals(LoreLinkTypes.FALLBACK_EDGE), "REFERENCES — не строка таблицы");
        }
    }

    @Test
    void entityRegistryMapsToVertexIdFieldAndWriteFamily() {
        LoreLinkTypes.Entity task = LoreLinkTypes.entity("task");
        assertEquals("KnowTask", task.vertexClass());
        assertEquals("task_uid", task.idField());
        assertEquals("task", task.family());
        LoreLinkTypes.Entity uc = LoreLinkTypes.entity("use_case");
        assertEquals("uc", uc.family(), "правка сценария — семейство uc матрицы прав");
        LoreLinkTypes.Entity actor = LoreLinkTypes.entity("actor");
        assertEquals("KnowProjectActor", actor.vertexClass());
        assertNull(LoreLinkTypes.entity("milestone"), "вехи не упоминаются в телах — вне каталога");
    }

    /** Каждое семейство-владелец есть в матрице прав, иначе проверка агента по нему — пустая. */
    @Test
    void everyEntityFamilyIsInTheAgentMatrix() {
        for (LoreLinkTypes.Entity e : LoreLinkTypes.ENTITIES.values()) {
            assertTrue(AgentScopeFilter.FAMILY_AGENTS.containsKey(e.family()),
                "семейство " + e.family() + " (" + e.type() + ") вне FAMILY_AGENTS");
        }
        assertTrue(AgentScopeFilter.FAMILY_AGENTS.containsKey("link"),
            "write-путь /lore/link/* обязан быть в матрице прав");
    }

    @Test
    void migrationDeclaresReferencesEdgeAdditively() {
        LoreSchemaMigrations.Step step = LoreSchemaMigrations.STEPS.stream()
            .filter(s -> s.name().equals("references_edge")).findFirst().orElse(null);
        assertNotNull(step, "шаг миграции references_edge не объявлен");
        assertTrue(step.sql().stream().anyMatch(s -> s.contains("CREATE EDGE TYPE REFERENCES IF NOT EXISTS")));
        assertTrue(step.sql().stream().allMatch(s -> s.contains("IF NOT EXISTS")), "только аддитивно");
        assertEquals(17, step.compatMajor(), "аддитивный шаг не поднимает major");
        assertTrue(LoreSchemaMigrations.requiredLiveTypes().contains("REFERENCES"));
    }
}
