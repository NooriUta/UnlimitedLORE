package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-CAL-BOOKKEEPING.
 *
 * <p>Много задач заводится и закрывается в один заход как запись уже сделанной
 * работы: 4–5 ноября закрыто 45 спринтов разом. Их done_date — дата простановки
 * статуса, а не дата работы, и они топят пропускную способность и любую
 * калибровку. Флаг {@code bookkeeping} на вершине задачи говорит «это запись
 * задним числом» — аналитика исключает такие задачи и говорит, сколько исключила.
 */
class TaskBookkeepingFlagTest {

    @Test
    void schemaStepDeclaresBoolean() {
        LoreSchemaMigrations.Step step = LoreSchemaMigrations.STEPS.stream()
            .filter(s -> s.name().equals("task_bookkeeping")).findFirst().orElseThrow(
                () -> new AssertionError("шаг схемы task_bookkeeping не зарегистрирован"));
        assertEquals(17, step.compatMajor());
        assertEquals(List.of("CREATE PROPERTY KnowTask.bookkeeping IF NOT EXISTS BOOLEAN"), step.sql());
        assertEquals(59, step.version(), "V59 — сразу после task_actual_days");
    }

    @Test
    void createAndEditCarryTheFlag() {
        for (Class<?> rec : List.of(LoreSprintTaskResource.TaskCreateRequest.class,
                                    LoreSprintTaskResource.TaskEditRequest.class)) {
            assertTrue(java.util.Arrays.stream(rec.getRecordComponents())
                    .anyMatch(rc -> rc.getName().equals("bookkeeping") && rc.getType() == Boolean.class),
                rec.getSimpleName() + " принимает bookkeeping (Boolean, null = не трогать)");
        }
    }

    @Test
    void vertexUpdateWritesTheFlagOnlyWhenSupplied() {
        var on = LoreSprintTaskResource.taskVertexUpdate("S/T-1", "t", null, null, null, true,
            null, null, null, null, null);
        assertTrue(on.command().contains("bookkeeping = :bk"), on.command());
        assertEquals(true, on.params().get("bk"));
        var off = LoreSprintTaskResource.taskVertexUpdate("S/T-1", "t", null, null, null, false,
            null, null, null, null, null);
        assertEquals(false, off.params().get("bk"), "флаг можно снять явно");
        var none = LoreSprintTaskResource.taskVertexUpdate("S/T-1", "t", null, null, null, null,
            null, null, null, null, null);
        assertFalse(none.command().contains("bookkeeping"), "правка без флага его не трогает: " + none.command());
    }

    @Test
    void analyticsAndTaskSlicesReturnTheFlag() {
        Map<String, Map<String, String>> slices = Map.of(
            "task_done_dates", Map.of(),
            "invest_profile", Map.of(),
            "tasks_of_sprint", Map.of("sprint_id", "SPRINT_X"),
            "tasks_by_uids", Map.of("task_uids", "SPRINT_X/T-1"),
            "tasks_of_sprints_batch", Map.of("sprint_ids", "SPRINT_X"));
        slices.forEach((slice, p) -> {
            String sql = LoreSlices.compose(slice, p).sql();
            assertTrue(sql.contains("bookkeeping"), slice + " отдаёт bookkeeping: " + sql);
        });
    }
}
