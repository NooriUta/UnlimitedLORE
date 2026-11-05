package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_PRODUCT_BACKLOG/SE-08: task_starts отдавал task_id без спринта — среди
 * завершённых задач 220 кодов встречаются больше чем в одном спринте (HK-1, T-06…),
 * и соединить старты с задачами спринта по голому коду нельзя (молчаливая смесь).
 * Правило владельца: задача — парой «спринт/код». Все срезы задачных дат несут task_uid;
 * task_id оставлен, чтобы не ломать читателей.
 */
class TaskStartsCarriesUidTest {

    @Test
    void everyTaskDateSliceCarriesTaskUid() {
        for (String id : new String[]{"task_starts", "task_done_dates", "task_created_dates"}) {
            String sql = LoreSlices.compose(id, Map.of()).sql();
            assertTrue(sql.contains("AS task_uid"), id + " обязан отдавать task_uid: " + sql);
        }
    }

    @Test
    void taskStartsKeepsTaskIdForExistingReaders() {
        assertTrue(LoreSlices.compose("task_starts", Map.of()).sql().contains("AS task_id"));
    }
}
