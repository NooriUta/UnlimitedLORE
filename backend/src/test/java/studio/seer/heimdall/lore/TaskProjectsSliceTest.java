package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Владелица 19.11.2026: «в задачках … добавь группировку по проекту и везде где есть проект делай группировку по
 * проекту правило если проектов несколько в каждую группу механика универсальная для всех объектов связанных многие
 * ко многим». Проект задачи — проекты её спринта (PART_OF → BELONGS_TO_PROJECT), поле многозначное.
 */
class TaskProjectsSliceTest {

    @Test
    void срезы_раздела_задачи_отдают_проекты_задачи() {
        for (String slice : new String[]{"open_tasks", "closed_tasks"}) {
            String sql = LoreSlices.compose(slice, Map.of()).sql();
            assertTrue(sql.contains("out('PART_OF').out('BELONGS_TO_PROJECT').slug AS project_slugs"), slice + ": " + sql);
        }
    }
}
