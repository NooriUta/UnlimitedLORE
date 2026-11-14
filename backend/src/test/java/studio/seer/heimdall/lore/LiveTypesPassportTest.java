package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MD-04 — паспорта v2 живых типов, у которых был только список:
 * роль продукта (actor, KnowProjectActor), боль (pain), выгода (gain), работа (job), и ранбук
 * (runbook, KnowRunbook) — у него не было ни раздела, ни паспорта. Аудит схемы 14.11 (ред. 3).
 * Все пять — только чтение: пишутся своими путями MCP (actor_new, pain_new, gain_new, job_new,
 * runbook_new), путей записи через фасад у них нет.
 */
class LiveTypesPassportTest {

    static final List<String> LIVE = List.of("actor", "pain", "gain", "job", "runbook");

    static final Map<String, String> SOURCES = Map.of(
        "actor", "actor_by_id", "pain", "pain_by_id", "gain", "gain_by_id", "job", "job_by_id",
        "runbook", "runbook_by_id");

    static final Map<String, String> VERTEX = Map.of(
        "actor", "KnowProjectActor", "pain", "KnowPain", "gain", "KnowGain", "job", "KnowJob",
        "runbook", "KnowRunbook");

    @Test
    void typesArePassportsAndReadOnly() {
        for (String t : LIVE) {
            assertTrue(LoreRecordRegistry.TYPES.contains(t), t + ": нет паспорта v2");
            assertTrue(LoreRecordRegistry.READ_ONLY.contains(t), t + ": путей записи у фасада нет — только чтение");
        }
        assertEquals("project", LoreRecordRegistry.TYPES.get(LoreRecordRegistry.TYPES.size() - 1), "проект — последним");
    }

    @Test
    void sourceIsOneRowByBusinessKey() {
        for (String t : LIVE) {
            LoreRecordResource.Source s = LoreRecordResource.sourceOf(t);
            assertNotNull(s, t);
            assertEquals(SOURCES.get(t), s.slice(), t);
            LoreSlices.SliceDef d = LoreSlices.get(s.slice());
            assertNotNull(d, s.slice());
            assertEquals(List.of(s.param()), d.required(), s.slice());
            assertTrue(d.baseSql().contains("FROM " + VERTEX.get(t)), s.slice() + ": " + d.baseSql());
        }
    }

    @Test
    void graphKnowsTheVertexAndKey() {
        for (String t : LIVE) {
            LoreModelTypes.Graph g = LoreModelTypes.GRAPH.get(t);
            assertNotNull(g, t + ": без вершины вкладки по ребру не читаются");
            assertEquals(VERTEX.get(t), g.vertex(), t);
        }
    }

    /** Новые срезы не уезжают мимо скоупа: либо проектные, либо общие с причиной, как их списки. */
    @Test
    void byIdSlicesFollowTheirListScope() {
        for (String s : List.of("pain_by_id", "gain_by_id", "job_by_id", "actor_by_id"))
            assertTrue(LoreSlices.SHARED_SLICES.containsKey(s) || hasReason(s), s + ": скоуп не объявлен");
        assertTrue(LoreSlices.PROJECT_SCOPED.containsKey("runbooks"), "положительный контроль: список ранбуков под скоупом");
    }

    private static boolean hasReason(String slice) {
        return LoreSlices.PROJECT_SCOPED.containsKey(slice) || LoreSlices.SCOPE_PENDING.containsKey(slice);
    }

    /** Ранбук — в общем меню, в группе «Знание», рядом с документами. */
    @Test
    void runbookIsAKnowledgeSection() {
        List<String> nav = LoreModelNavTest.navSections(LoreModelGoldenTest.modelDoc());
        assertTrue(nav.contains("runbook"), "раздела «Ранбуки» нет в меню: " + nav);
        assertEquals("everywhere", LoreModelFile.content().audience().get("runbook"));
    }
}
