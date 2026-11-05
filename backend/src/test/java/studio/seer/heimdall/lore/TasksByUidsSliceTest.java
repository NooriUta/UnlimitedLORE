package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_PRODUCT_BACKLOG/SE-01, шаг 1 (пункт 4 mig_gen): после списка задач
 * нужно прочитать 10–20 заметок — раньше либо по одной, либо весь спринт целиком
 * (78–90 КБ ради трёх заметок). {@code tasks_by_uids} читает задачи по списку uid
 * тем же механизмом списочных параметров, что SE-16.
 */
class TasksByUidsSliceTest {

    @Test
    void sliceIsRegisteredWithRequiredUidList() {
        LoreSlices.SliceDef def = LoreSlices.get("tasks_by_uids");
        assertNotNull(def, "срез tasks_by_uids зарегистрирован");
        assertEquals(List.of("task_uids"), def.required());
    }

    @Test
    void uidsGoToTheDatabaseAsAList() {
        var c = LoreSlices.compose("tasks_by_uids",
            Map.of("task_uids", "SPRINT_A/T-1, SPRINT_B/T-2"));
        assertEquals(List.of("SPRINT_A/T-1", "SPRINT_B/T-2"), c.params().get("task_uids"));
        assertTrue(c.sql().contains("task_uid IN :task_uids"), c.sql());
    }

    @Test
    void readsTheNoteAndTheBoardFields() {
        String sql = LoreSlices.compose("tasks_by_uids", Map.of("task_uids", "S/T")).sql();
        for (String col : List.of("task_uid", "title", "status_raw", "note_md", "sprint_id", "effort_days"))
            assertTrue(sql.contains(col), "колонка " + col + " в выдаче: " + sql);
    }

    @Test
    void missingListIsRefused() {
        assertThrows(IllegalArgumentException.class, () -> LoreSlices.compose("tasks_by_uids", Map.of()));
    }
}
