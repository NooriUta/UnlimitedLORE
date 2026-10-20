package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_SLICE_ERGONOMICS/SE-16: списочный параметр среза доходит до СУБД
 * СПИСКОМ.
 *
 * <p>Причина дефекта доказана замером на проде 20.10.2026 (только чтение):
 * {@code sprint_id IN :ids} с {@code ids = ["A","B"]} отдаёт обе строки, а с
 * {@code ids = "A,B"} — пусто. Слой срезов передавал строку как есть, хотя
 * комментарий у tasks_of_sprints_batch обещал разбор. Пакетный срез работал
 * только с одним элементом, и пустой ответ выглядел как «задач нет».
 *
 * <p>Правило: параметр с именем на {@code _ids} или {@code _uids} — список через
 * запятую. Каждый элемент проверяется тем же белым списком значений, что
 * одиночный параметр; длина проверяется у элемента, а не у всей строки.
 */
class LoreSliceListParamsTest {

    @Test
    void commaSeparatedIdsBecomeAList() {
        var c = LoreSlices.compose("tasks_of_sprints_batch", Map.of("sprint_ids", "SPRINT_A, SPRINT_B"));
        assertEquals(List.of("SPRINT_A", "SPRINT_B"), c.params().get("sprint_ids"));
    }

    @Test
    void singleIdIsStillAListOfOne() {
        var c = LoreSlices.compose("tasks_of_sprints_batch", Map.of("sprint_ids", "SPRINT_A"));
        assertEquals(List.of("SPRINT_A"), c.params().get("sprint_ids"));
    }

    @Test
    void emptyElementsAreDropped() {
        var c = LoreSlices.compose("tasks_of_sprints_batch", Map.of("sprint_ids", "SPRINT_A,,SPRINT_B,"));
        assertEquals(List.of("SPRINT_A", "SPRINT_B"), c.params().get("sprint_ids"));
    }

    @Test
    void longListIsAllowedWhileEachElementIsChecked() {
        // Двадцать uid длиннее 160 символов — лимита одиночного значения. Список
        // ограничен по элементам, иначе пакетное чтение упиралось бы в длину строки.
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 20; i++) sb.append(i == 0 ? "" : ",").append("SPRINT_LORE_SLICE_ERGONOMICS");
        var c = LoreSlices.compose("tasks_of_sprints_batch", Map.of("sprint_ids", sb.toString()));
        assertEquals(20, ((List<?>) c.params().get("sprint_ids")).size());
    }

    @Test
    void badElementIsRejectedNotSilentlyDropped() {
        var e = assertThrows(IllegalArgumentException.class,
            () -> LoreSlices.compose("tasks_of_sprints_batch", Map.of("sprint_ids", "SPRINT_A,x'; DROP")));
        assertTrue(e.getMessage().contains("sprint_ids"), e.getMessage());
    }

    @Test
    void listWithNoElementsIsRejected() {
        assertThrows(IllegalArgumentException.class,
            () -> LoreSlices.compose("tasks_of_sprints_batch", Map.of("sprint_ids", " , ")));
    }

    @Test
    void ordinaryParamStaysAString() {
        var c = LoreSlices.compose("open_tasks", Map.of("sprint", "SPRINT_A,SPRINT_B"));
        assertEquals("SPRINT_A,SPRINT_B", c.params().get("sprint"));
    }
}
