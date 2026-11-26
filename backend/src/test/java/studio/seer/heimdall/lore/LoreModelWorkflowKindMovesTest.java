package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_UNIVERSAL_WORKFLOW/UW-L0-SPEC, вариант «1а» (владелец 26.11 — «ok»): у вида работы могут быть свои
 * переходы — подмножество переходов ядра (workflow.moves). Не задал — вид наследует общие. Статусы — одна ось на
 * всех: вид не может добавить переход, которого нет в ядре, и не может поставить done не из review.
 */
class LoreModelWorkflowKindMovesTest {

    private static Map<String, Object> wf(Map<String, Object> researchMoves) {
        Map<String, Object> moves = new LinkedHashMap<>();
        moves.put("planned", List.of("active", "cancelled"));
        moves.put("active", List.of("waiting", "review", "blocked", "failed", "cancelled"));
        moves.put("waiting", List.of("active", "review", "failed"));
        moves.put("review", List.of("done", "active"));
        moves.put("done", List.of());
        moves.put("failed", List.of());
        moves.put("blocked", List.of("active"));
        moves.put("cancelled", List.of());
        Map<String, Object> dev = new LinkedHashMap<>();
        dev.put("label", "разработка");
        dev.put("types", List.of("dev"));
        dev.put("evidence", List.of(Map.of("type", "pr", "label", "PR")));
        Map<String, Object> research = new LinkedHashMap<>();
        research.put("label", "исследование");
        research.put("types", List.of("research"));
        research.put("evidence", List.of(Map.of("type", "lore", "label", "запись LORE")));
        if (researchMoves != null) research.put("moves", researchMoves);
        return Map.of("moves", moves, "kinds", Map.of("dev", dev, "research", research));
    }

    private static Map<String, Object> researchSubset() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("planned", List.of("active", "cancelled"));
        m.put("active", List.of("waiting", "review", "cancelled"));
        m.put("waiting", List.of("active", "review"));
        m.put("review", List.of("done", "active"));
        return m;
    }

    @Test
    void видБезСвоихПереходов_наследуетОбщие() {
        LoreModelWorkflow.Workflow w = LoreModelWorkflow.parse(wf(null));
        assertEquals(w.moves(), w.movesFor("dev"));
        assertEquals(w.moves(), w.movesFor("research"));
        assertEquals(w.moves(), w.movesFor("нет-такого-вида"));
    }

    @Test
    void видСоСвоимиПереходами_подмножествоЯдра_безПроблем() {
        LoreModelWorkflow.Workflow w = LoreModelWorkflow.parse(wf(researchSubset()));
        assertEquals(List.of("waiting", "review", "cancelled"), w.movesFor("research").get("active"));
        assertTrue(LoreModelWorkflow.problems(w).isEmpty(), String.valueOf(LoreModelWorkflow.problems(w)));
        assertEquals(List.of("waiting", "review", "blocked", "failed", "cancelled"), w.movesFor("dev").get("active"));
    }

    @Test
    void переходВнеЯдра_проблема() {
        Map<String, Object> bad = researchSubset();
        bad.put("planned", List.of("review"));
        List<String> p = LoreModelWorkflow.problems(LoreModelWorkflow.parse(wf(bad)));
        assertTrue(p.stream().anyMatch(s -> s.contains("research") && s.contains("planned") && s.contains("review")), String.valueOf(p));
    }

    @Test
    void статусНеИзЯдра_иDoneНеИзReview_проблемы() {
        Map<String, Object> bad = researchSubset();
        bad.put("active", List.of("почти_готово", "done"));
        List<String> p = LoreModelWorkflow.problems(LoreModelWorkflow.parse(wf(bad)));
        assertTrue(p.stream().anyMatch(s -> s.contains("почти_готово")), String.valueOf(p));
        assertTrue(p.stream().anyMatch(s -> s.contains("done") && s.contains("review")), String.valueOf(p));
    }

    @Test
    void файлМодели_безПроблем() {
        assertTrue(LoreModelWorkflow.problems(LoreModelFile.content().workflow()).isEmpty());
    }
}
