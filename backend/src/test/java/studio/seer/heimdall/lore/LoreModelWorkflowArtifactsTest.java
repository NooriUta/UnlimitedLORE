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
        // 26.11 перед согласованием встала внутренняя приёмка агентом (agent_review) — порядок важен, а не точный список
        List<String> rv = c.review_stages();
        assertTrue(rv.indexOf("approval") >= 0 && rv.indexOf("approval") < rv.indexOf("scheduled"), "сначала согласование, потом публикация: " + rv);
        assertFalse(c.stages().contains("scheduled"), "публикация — не стадия работы, а шаг после согласования");
    }

    /**
     * Владелец 26.11: «из rfd в uat — внутренняя приёмка агентом»; «если это не читается из workflow — нужно добавить».
     * У каждого вида с внутренним результатом приёмка начинается с агентской стадии (stand_check у dev/ops,
     * agent_review у остальных) и она выдаёт review_report. У external и funnel исход приходит извне — их не трогаем.
     */
    @Test
    void internalAgentAcceptanceIsExplicit() {
        LoreModelWorkflow.Workflow w = real();
        assertEquals("stage", w.artifacts().get("review_report").source());
        for (String k : List.of("dev", "ops", "doc", "research", "content", "routine", "hardware")) {
            LoreModelWorkflow.Kind kind = w.kinds().get(k);
            String agentStage = k.equals("dev") || k.equals("ops") ? "stand_check" : "agent_review";
            assertTrue(kind.review_stages().contains(agentStage), k + ": нет стадии внутренней приёмки агентом " + agentStage);
            assertTrue(kind.flow().stream().anyMatch(x -> x.stage().equals(agentStage) && x.produces().contains("review_report")),
                k + ": " + agentStage + " не выдаёт review_report");
        }
        assertEquals(List.of("decision_in"), w.kinds().get("external").review_stages(), "external: исход приходит извне");
    }

    /** Решение владельца 27 (26.11): «релиз обычно идёт — то, что в uat или done, по слову человека». Релиз — не стадия dev. */
    @Test
    void releaseIsNotADevStageOutputNorDevDoneEvidence() {
        LoreModelWorkflow.Kind dev = real().kinds().get("dev");
        assertTrue(dev.evidence().stream().noneMatch(e -> e.type().equals("release")), "done у dev не ждёт релиза — релиз идёт после uat/done");
        assertTrue(dev.flow().stream().noneMatch(x -> x.produces().contains("release")), "ни одна стадия dev не выпускает релиз");
        assertTrue(dev.evidence().stream().anyMatch(e -> e.type().equals("pr")), "доказательство dev — влитый PR");
    }

    /**
     * Владелец 26.11: «релиз — это стадия веток в git, dev — не релиз»; «про зонтики не забудь»; «у нас dev, preprod, prod»;
     * «prod и тег — это релиз, PR не всегда релиз, и классификация у него есть»; «нужно указать, откуда режется тег релиза».
     */
    @Test
    void deliveryIsBranchStagesWithUmbrellaAndReleaseTagFromMain() {
        List<LoreModelWorkflow.Delivery> d = real().delivery();
        assertEquals(List.of("feature", "umbrella", "promote", "release"), d.stream().map(LoreModelWorkflow.Delivery::stage).toList());
        assertEquals(List.of("dev", "preprod", "prod"), d.stream().map(LoreModelWorkflow.Delivery::env).filter(java.util.Objects::nonNull).toList());
        LoreModelWorkflow.Delivery umbrella = d.get(1), release = d.get(3);
        assertEquals("develop", umbrella.to()); assertEquals("human", umbrella.gate(), "зонтик в develop — по слову владельца");
        assertEquals("main", release.to()); assertEquals("main", release.tag_from(), "тег релиза режется с main");
        assertEquals("human", release.gate());
        assertEquals("uat", d.get(2).task_status(), "после промо и смоука — внутренняя приёмка агентом → uat");
    }

    @Test
    void deliveryRulesCatchBrokenRelease() {
        var bad = new LoreModelWorkflow.Workflow(real().moves(), Map.of(), Map.of(), List.of(
            new LoreModelWorkflow.Delivery("release", "preprod", "main", "release", "prod", "agent", null, "preprod", "x"),
            new LoreModelWorkflow.Delivery("feature", "feature/*", "develop", "feature", null, "auto", null, "develop", "x")));
        List<String> p = LoreModelWorkflow.problems(bad);
        assertTrue(p.stream().anyMatch(s -> s.contains("только словом человека")), String.valueOf(p));
        assertTrue(p.stream().anyMatch(s -> s.contains("тег релиза режется с целевой ветки")), String.valueOf(p));
        assertTrue(p.stream().anyMatch(s -> s.contains("тег режется только у релиза")), String.valueOf(p));
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
