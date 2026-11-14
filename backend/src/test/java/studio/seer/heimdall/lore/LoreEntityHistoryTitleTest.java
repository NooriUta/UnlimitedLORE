package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_PRODUCT_BACKLOG/MINI-06-RECORD-HISTORY-RELATIONS — «история записи X» одним путём
 * ({@code GET /lore/history?type=&id=}) несёт и заголовок записи: мобилке больше не нужно собирать его
 * из второго среза (у {@code history_task} заголовка не было). Заголовок читается с вершины-владельца
 * цепочки по тому же полю id, что и сама цепочка; поле имени у типов разное — берётся первое непустое.
 */
class LoreEntityHistoryTitleTest {

    @Test
    void everyHistoryTypeExceptDictHasTitleQueryAgainstItsOwnerVertex() {
        for (String type : LoreEntityHistory.types()) {
            if ("dict_entry".equals(type)) {
                assertNull(LoreEntityHistory.titleSql(type), "у строки справочника заголовка-вершины нет");
                continue;
            }
            String sql = LoreEntityHistory.titleSql(type);
            assertNotNull(sql, type);
            assertTrue(sql.contains(" AS title "), type + ": " + sql);
            assertTrue(sql.contains(":id"), type + ": параметр, не склейка: " + sql);
            assertFalse(sql.contains("Hist "), type + ": заголовок — с вершины, не с цепочки: " + sql);
        }
    }

    @Test
    void ownerVertexAndIdFieldMatchTheChain() {
        assertEquals("SELECT coalesce(title, name, label) AS title FROM KnowTask WHERE task_uid = :id LIMIT 1",
            LoreEntityHistory.titleSql("task"));
        assertEquals("SELECT coalesce(title, name, label) AS title FROM KnowSprint WHERE sprint_id = :id LIMIT 1",
            LoreEntityHistory.titleSql("sprint"));
        assertEquals("SELECT coalesce(title, name, label) AS title FROM KnowMilestone WHERE milestone_id = :id LIMIT 1",
            LoreEntityHistory.titleSql("milestone"));
    }

    @Test
    void unknownTypeIsRefusedNotNull() {
        assertThrows(IllegalArgumentException.class, () -> LoreEntityHistory.titleSql("nope"));
    }
}
