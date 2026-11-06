package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Находка среза I (SPRINT_LORE_PRODUCT_BACKLOG/AN-06, 06.11.2026, выгрузка прода):
 * три выпущенных сценария — UC-KNOW-DECISION, UC-KNOW-FIND, UC-TOOLS-LAZY-NAMES —
 * стояли в in_rework только потому, что к ним привязаны ОТМЕНЁННЫЕ задачи.
 * Вычислитель считал отменённую задачу в знаменателе и не считал закрытой:
 * сценарий не мог выйти из переделки никогда.
 *
 * <p>Правило: отмена — не работа. Отменённая задача не входит ни в «всего», ни
 * в «закрыто». «Закрыто» и «отменено» — из единого словаря статусов
 * (LoreStatusVocabulary), якорем в начале строки, а не подстрокой: подстрока
 * {@code '%DONE%'} считала закрытой «⬜ TODO — (V1 ✅ DONE…)».
 */
class UcReadinessCancelledTest {

    @Test
    void cancelledTasksDoNotHoldAShippedUseCaseInRework() {
        // 3 задачи закрыты, 3 отменены, выпускался раньше.
        assertEquals("shipped", UcReadinessCalculator.compute(6, 3, 3, 0, 0, 0, true));
    }

    @Test
    void cancelledTasksDoNotCountAsOpenWorkForANewUseCase() {
        assertEquals("shipped", UcReadinessCalculator.compute(2, 1, 1, 0, 0, 0, false));
    }

    @Test
    void openWorkBesideCancelledStillMeansRework() {
        // 3 закрыты, 1 отменена, 1 открыта — переделка настоящая.
        assertEquals("in_rework", UcReadinessCalculator.compute(5, 3, 1, 0, 0, 0, true));
    }

    @Test
    void allCancelledLeavesTheStoredStatusAlone() {
        // Считать не из чего — как у сценария без задач: намерение автора не перебиваем.
        assertNull(UcReadinessCalculator.compute(2, 0, 2, 0, 0, 0, false));
    }

    @Test
    void readinessSqlUsesTheSharedVocabularyAnchoredNotSubstring() {
        String sql = UcReadinessCalculator.READINESS_SQL;
        assertTrue(sql.contains(LoreStatusVocabulary.anySql("status_raw", "done")),
            "«закрыто» — из словаря статусов: " + sql);
        assertTrue(sql.contains(LoreStatusVocabulary.anySql("status_raw", "cancelled")),
            "«отменено» считается отдельно: " + sql);
        assertFalse(sql.contains("'%DONE%'"),
            "подстрока считала закрытой «⬜ TODO — (V1 ✅ DONE…)»: " + sql);
        assertTrue(sql.contains("AS task_cancelled"), sql);
    }
}
