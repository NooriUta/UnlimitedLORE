package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_POLISH_UAT_1113/PU-29 — правило владелицы 14.11.2026 после жёсткой блокировки на проде
 * («не могу перевести в DONE — NO_EVIDENCE»): «если я нажала кнопку — это моё решение и подтверждение;
 * учётка не агента, а человека — тоже подтверждение. Просто проверяй, что перенесено человеком, и не
 * надо с человека просить ещё доп. работы. По агенту необходим текст — время и цитата человека».
 *
 * <p>Человек: done проходит из любого статуса, без доказательства и без проверок приёмщика —
 * доказательство (кто и когда) сервер ставит сам. Агент: только owner_word, и в evidence_ref есть
 * время (или дата) и цитата в кавычках; остальной гейт агента (из review, приёмщик ≠ исполнитель) прежний.
 */
class LoreDoneGateHumanTest {

    static LoreModelWorkflow.Workflow wf() { return LoreModelFile.content().workflow(); }

    static LoreDoneGate.Facts human(String caller, String exec, String rev, String cur, String evT, String evR) {
        return new LoreDoneGate.Facts(false, caller, exec, rev, cur, "dev", evT, evR);
    }

    static LoreDoneGate.Facts agent(String cur, String evT, String evR) {
        return new LoreDoneGate.Facts(true, null, "agent-full", null, cur, "dev", evT, evR);
    }

    @Test
    void humanButtonIsTheConfirmation() {
        // ровно случай с прода: человек, review, доказательства нет
        assertNull(LoreDoneGate.done(human("Алекса", "agent", null, "uat", null, null), wf()));
        assertNull(LoreDoneGate.done(human("Алекса", "agent", null, "ready_for_deploy", null, null), wf()));
        // из любого статуса — без доп. шага через review
        assertNull(LoreDoneGate.done(human("Алекса", "agent", null, "active", null, null), wf()));
        assertNull(LoreDoneGate.done(human("Алекса", "agent", null, "partial", null, null), wf()));
        // своя задача и не опознанное имя — тоже человек
        assertNull(LoreDoneGate.done(human("Алекса", "Алекса", null, "active", null, null), wf()));
        assertNull(LoreDoneGate.done(human(null, "agent", "agent", "active", null, null), wf()));
    }

    @Test
    void humanEvidenceIsWrittenByServer() {
        String ref = LoreDoneGate.humanEvidenceRef("Алекса", "2026-11-14T08:30:00Z");
        assertTrue(ref.contains("Алекса") && ref.contains("2026-11-14T08:30:00Z"), ref);
        assertEquals("человек", LoreDoneGate.humanEvidenceRef(null, "t").split(" · ")[0]);
        assertEquals("human", LoreDoneGate.HUMAN);
    }

    @Test
    void agentNeedsTimeAndQuote() {
        assertNull(LoreDoneGate.done(agent("review", "owner_word", "14.11.2026 08:31 владелица: «закрывай PU-29»"), wf()));
        assertNull(LoreDoneGate.done(agent("uat", "owner_word", "2026-11-14 \"ставь done\""), wf()));
        for (String bad : new String[]{null, " ", "minilore msg #4812", "«закрывай» без времени", "14.11.2026 08:31 без цитаты"}) {
            LoreDoneGate.Verdict v = LoreDoneGate.done(agent("review", "owner_word", bad), wf());
            assertNotNull(v, "агенту без времени и цитаты — отказ: [" + bad + "]");
            assertEquals("NO_EVIDENCE", v.code());
            assertTrue(v.detail().contains("время") && v.detail().contains("цитат"), v.detail());
        }
        assertEquals("DONE_BY_HUMAN_ONLY", LoreDoneGate.done(agent("review", "pr", "PR #1"), wf()).code());
        assertEquals("DONE_ONLY_FROM_REVIEW",
            LoreDoneGate.done(agent("active", "owner_word", "14.11 08:31 «закрывай»"), wf()).code());
    }

    /**
     * Приёмка препрода 14.11.2026: «Готово к деплою» → «В работе» из UI — 400 REASON_REQUIRED, а поля для
     * причины интерфейс не даёт: вернуть задачу назад нельзя. По правилу владелицы человеку переход без
     * обязательных слов (причину он может дать, но не обязан); агенту — как было.
     */
    @Test
    void humanTransitionsNeedNoWordsAgentStillDoes() {
        assertNull(LoreDoneGate.transitionFor(false, "ready_for_deploy", "active", null, null), "возврат с приёмки человеком");
        assertNull(LoreDoneGate.transitionFor(false, "active", "blocked", null, null), "blocked человеком");
        assertNull(LoreDoneGate.transitionFor(false, "active", "waiting", null, null), "waiting человеком");
        assertEquals("REASON_REQUIRED", LoreDoneGate.transitionFor(true, "ready_for_deploy", "active", null, null).code());
        // UW-L0-SPEC 26.11: из uat агенту — никуда (кроме done по слову человека)
        assertEquals("UAT_EXIT_HUMAN_ONLY", LoreDoneGate.transitionFor(true, "uat", "active", "причина", null).code());
        assertEquals("REASON_REQUIRED", LoreDoneGate.transitionFor(true, "active", "blocked", null, null).code());
        assertEquals("WAITING_FOR_REQUIRED", LoreDoneGate.transitionFor(true, "active", "waiting", null, null).code());
    }
}
