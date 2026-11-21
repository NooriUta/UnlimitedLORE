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

    /**
     * A6, решение владелицы 19.11.2026 («1а»): прежняя нормализация строки (пять написаний → «omiloreadmin» текстом,
     * прочее — как есть) заменена ребром ANSWERABLE_BY; правила — {@link QuestionOwnerTest}, SQL —
     * {@link QuestionOwnerEmbeddedTest}. Здесь — что пять написаний остались одной личностью и что составное
     * значение больше не проходит текстом.
     */
    @Test
    void ownerSpellingsOfTheOwnerCollapseToOneIdentity() {
        assertEquals(java.util.Set.of("owner", "владелец", "владелица", "alexa", "omiloreadmin"), QuestionOwner.OWNER_ALIASES);
        assertEquals("omiloreadmin", QuestionOwner.OWNER_IDENTITY);
    }

    @Test
    void compositeOwnerIsNoLongerWrittenAsText() {
        java.util.List<java.util.Map<String, Object>> users = java.util.List.of(
            java.util.Map.of("kc_sub", "52f6-uuid", "display_name", "omiloreadmin"));
        assertNotNull(QuestionOwner.resolve("owner + claude", users, java.util.List.of()).refusal(),
            "составное значение — не запись реестра: отказ, а не текст в поле");
    }
}
