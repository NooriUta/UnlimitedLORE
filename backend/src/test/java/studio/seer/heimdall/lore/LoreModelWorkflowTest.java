package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_WORK_ANY_KIND/WK-05 — раздел модели workflow по одобренному прототипу wk-05-workflow:
 * переходы ядра (done — только из review), виды работы со стадиями и доказательством done,
 * включая добавленные развилкой Б ops и «исследование».
 */
class LoreModelWorkflowTest {

    static LoreModelWorkflow.Workflow wf() { return LoreModelFile.content().workflow(); }

    @Test
    void doneOnlyFromReview() {
        wf().moves().forEach((from, to) -> {
            if (to.contains("done")) assertEquals("review", from, "done из " + from);
        });
        assertEquals(List.of("done", "active"), wf().moves().get("review"));
        assertEquals(List.of(), wf().moves().get("done"), "из done переходов нет");
    }

    @Test
    void kindsCoverPrototypeIncludingOpsAndResearch() {
        assertEquals(List.of("dev", "doc", "ops", "research", "external", "funnel", "routine", "content", "hardware"),
            List.copyOf(wf().kinds().keySet()));
        assertEquals(List.of("pr", "release"), wf().kinds().get("dev").evidence().stream().map(LoreModelWorkflow.Evidence::type).toList());
        assertEquals(List.of("probe", "pr"), wf().kinds().get("ops").evidence().stream().map(LoreModelWorkflow.Evidence::type).toList());
        assertEquals(List.of("stand_check", "uat"), wf().kinds().get("dev").review_stages(), "развилка А: UAT — стадия review");
    }

    @Test
    void taskTypeMapsToOneKind() {
        assertEquals("dev", wf().kindOf("test"));
        assertEquals("research", wf().kindOf("analytics"));
        assertEquals("doc", wf().kindOf("docs"));
        assertEquals("ops", wf().kindOf("ops"));
        assertNull(wf().kindOf("planning"), "тип вне таблицы прототипа — вида нет, а не выдуманный");
        assertNull(wf().kindOf(null));
    }

    @Test
    void brokenWorkflowIsNamed() {
        LoreModelWorkflow.Workflow bad = new LoreModelWorkflow.Workflow(
            Map.of("active", List.of("done", "limbo")),
            Map.of("a", new LoreModelWorkflow.Kind("A", List.of("dev"), List.of(), List.of(), List.of(), null),
                   "b", new LoreModelWorkflow.Kind("B", List.of("dev"), List.of(), List.of(),
                       List.of(new LoreModelWorkflow.Evidence("pr", "PR")), null)));
        String all = String.join("\n", LoreModelWorkflow.problems(bad));
        assertTrue(all.contains("done ставится только из review"), all);
        assertTrue(all.contains("limbo"), all);
        assertTrue(all.contains("нет статуса ядра planned"), all);
        assertTrue(all.contains("нет доказательства done"), all);
        assertTrue(all.contains("«dev» в двух видах"), all);
        assertEquals(List.of(), LoreModelWorkflow.problems(wf()), "раздел в файле согласован");
    }

    @Test
    @SuppressWarnings("unchecked")
    void modelSurfaceCarriesCoreSynonymsAndKinds() {
        Map<String, Object> s = LoreModelWorkflow.surface(wf());
        assertEquals(LoreWorkflowCore.CORE, s.get("core"));
        Map<String, Object> uat = (Map<String, Object>) ((Map<String, Object>) s.get("synonyms")).get("uat");
        assertEquals("review", uat.get("core"));
        assertEquals("uat", uat.get("stage"));
        assertTrue(((Map<String, Object>) s.get("kinds")).containsKey("funnel"));
    }
}
