package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_WORK_ANY_KIND/WK-05 (D-2026-LORE-UNIFIED-WORKFLOW-CORE): восемь статусов ядра, прежние
 * значения — синонимы. Данные не мигрируются, поэтому каждый токен, который можно записать, обязан
 * сводиться к ядру — иначе читатель ядра молча потеряет часть задач.
 */
class LoreWorkflowCoreTest {

    static JsonNode canonical() throws Exception {
        return new ObjectMapper().readTree(new File("../shared/lore-statuses.json"));
    }

    @Test
    void coreAndSynonymsMirrorTheCanon() throws Exception {
        JsonNode c = canonical();
        List<String> core = new ArrayList<>();
        c.get("core").forEach(n -> core.add(n.asText()));
        assertEquals(core, LoreWorkflowCore.CORE);
        Map<String, String> syn = new TreeMap<>();
        c.get("coreSynonyms").fields().forEachRemaining(e -> syn.put(e.getKey(),
            e.getValue().get("core").asText() + (e.getValue().has("stage") ? "/" + e.getValue().get("stage").asText() : "")));
        Map<String, String> java = new TreeMap<>();
        LoreWorkflowCore.SYNONYMS.forEach((k, v) -> java.put(k, v.core() + (v.stage() != null ? "/" + v.stage() : "")));
        assertEquals(syn, java);
    }

    @Test
    void everyWritableStatusReducesToCore() {
        List<String> lost = new ArrayList<>();
        for (String s : LoreResourceBase.PLAN_STATUSES)
            if (!LoreWorkflowCore.CORE.contains(LoreWorkflowCore.core(s))) lost.add(s);
        assertEquals(List.of(), lost, "токен без места в ядре");
    }

    @Test
    void oldAcceptanceStatusesAreReviewStages() {
        assertEquals("review", LoreWorkflowCore.core("ready_for_deploy"));
        assertEquals("stand_check", LoreWorkflowCore.stage("ready_for_deploy"));
        assertEquals("review", LoreWorkflowCore.core("uat"));
        assertEquals("uat", LoreWorkflowCore.stage("uat"));
        assertEquals("active", LoreWorkflowCore.core("partial"));
        assertEquals("planned", LoreWorkflowCore.core("todo"));
        assertEquals("waiting", LoreWorkflowCore.core("waiting"));
        assertNull(LoreWorkflowCore.core(null));
        assertNull(LoreWorkflowCore.core("nonsense"), "неопознанное не выдаётся за статус ядра");
    }

    /** Записанная строка читается обратно в тот же токен — для всех трёх новых статусов. */
    @Test
    void newStatusesRoundTripThroughRaw() {
        for (String s : List.of("waiting", "review", "failed")) {
            String raw = LoreResourceBase.SCD2_STATUS_RAW.get(s);
            assertNotNull(raw, s);
            assertEquals(s, LoreStatusResource.rawToToken(raw), raw);
            assertEquals(s, LoreRecordValues.planToken(raw), raw);
        }
        assertEquals("withdrawn", LoreStatusCategory.of("task", "❌ FAILED"), "failed закрыт, но не «сделано»");
        assertTrue(LoreStatusCategory.isClosed(LoreStatusCategory.of("task", "❌ FAILED")));
        assertEquals("in_progress", LoreStatusCategory.of("task", "⏳ WAITING"));
    }

    @Test
    void failedTaskClosesLikeCancelledForTheSprint() {
        assertNull(LoreStatusResource.deriveSprintTarget("active", List.of("done", "failed", "active")));
        assertEquals("done", LoreStatusResource.deriveSprintTarget("active", List.of("done", "failed")));
        assertEquals("active", LoreStatusResource.deriveSprintTarget("planned", List.of("review", "todo")),
            "задача на приёмке — работа идёт");
    }
}
