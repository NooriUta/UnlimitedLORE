package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * MT-TASK-SHAPE-2 п.3: проверка «медиана цикла монотонна по классам» и точность
 * эвристики (ранговая связь баллов с циклом) — кодом по строкам task-shape, а не
 * ручным счётом по выгрузке. Фикстуры синтетические: цифр прода здесь нет.
 */
class TaskShapeAccuracyTest {

    private static Map<String, Object> done(String cls, int points, double cycle) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("complexity", cls);
        r.put("points", points);
        r.put("cycle_days", cycle);
        r.put("created_done", false);
        return r;
    }

    private static List<Map<String, Object>> many(String cls, int points, double cycle, int n) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (int i = 0; i < n; i++) out.add(done(cls, points, cycle + i * 0.01));
        return out;
    }

    @Test
    void monotonicWhenMediansGrowWithClass() {
        List<Map<String, Object>> rows = new ArrayList<>();
        rows.addAll(many("S", 0, 1.0, 20));
        rows.addAll(many("M", 2, 2.0, 20));
        rows.addAll(many("L", 4, 3.0, 20));
        rows.addAll(many("XL", 6, 5.0, 20));
        var c = TaskShapeAccuracy.evaluate(rows);
        assertEquals("monotonic", c.get("verdict"));
        assertEquals(List.of(), c.get("violations"));
        assertEquals(Map.of("S", 20, "M", 20, "L", 20, "XL", 20), c.get("n_by_complexity"));
        assertEquals(80, c.get("n"));
        double rho = (Double) c.get("spearman_points_cycle");
        assertTrue(rho > 0.9, "баллы и цикл растут вместе: " + rho);
    }

    /** Случай AIDA/core-services 25.11: M быстрее S — нарушение названо парой. */
    @Test
    void namesTheViolatingPair() {
        List<Map<String, Object>> rows = new ArrayList<>();
        rows.addAll(many("S", 0, 2.0, 20));
        rows.addAll(many("M", 2, 1.0, 20));
        rows.addAll(many("L", 4, 3.0, 20));
        var c = TaskShapeAccuracy.evaluate(rows);
        assertEquals("not_monotonic", c.get("verdict"));
        assertEquals(List.of("M<=S"), c.get("violations"));
    }

    /**
     * Класс с горсткой задач (в L/XL отдельных проектов 7–33) — не повод для
     * вердикта: подгонка порогов под такой класс — переобучение.
     */
    @Test
    void smallClassGivesInsufficientNotAVerdict() {
        List<Map<String, Object>> rows = new ArrayList<>();
        rows.addAll(many("S", 0, 2.0, 30));
        rows.addAll(many("M", 2, 1.0, 30));
        rows.addAll(many("XL", 6, 0.5, TaskShapeAccuracy.MIN_CLASS_N - 1));
        var c = TaskShapeAccuracy.evaluate(rows);
        assertEquals("insufficient", c.get("verdict"));
        assertEquals(List.of("XL"), c.get("small_classes"));
        // Нарушения среди классов с достаточной выборкой всё равно видны.
        assertEquals(List.of("M<=S"), c.get("violations"));
    }

    /** Заведённые уже сделанными и строки без цикла в замер не входят. */
    @Test
    void retroAndOpenRowsAreIgnored() {
        List<Map<String, Object>> rows = new ArrayList<>(many("S", 0, 1.0, 20));
        var retro = done("XL", 9, 0.01);
        retro.put("created_done", true);
        rows.add(retro);
        Map<String, Object> open = new LinkedHashMap<>();
        open.put("complexity", "L");
        open.put("points", 4);
        rows.add(open);
        var c = TaskShapeAccuracy.evaluate(rows);
        assertEquals(20, c.get("n"));
        assertEquals(Map.of("S", 20), c.get("n_by_complexity"));
        assertEquals("insufficient", c.get("verdict"), "один класс — сравнивать не с чем");
        assertNull(c.get("spearman_points_cycle"), "у всех строк одни баллы — ранговой связи нет");
    }

    @Test
    void spearmanHandlesTiesAndInverse() {
        List<Map<String, Object>> rows = List.of(
            done("S", 0, 4.0), done("S", 0, 4.0), done("M", 2, 2.0), done("L", 4, 1.0), done("XL", 6, 0.5));
        double rho = (Double) TaskShapeAccuracy.evaluate(rows).get("spearman_points_cycle");
        assertEquals(-1.0, rho, 1e-9);
    }

    /** Блок калибровки едет в сводку /lore/task-shape по каждому проекту и по «*». */
    @Test
    void summaryCarriesCalibrationBlock() {
        var a = LoreTaskShapeResource.toRow(new java.util.HashMap<>(Map.of(
            "task_uid", "SPRINT_X/T1", "title", "t", "task_type", "dev",
            "projects", List.of(List.of("AIDA/demo")), "status_raw", List.of("✅ DONE"),
            "effort_days", List.of(0.5), "note_md", List.of("x"),
            "state_since", List.of("2026-10-05 10:00:00"), "state_dates", List.of("2026-10-01 10:00:00"))));
        var s = LoreTaskShapeResource.summarize(List.of(a));
        @SuppressWarnings("unchecked")
        var all = (Map<String, Object>) s.get("*");
        @SuppressWarnings("unchecked")
        var cal = (Map<String, Object>) all.get("calibration");
        assertNotNull(cal, "сводка несёт блок calibration");
        assertEquals(1, cal.get("n"));
        assertEquals("insufficient", cal.get("verdict"));
        @SuppressWarnings("unchecked")
        var proj = (Map<String, Object>) s.get("AIDA/demo");
        assertTrue(proj.containsKey("calibration"));
    }
}
