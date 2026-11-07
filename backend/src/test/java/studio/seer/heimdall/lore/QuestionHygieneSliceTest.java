package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH, A4 · A8 · A10 (06.11.2026).
 *
 * <p>Срез гигиены вопросов — сырые факты по открытым и отложенным, из которых
 * видно три вида бардака:
 * <ul>
 *   <li>A4 — решение есть, связи нет: decision_candidates — решения, чьи refs_raw
 *       упоминают id вопроса (за день 06.11 три таких случая дошли до владелицы);</li>
 *   <li>A8 — отложенный с триггером, который никто не перечитывает: trigger на виду;</li>
 *   <li>A10 — вопрос живёт в ЗАКРЫТОМ спринте или ни в каком: raised_sprint_status.</li>
 * </ul>
 *
 * <p><b>Без ORDER BY — намеренно.</b> Замер на проде 06.11: с ORDER BY
 * ArcadeDB теряет корреляцию {@code $parent.$current} в LET, условие вырождается
 * в {@code LIKE '%%'}, и КАЖДОМУ вопросу приписываются все 552 решения (186 из
 * 186 «с кандидатом»). Без ORDER BY — 35 из 204, максимум 2. LIMIT и условие
 * скоупа корреляцию не ломают (проверено). Сортирует потребитель.
 */
class QuestionHygieneSliceTest {

    @Test
    void sliceReturnsTheThreeKindsOfMess() {
        String sql = LoreSlices.compose("question_hygiene", Map.of()).sql();
        for (String col : List.of("question_id", "status", "owner", "`trigger`", "due_date",
                                  "raised_sprints", "raised_sprint_status", "decision_candidates"))
            assertTrue(sql.contains(col), "колонка " + col + ": " + sql);
        assertTrue(sql.contains("$parent.$current.question_id"), "кандидаты ищутся по id вопроса: " + sql);
        assertTrue(sql.contains("status IN ['open', 'deferred']"), sql);
    }

    @Test
    void noOrderByBecauseItBreaksLetCorrelation() {
        String plain = LoreSlices.compose("question_hygiene", Map.of()).sql();
        String scoped = LoreSlices.compose("question_hygiene", Map.of(), Set.of("NooriUta/UnlimitedLORE")).sql();
        for (String sql : List.of(plain, scoped))
            assertFalse(sql.toUpperCase().contains("ORDER BY"),
                "ORDER BY ломает LET: всем вопросам приписываются все решения: " + sql);
    }

    @Test
    void scopedLikeTheQuestionsSlice() {
        assertEquals(LoreSlices.PROJECT_SCOPED.get("questions"), LoreSlices.PROJECT_SCOPED.get("question_hygiene"),
            "гигиена вопросов видна ровно тем, кому видны сами вопросы");
    }
}
