package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S9_SCALE_OPT/S9-05, решение владелицы D14 (14.11.2026) — «колонки по типу ребёнка»:
 * в таблице детей паспорта-родителя (веха, компонент, человек, агент, релиз, проект) у задач —
 * исполнитель, оценка, класс работы; у спринтов — прогресс x/y и даты плана. Фасад /lore/record
 * отдаёт эти значения в элементе связи ключом {@code values}; срезы детей их читают.
 */
class ChildColumnsByTypeTest {

    /** Вкладки-дети с задачами и спринтами, читаемые срезом. */
    private static List<LoreRecordFrom.SliceLink> childLinks(String childType) {
        return LoreRecordFrom.SLICE_LINKS.values().stream().flatMap(List::stream)
            .filter(sl -> childType.equals(sl.type())).toList();
    }

    @Test
    void taskChildSlicesReadExecutorEffortAndWorkClass() {
        List<LoreRecordFrom.SliceLink> tasks = childLinks("task");
        assertTrue(tasks.size() >= 3, "задачи-дети у компонента, человека и агента: " + tasks);
        for (LoreRecordFrom.SliceLink sl : tasks) {
            String sql = LoreSlices.get(sl.slice()).baseSql();
            assertFalse(sql.contains("LIKE"), sl.slice() + " — без подбора по LIKE: " + sql);
            assertTrue(sql.contains("executor_agent"), sl.slice() + " — исполнитель: " + sql);
            assertTrue(sql.contains("effort_days"), sl.slice() + " — оценка: " + sql);
            assertTrue(sql.contains("work_class"), sl.slice() + " — класс работы: " + sql);
        }
    }

    @Test
    void sprintChildSlicesReadProgressAndPlanDates() {
        List<LoreRecordFrom.SliceLink> sprints = childLinks("sprint");
        assertTrue(sprints.size() >= 4, "спринты-дети у вехи, компонента, релиза и проекта: " + sprints);
        for (LoreRecordFrom.SliceLink sl : sprints) {
            String sql = LoreSlices.get(sl.slice()).baseSql();
            assertFalse(sql.contains("LIKE"), sl.slice() + " — без подбора по LIKE (сторож component_sprints): " + sql);
            for (String col : List.of("task_statuses", "tasks_total", "planned_start_date", "planned_end_date"))
                assertTrue(sql.contains(col), sl.slice() + " — " + col + ": " + sql);
        }
    }

    @Test
    void taskLinkCarriesValuesOfItsType() {
        Map<String, Object> row = new HashMap<>();
        row.put("task_uid", "S/T-1");
        row.put("title", "Задача");
        row.put("status_raw", "🔄 IN PROGRESS");
        row.put("executor_agent", "claude");
        row.put("effort_days", 1.5);
        row.put("work_class", "enb");
        for (LoreRecordFrom.SliceLink sl : childLinks("task")) {
            Map<String, Object> link = LoreRecordFrom.sliceLink(sl, row);
            assertEquals(Map.of("executor", "claude", "effort", 1.5, "work_class", "enb"), link.get("values"),
                sl.slice() + ": " + link);
        }
    }

    @Test
    void sprintLinkCarriesProgressAndDates() {
        Map<String, Object> row = new HashMap<>();
        row.put("sprint_id", "SPRINT_X");
        row.put("name", "Ядро");
        row.put("release_uid", "p#v1");
        row.put("status_raw", "🔄 IN PROGRESS");
        // 12 задач, у 11 есть открытая строка истории: 6 готово (разными написаниями), прочее — нет.
        row.put("task_statuses", List.of("✅ DONE", "DONE", "✅ DONE — закрыта", "✅ DONE", "✅ DONE", "✅ DONE",
            "🔄 IN PROGRESS", "⬜ TODO", "⬜ TODO — (V1 ✅ DONE)", "🚫 BLOCKED", "❌ CANCELLED"));
        row.put("tasks_total", 12);
        row.put("planned_start_date", "2026-11-01T00:00:00");
        row.put("planned_end_date", "2026-11-20");
        for (LoreRecordFrom.SliceLink sl : childLinks("sprint")) {
            @SuppressWarnings("unchecked")
            Map<String, Object> v = (Map<String, Object>) LoreRecordFrom.sliceLink(sl, row).get("values");
            assertNotNull(v, sl.slice());
            assertEquals(Map.of("done", 6, "total", 12), v.get("progress"), sl.slice());
            assertEquals("2026-11-01", v.get("planned_start"), sl.slice());
            assertEquals("2026-11-20", v.get("planned_end"), sl.slice());
        }
    }

    /** Не посчитали задачи — «не знаем», а не 0/0. */
    @Test
    void sprintProgressWithoutCountsIsNullNotZero() {
        LoreRecordFrom.SliceLink sl = childLinks("sprint").get(0);
        @SuppressWarnings("unchecked")
        Map<String, Object> v = (Map<String, Object>) LoreRecordFrom.sliceLink(sl,
            Map.of("sprint_id", "S", "name", "n")).get("values");
        assertNull(v.get("progress"));
    }

    /** Связи прочих типов (ADR, вопросы, PR) — без ключа values: контракт у них прежний. */
    @Test
    void otherLinksHaveNoValues() {
        LoreRecordFrom.SliceLink adrs = LoreRecordFrom.sliceLinkDef("task", "adrs");
        Map<String, Object> link = LoreRecordFrom.sliceLink(adrs, Map.of("adr_id", "ADR-1", "name", "n", "status", "accepted"));
        assertFalse(link.containsKey("values"), String.valueOf(link));
    }
}
