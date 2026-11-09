package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Владелица 09.11: «оценка и размер спринтов суммарно по дням и задач». Считает ТОЛЬКО
 * сервер (kit 09.11: одно число из двух мест — расхождение); одна функция кормит и
 * список (срез sprint_totals), и паспорт. Форма каждой суммы — {value, known, of}.
 */
class LoreSprintTotalsTest {

    private static Map<String, Object> t(String sid, String status, Double effort, Double actual) {
        Map<String, Object> r = new HashMap<>();
        r.put("sprint_id", sid);
        r.put("status_raw", status);
        r.put("effort_days", effort);
        r.put("actual_days", actual);
        return r;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> f(Map<String, Object> row, String key) { return (Map<String, Object>) row.get(key); }

    @Test
    void sumsWithKnownAndOfExcludingCancelled() {
        List<Map<String, Object>> rows = List.of(
            t("S1", "✅ DONE", 2.0, null),
            t("S1", "🟡 PARTIAL", 1.5, null),
            t("S1", "🚀 READY FOR DEPLOY", null, null),
            t("S1", "🚫 CANCELLED", 9.0, 9.0));
        Map<String, Object> s1 = LoreSprintTotals.aggregate(rows, List.of("S1")).get(0);
        assertEquals("S1", s1.get("sprint_id"));
        assertEquals("ok", s1.get("state"));
        assertEquals(Map.of("value", 3, "known", 3, "of", 3, "done", 1), f(s1, "tasks_total"),
            "отменённая не в «из»; done — только finished: PARTIAL и READY FOR DEPLOY — не готово");
        assertEquals(3.5, f(s1, "effort_days_total").get("value"));
        assertEquals(2, f(s1, "effort_days_total").get("known"), "оценка есть у 2 из 3");
        assertEquals(3, f(s1, "effort_days_total").get("of"));
    }

    @Test
    void nothingKnownIsNullNotZero() {
        Map<String, Object> s = LoreSprintTotals.aggregate(List.of(t("S2", "📋 PLANNED", null, null)), List.of("S2")).get(0);
        Map<String, Object> actual = f(s, "actual_days_total");
        assertNull(actual.get("value"), "факт не заполняли — null, а не «сделали за 0 дней»");
        assertEquals(0, actual.get("known"));
        assertEquals(1, actual.get("of"));
    }

    @Test
    void everyRequestedSprintGetsARowInRequestOrder() {
        List<Map<String, Object>> out = LoreSprintTotals.aggregate(List.of(t("B", "✅ DONE", 1.0, 1.0)), List.of("A", "B"));
        assertEquals(List.of("A", "B"), out.stream().map(r -> r.get("sprint_id")).toList());
        assertEquals(0, f(out.get(0), "tasks_total").get("of"), "без задач — честные нули с of=0, строка есть");
        assertEquals("ok", out.get(0).get("state"));
    }

    @Test
    void ruleIsNamedInWords() {
        assertTrue(LoreSprintTotals.RULE.contains("finished") && LoreSprintTotals.RULE.contains("withdrawn"),
            "правило подсчёта названо словами: " + LoreSprintTotals.RULE);
    }

    @Test
    void sliceIsLightAndScoped() {
        String sql = LoreSlices.compose("sprint_totals", Map.of("sprint_ids", "S1,S2")).sql();
        assertFalse(sql.contains("note_md"), "без тел задач — ради сумм тела не нужны: " + sql);
        assertTrue(sql.contains("actual_days") && sql.contains("effort_days"), sql);
        assertEquals(LoreSlices.PROJECT_SCOPED.get("tasks_of_sprints_batch"), LoreSlices.PROJECT_SCOPED.get("sprint_totals"));
    }

    /**
     * Kit 09.11: обрезка СЛАГАЕМЫХ (строк задач) должна быть видна отдельным полем, которое
     * не зависит от того, где считается свёртка: иначе сумма молча занижена и выглядит точной.
     */
    @Test
    @SuppressWarnings("unchecked")
    void inputsTruncatedSurvivesTheFold() {
        Map<String, Object> body = new HashMap<>();
        body.put("rows", List.of(t("S1", "✅ DONE", 1.0, null)));
        body.put("truncated", true);
        LoreSprintTotals.fold(body, "S1");
        assertEquals(true, body.get("inputs_truncated"), "слагаемые обрезаны — суммы неполные");
        assertEquals("S1", ((List<Map<String, Object>>) body.get("rows")).get(0).get("sprint_id"));
        assertEquals(LoreSprintTotals.RULE, body.get("rule"));

        Map<String, Object> full = new HashMap<>();
        full.put("rows", List.of(t("S1", "✅ DONE", 1.0, null)));
        LoreSprintTotals.fold(full, "S1");
        assertEquals(false, full.get("inputs_truncated"), "ключ есть всегда: false = видели все слагаемые");
    }
}
