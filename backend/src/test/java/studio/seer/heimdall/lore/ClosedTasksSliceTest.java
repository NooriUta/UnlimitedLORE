package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Аудит UX 09.11, D-30 — порционная подгрузка закрытых задач в разделе «Задачи» v2.
 * Раздел читает open_tasks; закрытым нужен свой срез той же проекции. Страница —
 * общие limit/offset с page.total/has_more (SlicePage), поэтому потолка у среза нет.
 */
class ClosedTasksSliceTest {

    @Test
    void closedTasksAreDoneOrCancelledFromTheOpenHistoryRow() {
        String sql = LoreSlices.compose("closed_tasks", Map.of()).sql();
        assertTrue(sql.contains("FROM KnowTask"), sql);
        assertTrue(sql.contains("out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0] LIKE"), "статус — из истории: " + sql);
        assertFalse(sql.contains("note_md"), "облегчённая проекция, как open_tasks: " + sql);
        assertFalse(sql.toUpperCase().contains(" LIMIT "), "без потолка — страница через limit/offset: " + sql);
    }

    /** «done ИЛИ cancelled» — через OR; без скобок фильтр через AND лёг бы только на последнюю ветку. */
    @Test
    void orGroupIsParenthesizedBeforeFilters() {
        String sql = LoreSlices.compose("closed_tasks", Map.of("project", "org/a", "sprint", "S1")).sql();
        int where = sql.indexOf(" WHERE (");
        assertTrue(where > 0, "условие закрытости в скобках: " + sql);
        int close = sql.indexOf(") AND ", where);
        assertTrue(close > where, "фильтры идут ПОСЛЕ закрытой скобки: " + sql);
        assertTrue(sql.indexOf("CONTAINS :project") > close && sql.indexOf("CONTAINS :sprint") > close, sql);
    }

    @Test
    void scopedLikeOpenTasks() {
        assertEquals(LoreSlices.PROJECT_SCOPED.get("open_tasks"), LoreSlices.PROJECT_SCOPED.get("closed_tasks"),
            "тот же проектный скоуп, что у open_tasks");
    }
}
