package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_QG_REBUILD/QG-16: причина блокировки спринта.
 *
 * <p>Повод (Q-2026-BLOCKED-SPRINTS-ARE-MISLABELLED): срез {@code blocked_sprints}
 * перебирал ВСЕ строки истории — по строке на каждую blocked-ревизию (дубли
 * ×2/×3), посчитать по нему было нельзя. Причины блокировки в модели не было.
 *
 * <p>Владелица 06.11: «достаточно если объясняется блокировка … главное чтобы
 * инструмент знал причину» — причина пишется текстом в status_set.
 */
class BlockedSprintsReasonTest {

    private static String sql(String slice) {
        return LoreSlices.compose(slice, Map.of()).sql();
    }

    @Test
    void everBlockedKeepsItsMeaningButOneRowPerSprint() {
        // LoreAnalytics «Blocked rate» считает спринты, КОГДА-ЛИБО бывшие blocked —
        // этот смысл не трогаем (иначе метрика молча сменит определение), убираем дубли.
        String s = sql("blocked_sprints");
        assertTrue(s.contains("FROM KnowSprint "), "строка на спринт, а не на ревизию: " + s);
        assertFalse(s.contains("FROM KnowSprintHist"), s);
        assertTrue(s.contains("out('HAS_STATE')[status_raw LIKE '%BLOCK%']"), "любая ревизия, не только открытая: " + s);
        assertFalse(s.contains("valid_to IS NULL"), "«когда-либо», а не «сейчас»: " + s);
    }

    @Test
    void reasonSliceIsCurrentStateOnly() {
        String s = sql("blocked_sprints_reason");
        assertTrue(s.contains("FROM KnowSprint "), s);
        assertTrue(s.contains("WHERE out('HAS_STATE')[valid_to IS NULL AND status_raw LIKE '%BLOCK%']"),
            "заблокирован СЕЙЧАС — по открытой строке истории: " + s);
    }

    @Test
    void reasonSliceCarriesTheExplanation() {
        String s = sql("blocked_sprints_reason");
        for (String col : new String[] {"name", "block_reason", "task_count", "deps", "open_deps", "open_questions"}) {
            assertTrue(s.contains(" AS " + col), "колонка " + col + ": " + s);
        }
    }

    @Test
    void openDependencyMeansNotDoneAndNotCancelled() {
        String s = sql("blocked_sprints_reason");
        assertTrue(s.contains("out('DEPENDS_ON')[out('HAS_STATE')[valid_to IS NULL AND ("), s);
        assertTrue(s.contains(LoreStatusVocabulary.anySql("status_raw", "done", "cancelled")), s);
    }

    @Test
    void hintOnlyWhenBlockingWithoutReason() {
        assertNotNull(LoreStatusResource.blockReasonHint("sprint", "blocked", null));
        assertNotNull(LoreStatusResource.blockReasonHint("sprint", "blocked", "   "));
        assertNull(LoreStatusResource.blockReasonHint("sprint", "blocked", "ждёт ответа заказчика"));
        assertNull(LoreStatusResource.blockReasonHint("sprint", "active", null));
        assertNull(LoreStatusResource.blockReasonHint("task", "blocked", null), "причина — у спринтов");
    }

    @Test
    void openQuestionGatingAClosedTaskIsListed() {
        // Проверка 5: открытый вопрос держит задачу, которая уже done/cancelled.
        String s = sql("questions_gating_closed_tasks");
        assertTrue(s.contains("FROM KnowQuestion WHERE status <> 'closed'"), s);
        assertTrue(s.contains("out('GATES')[out('HAS_STATE')[valid_to IS NULL AND ("), "закрытость — по ТЕКУЩЕМУ состоянию задачи: " + s);
        assertTrue(s.contains(LoreStatusVocabulary.anySql("status_raw", "done", "cancelled")), s);
        assertTrue(s.contains(" AS closed_tasks") && s.contains(" AS owner"), s);
    }

    @Test
    void closingATaskMarksItsGatesSolvedAndReopeningUnmarks() {
        // QG-17: ребро не снимается, только метка.
        String done = LoreStatusResource.gatesSolvedSql("done");
        assertTrue(done.startsWith("UPDATE GATES SET solved_at = :now"), done);
        assertEquals(done, LoreStatusResource.gatesSolvedSql("cancelled"));
        String reopen = LoreStatusResource.gatesSolvedSql("active");
        assertTrue(reopen.contains("solved_at = null"), reopen);
        for (String q : new String[] {done, reopen}) {
            assertFalse(q.toUpperCase().contains("DELETE"), "связь не удаляется: " + q);
            assertTrue(q.contains("@in.task_uid = :id"), q);
        }
    }

    @Test
    void gatingQuestionsOfTaskIgnoreSolvedLinks() {
        String s = LoreSlices.compose("gating_questions_of_task", Map.of("id", "SPRINT_X/T-1")).sql();
        assertTrue(s.contains("outE('GATES')[solved_at IS NULL]"), s);
    }
}
