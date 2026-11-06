package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH, A11 (06.11.2026).
 *
 * <p>search(q="Q-CI-LOGS-NOT-PERSISTED") отвечал {@code hits: []}: дефис
 * вырезается как метасимвол, слово NOT остаётся отдельным токеном, и Lucene
 * читает его как ОПЕРАТОР — «(Q) AND (CI) AND (LOGS) AND (NOT) AND …» не
 * разбирается ни в одной из 15 ветвей. Ошибка была неотличима от пустой базы.
 *
 * <p>Два правила: (1) слова-операторы Lucene (AND, OR, NOT, TO) из
 * пользовательского ввода — термы, а не операторы: уходят в нижнем регистре
 * (анализатор приводит термы к нижнему регистру всё равно); (2) ответ сам
 * говорит, что поиск не выполнен, — outcome, а не голые hits:[].
 */
class SearchOperatorWordsTest {

    @Test
    void operatorWordsFromUserInputAreTerms() {
        String q = LoreSearchResource.buildLuceneQuery("Q-CI-LOGS-NOT-PERSISTED", "smart");
        assertFalse(q.matches(".*\\bNOT\\b.*"), "NOT как оператор ломал разбор: " + q);
        assertTrue(q.contains("(not)"), "NOT стал термом: " + q);
        for (String w : new String[] {"AND", "OR", "TO"}) {
            String s = LoreSearchResource.buildLuceneQuery("alpha " + w + " beta", "smart");
            assertTrue(s.contains("(" + w.toLowerCase() + ")"), w + " стал термом: " + s);
        }
    }

    @Test
    void ourOwnOperatorsStayOperators() {
        // Положительный контроль: связки, которые ставит сам сервер, не тронуты.
        String q = LoreSearchResource.buildLuceneQuery("релиз проекта", "smart");
        assertEquals("(релиз) AND (проекта OR проекта*)", q);
    }

    @Test
    void outcomeSaysWhetherTheSearchRan() {
        assertEquals("failed", LoreSearchResource.outcomeOf(15, 15, 0), "все ветки упали — это не «пусто»");
        assertEquals("partial_failure", LoreSearchResource.outcomeOf(15, 3, 0), "пусто при упавших ветках недостоверно");
        assertEquals("partial_failure", LoreSearchResource.outcomeOf(15, 3, 7));
        assertEquals("empty", LoreSearchResource.outcomeOf(15, 0, 0), "честно пусто");
        assertEquals("found", LoreSearchResource.outcomeOf(15, 0, 4));
        assertEquals("empty", LoreSearchResource.outcomeOf(0, 0, 0), "ни одной ветки по фильтру — пусто, не сбой");
    }
}
