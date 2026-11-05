package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-03, рекомендация 2 для {@code enb}: правило
 * «enabler обоснован ADR» считается от даты, с 1 августа 2026.
 *
 * <p>Замер по месяцам (31.08): соблюдение по enb — июнь 0 %, июль 2 %, август
 * 55 %. Правило работает; мешает хвост июня–июля (393 находки из 632), где
 * класс работы проставляли задним числом и ADR не подбирали. Срез без отсечки
 * показывал 632 строки и был нечитаем, при этом ослаблять само правило не нужно.
 *
 * <p>Отсечка — по ДАТЕ ЗАВЕДЕНИЯ задачи (самая ранняя строка истории), а не по
 * дате текущего состояния: иначе любая правка июльской задачи вернула бы её
 * в список.
 */
class UnlinkedEnbSinceTest {

    @Test
    void enbSliceCountsOnlyTasksCreatedSinceTheRuleDate() {
        String sql = LoreSlices.compose("unlinked_enb_tasks", Map.of()).sql();
        assertTrue(sql.contains("work_class = 'enb'"), sql);
        assertTrue(sql.contains("out('JUSTIFIED_BY').size() = 0"), "суть правила не тронута: " + sql);
        assertTrue(sql.contains("[valid_from < date('" + LoreSlices.ENB_RULE_SINCE + "', 'yyyy-MM-dd')].size() = 0"),
            "отсечка по самой ранней строке истории (дата заведения), а не по текущей: " + sql);
        assertEquals("2026-08-01", LoreSlices.ENB_RULE_SINCE);
    }

    @Test
    void ucSliceIsNotCutByDate() {
        // По uc рекомендация другая (гейт/подсказка — решение по ADR-LORE-022 D3),
        // отсечка по дате к нему не применяется.
        String sql = LoreSlices.compose("unlinked_uc_tasks", Map.of()).sql();
        assertFalse(sql.contains("valid_from <"), sql);
    }
}
