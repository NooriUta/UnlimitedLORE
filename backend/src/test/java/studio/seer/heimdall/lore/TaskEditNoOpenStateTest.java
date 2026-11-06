package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH, Б6 (06.11.2026) — корень «ни один
 * вызов не отвечает успехом, не выполнив работу».
 *
 * <p>Замер прода read-only 06.11: у 24 задач НЕТ открытой строки истории
 * (единственная строка закрыта, например SPRINT_DALI_DIALECTS_LORE_VIZ/DLG-01).
 * task_set с note_md/effort_days писал вершину, а зеркало в историю — UPDATE …
 * WHERE valid_to IS NULL — не находило ничего, и ответ был ok:true. Срезы
 * читают заметку и оценку из открытой строки, поэтому правка не видна нигде.
 *
 * <p>Правило: если правка обязана лечь в историю, а открытой строки нет, — отказ
 * ДО записи с инструкцией, а не успех. Правка полей, живущих только на вершине
 * (title, task_type, work_class), открытой строки не требует.
 */
class TaskEditNoOpenStateTest {

    @Test
    void histFieldsWithoutOpenRowAreRefused() {
        assertNotNull(LoreSprintTaskResource.noOpenStateRefusal("S/T", "заметка", null, 0));
        assertNotNull(LoreSprintTaskResource.noOpenStateRefusal("S/T", null, 0.5, 0));
    }

    @Test
    void refusalExplainsWhatToDo() {
        String r = LoreSprintTaskResource.noOpenStateRefusal("S/T", "заметка", null, 0);
        assertTrue(r.contains("S/T"), r);
        assertTrue(r.contains("status_set"), "говорит, как открыть строку: " + r);
    }

    @Test
    void vertexOnlyEditsDoNotNeedAnOpenRow() {
        assertNull(LoreSprintTaskResource.noOpenStateRefusal("S/T", null, null, 0),
            "заголовок/тип/класс живут на вершине — отказ был бы ложным");
    }

    @Test
    void normalTaskWithAnOpenRowPasses() {
        assertNull(LoreSprintTaskResource.noOpenStateRefusal("S/T", "заметка", 0.5, 1));
    }
}
