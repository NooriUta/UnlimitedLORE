package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH, часть А (06.11.2026).
 *
 * <p>A1–A2: попытка поставить closed руками — отказ, который сам объясняет
 * механику (решение + answers, одно решение закрывает несколько вопросов) и
 * разводит closed и dropped. Раньше отказ механики не объяснял, и агент выбирал
 * dropped — четыре доказательства легли в заметки.
 *
 * <p>A6: пять написаний владелицы в owner — omiloreadmin 74, owner 21,
 * владелец 19, владелица 9, alexa 4. Любая группировка «что ждёт владелицу»
 * давала пять ответов. При записи синонимы сводятся к одной личности; прочие
 * значения (сессии, агенты) не трогаются.
 */
class QuestionWriteRulesTest {

    @Test
    void closeRefusalExplainsTheMechanism() {
        String g = LoreQuestionResource.CLOSE_GUIDANCE;
        assertTrue(g.contains("question_link"), g);
        assertTrue(g.contains("answers"), g);
        assertTrue(g.contains("dropped"), "разводит closed и dropped: " + g);
        assertTrue(g.contains("нескольк"), "одно решение закрывает несколько: " + g);
    }

    @Test
    void ownerSpellingsOfTheOwnerCollapseToOneIdentity() {
        for (String alias : new String[] {"owner", "владелец", "владелица", "alexa", "Владелица", " omiloreadmin ", "OWNER"})
            assertEquals("omiloreadmin", LoreQuestionResource.normalizeOwner(alias), alias);
    }

    @Test
    void otherOwnersAreLeftAsTheyAre() {
        assertEquals("AGENT-FULL-msbt0fed", LoreQuestionResource.normalizeOwner("AGENT-FULL-msbt0fed"));
        assertEquals("сессия шлюза (link/), 3c1c2362", LoreQuestionResource.normalizeOwner("сессия шлюза (link/), 3c1c2362"));
        assertEquals("owner + claude", LoreQuestionResource.normalizeOwner("owner + claude"),
            "составное значение — не синоним, решает человек");
        assertNull(LoreQuestionResource.normalizeOwner(null), "не передан — не трогаем");
    }
}
