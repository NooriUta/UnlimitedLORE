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

    // PU-29 (правило владелицы 14.11.2026): человек закрывает без доказательства, из любого статуса и без
    // проверок приёмщика — прежние проверки человека сняты, их место — LoreDoneGateHumanTest.

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
        assertEquals("REASON_REQUIRED", LoreDoneGate.transition("ready_for_deploy", "active", null, null).code(), "возврат с приёмки");
        // UW-L0-SPEC 26.11: из uat агенту — никуда, кроме done по слову человека (LoreDoneGateUatExitTest)
        assertEquals("UAT_EXIT_HUMAN_ONLY", LoreDoneGate.transition("uat", "active", null, null).code(), "выход из uat — человек");
        assertNull(LoreDoneGate.transition("planned", "active", null, null), "обычный старт — без слов");
        assertEquals("WAITING_FOR_REQUIRED", LoreDoneGate.transition("active", "waiting", null, null).code());
        assertNull(LoreDoneGate.transition("active", "waiting", null, "организатор CFP"));
    }
}
