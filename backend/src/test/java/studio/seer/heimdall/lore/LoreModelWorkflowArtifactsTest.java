package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Канал артефактов workflow (владелец 26.11.2026: «сделай канал artifacts и produces/consumes с тестом»).
 * {@code workflow.artifacts} — каталог артефактов (канал состояния графа в UW-02 / LangGraph4j);
 * {@code kinds.*.flow} — что стадия вида производит и потребляет. Модель — данные, сверка — {@link LoreModelWorkflow#problems}.
 */
class LoreModelWorkflowArtifactsTest {

    static LoreModelWorkflow.Workflow real() {
        return LoreModelFile.content().workflow();
    }

    static LoreModelWorkflow.Workflow with(Map<String, LoreModelWorkflow.Artifact> artifacts, LoreModelWorkflow.Kind kind) {
        Map<String, List<String>> moves = new LinkedHashMap<>(real().moves());
        return new LoreModelWorkflow.Workflow(moves, Map.of("dev", kind), artifacts);
    }

    static LoreModelWorkflow.Kind dev(List<LoreModelWorkflow.StageIo> flow, String evidence) {
        return new LoreModelWorkflow.Kind("разработка", List.of("dev"), List.of("design", "implement", "test"),
            List.of("stand_check", "uat"), List.of(new LoreModelWorkflow.Evidence(evidence, "x")), null, null, flow);
    }

    static final Map<String, LoreModelWorkflow.Artifact> CAT = Map.of(
        "adr", new LoreModelWorkflow.Artifact("ADR", "record", "lore"),
        "branch", new LoreModelWorkflow.Artifact("ветка", "stage", null),
        "pr", new LoreModelWorkflow.Artifact("PR", "stage", "pr"),
        "stand_report", new LoreModelWorkflow.Artifact("отчёт смоука", "stage", "probe"));

    static LoreModelWorkflow.StageIo io(String stage, List<String> produces, List<String> consumes) {
        return new LoreModelWorkflow.StageIo(stage, produces, consumes);
    }

    @Test
    void realModelHasCatalogAndFlowForEveryKindWithoutProblems() {
        LoreModelWorkflow.Workflow w = real();
        assertFalse(w.artifacts().isEmpty(), "каталог workflow.artifacts пуст");
        w.kinds().forEach((k, kind) -> assertFalse(kind.flow().isEmpty(), "у вида " + k + " нет flow"));
        assertEquals(List.of(), LoreModelWorkflow.problems(w));
    }

    /** Владелец 26.11: «в workflow develop ты не упоминаешь код как артефакт (новый, изменённый) — и в ops, и в test». */
    @Test
    void codeAndTestsAreArtifactsOfDevAndOps() {
        LoreModelWorkflow.Workflow w = real();
        assertEquals("record", w.artifacts().get("code").source(), "код живёт в репозитории до задачи");
        assertEquals("record", w.artifacts().get("tests").source());
        java.util.function.BiFunction<String, String, LoreModelWorkflow.StageIo> io = (k, st) ->
            w.kinds().get(k).flow().stream().filter(x -> x.stage().equals(st)).findFirst().orElseThrow();
        assertTrue(io.apply("dev", "implement").produces().containsAll(List.of("code", "tests")), "dev:implement выдаёт код и тесты");
        assertTrue(io.apply("dev", "test").consumes().containsAll(List.of("code", "tests")), "dev:test берёт код и тесты");
        assertTrue(io.apply("ops", "fix").produces().containsAll(List.of("code", "tests")), "ops:fix выдаёт код и тесты");
        assertTrue(io.apply("ops", "diagnose").consumes().contains("code"), "ops:diagnose читает код");
        // Решение владельца 15а (26.11): после fix код и тесты проверяет замер — прогон тестов часть замера.
        assertTrue(io.apply("ops", "measure").consumes().containsAll(List.of("code", "tests")), "ops:measure берёт код и тесты");
    }

    /** Решение владельца 16 (26.11): у content свой гейт приёмки — согласование публикации до выхода наружу. */
    @Test
    void contentHasApprovalGateBeforePublication() {
        LoreModelWorkflow.Kind c = real().kinds().get("content");
        assertEquals(List.of("approval", "scheduled"), c.review_stages(), "сначала согласование, потом публикация");
        assertFalse(c.stages().contains("scheduled"), "публикация — не стадия работы, а шаг после согласования");
    }

    @Test
    void consumedRecordWithoutProducerIsFine_stageArtifactMustBeProducedEarlier() {
        var ok = with(CAT, dev(List.of(
            io("design", List.of(), List.of("adr")),                 // ADR — запись, может быть до workflow
            io("implement", List.of("branch", "pr"), List.of()),
            io("stand_check", List.of("stand_report"), List.of("pr"))), "pr"));
        assertEquals(List.of(), LoreModelWorkflow.problems(ok));

        var late = with(CAT, dev(List.of(
            io("design", List.of(), List.of("pr")),                  // PR ещё никто не произвёл
            io("implement", List.of("pr"), List.of())), "pr"));
        assertTrue(LoreModelWorkflow.problems(late).stream().anyMatch(p -> p.contains("design") && p.contains("pr") && p.contains("раньше")),
            String.valueOf(LoreModelWorkflow.problems(late)));
    }

    @Test
    void unknownArtifactAndUnknownStageAreProblems() {
        var bad = with(CAT, dev(List.of(
            io("implement", List.of("pr", "nope"), List.of()),
            io("deploy", List.of(), List.of())), "pr"));
        List<String> p = LoreModelWorkflow.problems(bad);
        assertTrue(p.stream().anyMatch(s -> s.contains("«nope»") && s.contains("нет в workflow.artifacts")), String.valueOf(p));
        assertTrue(p.stream().anyMatch(s -> s.contains("«deploy»") && s.contains("не стадия вида")), String.valueOf(p));
    }

    @Test
    void evidenceOfKindMustBeProducedByItsFlow() {
        var noProof = with(CAT, dev(List.of(io("implement", List.of("branch"), List.of())), "pr"));
        assertTrue(LoreModelWorkflow.problems(noProof).stream().anyMatch(s -> s.contains("доказательство «pr»") && s.contains("не производит")),
            String.valueOf(LoreModelWorkflow.problems(noProof)));
    }

    @Test
    void kindWithoutFlowKeepsOldBehaviour_andSurfaceCarriesChannel() {
        var none = with(CAT, dev(List.of(), "pr"));
        assertEquals(List.of(), LoreModelWorkflow.problems(none));
        Map<String, Object> s = LoreModelWorkflow.surface(real());
        assertTrue(s.containsKey("artifacts"), "в /lore/model нет канала artifacts");
        @SuppressWarnings("unchecked")
        Map<String, Object> devKind = (Map<String, Object>) ((Map<String, Object>) s.get("kinds")).get("dev");
        assertTrue(devKind.get("flow") instanceof List<?> l && !l.isEmpty(), "у dev в /lore/model нет flow");
    }
}
