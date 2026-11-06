package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-CAL-ACTUAL.
 *
 * <p>Калибровка оценок 06.11.2026: коэффициента «оценка → факт» нет, потому что
 * факта нет — он выводился только из истории статусов, а у 75% закрытых задач
 * рабочего статуса не было никогда. Измеримых пар — 14%.
 *
 * <p>Поле {@code actual_days} — на ВЕРШИНЕ KnowTask (как work_class), не в Hist:
 * факт не версионируется, и carry-forward Hist-полей при смене статуса
 * (ловушка ADR-021) его не касается.
 */
class TaskActualDaysTest {

    @Test
    void schemaStepDeclaresTheTypeSoTheCallerDoesNotDecideIt() {
        // RM-P12: необъявленное поле получает тип от первого пишущего.
        LoreSchemaMigrations.Step step = LoreSchemaMigrations.STEPS.stream()
            .filter(s -> s.name().equals("task_actual_days")).findFirst().orElseThrow(
                () -> new AssertionError("шаг схемы task_actual_days не зарегистрирован"));
        assertEquals(17, step.compatMajor(), "аддитивный шаг — major не растёт");
        assertEquals(List.of("CREATE PROPERTY KnowTask.actual_days IF NOT EXISTS DOUBLE"), step.sql());
        assertEquals(58, step.version(), "V58 — версия закреплена: «шаг последний» ломался бы каждым следующим шагом");
    }

    @Test
    void editRequestCarriesTheFact() {
        var c = LoreSprintTaskResource.TaskEditRequest.class.getRecordComponents();
        assertTrue(java.util.Arrays.stream(c).anyMatch(rc -> rc.getName().equals("actual_days")
                && rc.getType() == Double.class),
            "task/edit принимает actual_days (Double, человеко-дни)");
    }

    @Test
    void vertexUpdateWritesTheFactOnlyWhenSupplied() {
        var with = LoreSprintTaskResource.taskVertexUpdate("S/T-1", "t", null, null, 1.5, null,
            null, null, null, null, null);
        assertTrue(with.command().contains("actual_days = :act"), with.command());
        assertEquals(1.5, with.params().get("act"));

        var without = LoreSprintTaskResource.taskVertexUpdate("S/T-1", "t", null, null, null, null,
            null, null, null, null, null);
        assertFalse(without.command().contains("actual_days"),
            "правка без факта не стирает записанный факт: " + without.command());
    }

    @Test
    void taskSlicesReturnTheFactNextToTheEstimate() {
        for (String slice : List.of("tasks_of_sprint", "tasks_by_uids", "tasks_of_sprints_batch")) {
            Map<String, String> p = switch (slice) {
                case "tasks_of_sprint" -> Map.of("sprint_id", "SPRINT_X");
                case "tasks_by_uids" -> Map.of("task_uids", "SPRINT_X/T-1");
                default -> Map.of("sprint_ids", "SPRINT_X");
            };
            String sql = LoreSlices.compose(slice, p).sql();
            assertTrue(sql.contains("actual_days"), slice + " отдаёт actual_days: " + sql);
        }
    }
}
