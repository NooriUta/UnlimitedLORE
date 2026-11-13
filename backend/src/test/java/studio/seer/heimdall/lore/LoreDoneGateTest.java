package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_WORK_ANY_KIND/WK-05, решение ADR-LORE-014-D5 (заменяет соло-закрытие D4): переход
 * задачи в done — только человек, только из review, с приёмщиком ≠ исполнитель и с доказательством
 * по виду работы. Прочие переходы: blocked и возврат с приёмки — с причиной, waiting — с адресатом.
 * Каждый отказ — код и объяснение, что сделать, а не тихая запись.
 */
class LoreDoneGateTest {

    static LoreModelWorkflow.Workflow wf() { return LoreModelFile.content().workflow(); }

    static LoreDoneGate.Facts human(String caller, String exec, String rev, String cur, String type, String evT, String evR) {
        return new LoreDoneGate.Facts(false, caller, exec, rev, cur, type, evT, evR);
    }

    @Test
    void agentNeverSetsDone() {
        LoreDoneGate.Verdict v = LoreDoneGate.done(
            new LoreDoneGate.Facts(true, "agent-full", "agent-full", "omiloreadmin", "review", "dev", "pr", "#1"), wf());
        assertEquals("DONE_BY_HUMAN_ONLY", v.code());
        assertEquals(409, v.status());
        assertTrue(v.detail().contains("review"), "отказ называет путь: перевести в review");
    }

    @Test
    void doneOnlyFromReviewIncludingOldAcceptanceTokens() {
        assertEquals("DONE_ONLY_FROM_REVIEW", LoreDoneGate.done(human("Алекса", "agent", null, "active", "dev", "pr", "#1"), wf()).code());
        assertEquals("DONE_ONLY_FROM_REVIEW", LoreDoneGate.done(human("Алекса", "agent", null, "partial", "dev", "pr", "#1"), wf()).code());
        assertNull(LoreDoneGate.done(human("Алекса", "agent", null, "uat", "dev", "pr", "#1"), wf()), "uat — стадия review");
        assertNull(LoreDoneGate.done(human("Алекса", "agent", null, "ready_for_deploy", "dev", "pr", "#1"), wf()));
    }

    /** A2: закрывающий человек становится приёмщиком; NO_REVIEWER — только если он же исполнитель. */
    @Test
    void closingHumanBecomesReviewerUnlessExecutor() {
        assertNull(LoreDoneGate.done(human("Алекса", "agent", null, "review", "dev", "pr", "#1"), wf()));
        assertEquals("NO_REVIEWER", LoreDoneGate.done(human("Алекса", "Алекса", null, "review", "dev", "pr", "#1"), wf()).code());
        assertEquals("REVIEWER_IS_EXECUTOR", LoreDoneGate.done(human("Алекса", "agent", "agent", "review", "dev", "pr", "#1"), wf()).code());
    }

    @Test
    void evidenceByKindOfWork() {
        LoreDoneGate.Verdict none = LoreDoneGate.done(human("Алекса", "agent", "Алекса", "review", "ops", null, null), wf());
        assertEquals("NO_EVIDENCE", none.code());
        assertTrue(none.detail().contains("замер"), "отказ перечисляет доказательства вида ops: " + none.detail());
        LoreDoneGate.Verdict wrong = LoreDoneGate.done(human("Алекса", "agent", "Алекса", "review", "docs", "pr", "#5"), wf());
        assertEquals("NO_EVIDENCE", wrong.code(), "у документа доказательство — запись LORE, не PR");
        assertNull(LoreDoneGate.done(human("Алекса", "agent", "Алекса", "review", "docs", "lore", "spec:SPEC-X"), wf()));
        assertEquals("NO_EVIDENCE", LoreDoneGate.done(human("Алекса", "agent", "Алекса", "review", "dev", "pr", "  "), wf()).code(),
            "пустая ссылка — не доказательство");
    }

    /** A4: тип вне таблицы и пустой — вид dev. */
    @Test
    void unknownOrEmptyTaskTypeIsDev() {
        assertEquals("dev", LoreDoneGate.kindOf(null, wf()));
        assertEquals("dev", LoreDoneGate.kindOf("planning", wf()));
        assertEquals("research", LoreDoneGate.kindOf("analytics", wf()));
    }

    @Test
    void otherTransitionsNeedTheirWords() {
        assertEquals("REASON_REQUIRED", LoreDoneGate.transition("active", "blocked", null, null).code());
        assertEquals(400, LoreDoneGate.transition("active", "blocked", " ", null).status());
        assertNull(LoreDoneGate.transition("active", "blocked", "ждём доступ к ci-server", null));
        assertEquals("REASON_REQUIRED", LoreDoneGate.transition("uat", "active", null, null).code(), "возврат с приёмки");
        assertNull(LoreDoneGate.transition("planned", "active", null, null), "обычный старт — без слов");
        assertEquals("WAITING_FOR_REQUIRED", LoreDoneGate.transition("active", "waiting", null, null).code());
        assertNull(LoreDoneGate.transition("active", "waiting", null, "организатор CFP"));
    }
}
