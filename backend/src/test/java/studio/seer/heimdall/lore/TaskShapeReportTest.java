package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/** MT-TASK-SHAPE: строка и сводка /lore/task-shape и вердикт с формой — без базы. */
class TaskShapeReportTest {

    private static Map<String, Object> raw(String uid, String status, Double effort, String note,
                                           String since, List<String> dates) {
        Map<String, Object> r = new HashMap<>();
        r.put("task_uid", uid);
        r.put("title", "t");
        r.put("task_type", "dev");
        r.put("sprint_id", List.of("SPRINT_X"));
        // Обход через два ребра отдаёт список списков.
        r.put("projects", List.of(List.of("AIDA/demo")));
        r.put("status_raw", List.of(status));
        r.put("effort_days", effort == null ? List.of() : List.of(effort));
        r.put("note_md", note == null ? List.of() : List.of(note));
        r.put("state_since", List.of(since));
        r.put("state_dates", dates);
        return r;
    }

    @Test
    void rowCarriesShapeAndCycleButNotText() {
        var row = LoreTaskShapeResource.toRow(raw("SPRINT_X/T1", "✅ DONE", 0.5, "секретный текст заметки",
            "2026-10-03 10:00:00", List.of("2026-10-01 10:00:00", "2026-10-03 10:00:00")));
        assertEquals("AIDA/demo", row.get("project"));
        assertEquals("done", row.get("status"));
        assertEquals(2.0, row.get("cycle_days"));
        assertEquals(false, row.get("created_done"));
        assertFalse(row.toString().contains("секретный"), "текст заметки наружу не отдаётся");
    }

    /**
     * MT-TASK-SHAPE-2 п.4 (согласовано с сессией Völva 06.11): сборщик в app-db пишет строку
     * таблицей. Имена колонок — контракт: переименование молча ломает таблицу BI, поэтому
     * набор закреплён тестом. Плоская {@code recommendations_csv} (в таблицу массив не ляжет)
     * и даты ISO-8601 UTC {@code created_at} / {@code state_since} (одни «дни» не дают окна).
     */
    @Test
    void rowColumnsAreABiContract() {
        var row = LoreTaskShapeResource.toRow(raw("SPRINT_X/T1", "✅ DONE", 0.5, "x",
            "2026-10-03 10:00:00", List.of("2026-10-01 09:30:00", "2026-10-03 10:00:00")));
        assertEquals(List.of("task_uid", "sprint_id", "project", "status", "task_type", "work_class",
                "effort_days", "note_chars", "steps", "has_why", "has_verify", "has_test", "complexity",
                "points", "estimate_fits", "recommendations", "recommendations_csv", "days_in_status",
                "created_at", "state_since", "cycle_days", "created_done"),
            List.copyOf(row.keySet()), "колонки строки task-shape — контракт с таблицей Völva");
        assertEquals("2026-10-01T09:30:00Z", row.get("created_at"));
        assertEquals("2026-10-03T10:00:00Z", row.get("state_since"));
        assertEquals(String.join(",", ((List<?>) row.get("recommendations")).stream().map(String::valueOf).toList()),
            row.get("recommendations_csv"));
        var zoned = LoreTaskShapeResource.toRow(raw("SPRINT_X/T2", "📋 PLANNED", null, "1. a\n2. b",
            "2026-11-20T14:13:32.340Z", List.of("2026-11-20T14:13:32.340Z")));
        assertEquals("2026-11-20T14:13:32.340Z", zoned.get("state_since"), "миллисекунды и Z сохраняются");
        assertFalse(zoned.containsKey("cycle_days"), "у незакрытой цикла нет");
        assertTrue(zoned.containsKey("recommendations_csv"));
    }

    /** Заведена уже сделанной — помечена и не попадает в медиану цикла. */
    @Test
    void retroLoggedTasksAreExcludedFromCycleMedian() {
        var done = LoreTaskShapeResource.toRow(raw("SPRINT_X/T1", "✅ DONE", 0.5, "x",
            "2026-10-01 10:10:00", List.of("2026-10-01 10:00:00", "2026-10-01 10:10:00")));
        assertEquals(true, done.get("created_done"));
        var real = LoreTaskShapeResource.toRow(raw("SPRINT_X/T2", "✅ DONE", 0.5, "x",
            "2026-10-05 10:00:00", List.of("2026-10-01 10:00:00")));
        @SuppressWarnings("unchecked")
        var all = (Map<String, Object>) LoreTaskShapeResource.summarize(List.of(done, real)).get("*");
        assertEquals(0.5, all.get("share_created_done"));
        @SuppressWarnings("unchecked")
        var med = (Map<String, Object>) all.get("median_cycle_days_by_complexity");
        assertEquals(4.0, med.get("S"));
    }

    @Test
    void summaryCountsByProjectAndOverall() {
        var a = LoreTaskShapeResource.toRow(raw("SPRINT_X/T1", "📋 PLANNED", null, null, "2026-10-01", List.of()));
        var b = LoreTaskShapeResource.toRow(raw("SPRINT_X/T2", "🟡 PARTIAL", 1.0, "1. a\n2. b\nкак проверять: x",
            "2026-10-01", List.of()));
        var s = LoreTaskShapeResource.summarize(List.of(a, b));
        assertTrue(s.containsKey("AIDA/demo"));
        @SuppressWarnings("unchecked")
        var all = (Map<String, Object>) s.get("*");
        assertEquals(2, all.get("tasks"));
        assertEquals(1, all.get("with_effort"));
        assertEquals(0.5, all.get("share_no_steps"));
    }

    /** Форма — подсказки и блок shape; счёт обязательных не меняется. */
    @Test
    void shapeDoesNotChangeScore() {
        var shape = TaskShape.analyze("x", null, "dev", 0.5, "📋 PLANNED", 1L);
        var plain = WorkQuality.evaluateTask("📋 PLANNED", 0.5, "jtd", List.of("C"), List.of("P"), null, null);
        var shaped = WorkQuality.evaluateTask("📋 PLANNED", 0.5, "jtd", List.of("C"), List.of("P"), null, null, shape);
        assertEquals(plain.score(), shaped.score());
        assertEquals(plain.max(), shaped.max());
        var compact = WorkQuality.compact(shaped);
        assertTrue(compact.containsKey("shape"));
        assertTrue(String.valueOf(compact.get("hints")).contains("shape_steps"));
    }

    /**
     * MT-TASK-SHAPE-2, «замечено»: в {@code hints} едут только НЕпройденные
     * подсказки, а подписаны они формулировкой условия — «shape_estimate — Оценка
     * сходится с составом» при {@code estimate_fits:false} читалось как вердикт
     * «сходится». Подсказка обязана говорить, что условие не выполнено.
     */
    @Test
    void hintsReadAsUnmetConditions() {
        var shape = TaskShape.analyze("x", null, "dev", 0.5, "📋 PLANNED", 1L);
        var shaped = WorkQuality.evaluateTask("📋 PLANNED", 0.5, "jtd", List.of("C"), List.of("P"), null, null, shape);
        @SuppressWarnings("unchecked")
        var hints = (List<String>) WorkQuality.compact(shaped).get("hints");
        assertNotNull(hints, "положительный контроль: у пустой заметки подсказки есть");
        assertFalse(hints.isEmpty(), "положительный контроль: у пустой заметки подсказки есть");
        for (String h : hints)
            assertTrue(h.contains(" — не выполнено: "), "подсказка читается как вердикт, а не как пропуск: " + h);
    }
}
