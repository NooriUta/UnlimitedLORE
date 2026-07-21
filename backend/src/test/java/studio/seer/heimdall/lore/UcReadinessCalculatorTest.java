package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * PL-15 · ADR-LORE-029 (D17): правило готовности как ЧИСТАЯ функция — без БД,
 * без REST. Само правило важнее механики его применения: если оно неверно,
 * расхождение «сценарий выпущен, задачи открыты» вернётся, сколько бы точек
 * пересчёта мы ни расставили.
 */
class UcReadinessCalculatorTest {

    private static String compute(int tt, int td, int kt, int ks, int kr, boolean was) {
        return UcReadinessCalculator.compute(tt, td, kt, ks, kr, was);
    }

    /**
     * Считать не из чего — статус не трогаем. Свежий сценарий без задач и детей
     * несёт намерение автора (proposed); перезаписать его в «active» значило бы
     * объявить работу, которой нет.
     */
    @Test
    void nothingToComputeFromLeavesTheIntentAlone() {
        assertNull(compute(0, 0, 0, 0, 0, false));
    }

    @Test
    void allTasksDoneMeansShipped() {
        assertEquals("shipped", compute(3, 3, 0, 0, 0, false));
    }

    @Test
    void anyOpenTaskMeansActive() {
        assertEquals("active", compute(3, 2, 0, 0, 0, false));
        assertEquals("active", compute(1, 0, 0, 0, 0, false));
    }

    /** Родитель закрыт, когда закрыты все дети. */
    @Test
    void parentFollowsItsChildren() {
        assertEquals("shipped", compute(0, 0, 2, 2, 0, false));
        assertEquals("active",  compute(0, 0, 2, 1, 0, false));
    }

    /**
     * Смешанный узел — со своими задачами И детьми — не должен объявляться
     * выпущенным по одной половине. Это самая правдоподобная ошибка правила:
     * посчитать только задачи и не заметить незакрытых детей.
     */
    @Test
    void mixedNodeNeedsBothHalvesClosed() {
        assertEquals("active", compute(2, 2, 2, 1, 0, false), "задачи закрыты, дети нет");
        assertEquals("active", compute(2, 1, 2, 2, 0, false), "дети закрыты, задачи нет");
        assertEquals("shipped", compute(2, 2, 2, 2, 0, false), "закрыто всё");
    }

    /**
     * OQ-022-REENG, вариант «б»: открытая работа поверх уже выпущенного — это
     * ДОРАБОТКА, а не откат к «делается». Факт выпуска состоялся и не должен
     * исчезать из отчётности; иначе «выпускали ли мы это вообще» станет
     * невосстановимым после первой же правки.
     */
    @Test
    void reworkKeepsTheFactOfRelease() {
        assertEquals("in_rework", compute(3, 2, 0, 0, 0, true));
        // Доработка закрыта — узел снова выпущен.
        assertEquals("shipped", compute(3, 3, 0, 0, 0, true));
    }

    /** Доработка ребёнка поднимает родителя в in_rework, а не в active. */
    @Test
    void reworkPropagatesUpwards() {
        assertEquals("in_rework", compute(0, 0, 3, 2, 1, false));
    }

    /**
     * Приоритет: если ребёнок в доработке, узел «в доработке» независимо от
     * того, выпускался ли он сам. Обратный порядок проверок дал бы active у
     * никогда не выпускавшегося родителя с дорабатываемым ребёнком — то есть
     * потерю сигнала.
     */
    @Test
    void childReworkWinsOverNeverShipped() {
        assertEquals("in_rework", compute(0, 0, 2, 1, 1, false));
    }
}
