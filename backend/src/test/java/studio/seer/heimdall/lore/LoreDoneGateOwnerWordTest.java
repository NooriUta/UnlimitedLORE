package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_WORK_ANY_KIND/WK-05 — решение владелицы 14.11.2026 (D4, «вариант б»): агенту разрешён
 * done ПО СЛОВУ ВЛАДЕЛИЦЫ — доказательство вида {@code owner_word}, {@code evidence_ref} обязателен
 * и непуст (дословная цитата или ссылка на её сообщение). Прочие виды доказательства агенту для done
 * по-прежнему запрещены — 409 DONE_BY_HUMAN_ONLY. Остальной гейт (только из review, приёмщик ≠
 * исполнитель) не меняется.
 */
class LoreDoneGateOwnerWordTest {

    static LoreModelWorkflow.Workflow wf() { return LoreModelFile.content().workflow(); }

    static LoreDoneGate.Facts agent(String cur, String type, String evT, String evR) {
        return new LoreDoneGate.Facts(true, null, "agent-full", null, cur, type, evT, evR);
    }

    @Test
    void agentClosesByOwnerWordWithQuote() {
        assertNull(LoreDoneGate.done(agent("review", "dev", "owner_word",
            "владелица 14.11.2026: «закрывай MT-MCP-TRUTH»"), wf()));
        assertNull(LoreDoneGate.done(agent("uat", "docs", LoreDoneGate.OWNER_WORD, "minilore msg #4812"), wf()),
            "слово владелицы годится для любого вида работы");
    }

    @Test
    void ownerWordWithoutRefIsRefused() {
        for (String ref : new String[]{null, "", "   "}) {
            LoreDoneGate.Verdict v = LoreDoneGate.done(agent("review", "dev", "owner_word", ref), wf());
            assertNotNull(v, "owner_word без цитаты — отказ: [" + ref + "]");
            assertEquals(409, v.status());
            assertEquals("NO_EVIDENCE", v.code());
            assertTrue(v.detail().contains("evidence_ref"), "отказ называет, чего не хватает: " + v.detail());
        }
    }

    @Test
    void otherEvidenceStillHumanOnlyForAgent() {
        LoreDoneGate.Verdict v = LoreDoneGate.done(agent("review", "dev", "pr", "PR #1337"), wf());
        assertEquals("DONE_BY_HUMAN_ONLY", v.code());
        assertEquals(409, v.status());
        assertTrue(v.detail().contains("owner_word"), "отказ называет законный путь агента: " + v.detail());
        assertEquals("DONE_BY_HUMAN_ONLY", LoreDoneGate.done(agent("review", "dev", null, null), wf()).code());
    }

    @Test
    void ownerWordDoesNotSkipReview() {
        assertEquals("DONE_ONLY_FROM_REVIEW",
            LoreDoneGate.done(agent("active", "dev", "owner_word", "владелица: «закрывай»"), wf()).code(),
            "done по-прежнему только из review — сначала review, потом done");
    }

    @Test
    void humanMayAlsoCloseByOwnerWord() {
        assertNull(LoreDoneGate.done(new LoreDoneGate.Facts(false, "Алекса", "agent", null, "review", "ops",
            "owner_word", "сама сказала на созвоне 14.11"), wf()));
    }
}
