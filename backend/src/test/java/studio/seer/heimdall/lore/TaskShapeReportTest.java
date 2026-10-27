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
}
