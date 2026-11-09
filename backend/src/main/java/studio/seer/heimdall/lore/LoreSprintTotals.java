package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Итоги спринта (владелица 09.11: «оценка и размер спринтов суммарно по дням и задач —
 * важный элемент, а его нет»). Считает ТОЛЬКО сервер: одно число из двух мест — это
 * расхождение (kit 09.11), поэтому эта функция кормит и список (срез
 * {@code sprint_totals}), и паспорт.
 *
 * <p>Форма каждой суммы — {@code {value, known, of}}: {@code of} — задачи без отменённых,
 * {@code known} — у скольких поле заполнено; при {@code known = 0} — {@code value = null},
 * а не 0 («факт не заполняли» ≠ «сделали за 0 дней»). У {@code tasks_total} ещё
 * {@code done}, и {@code known = of} — форма одна на все суммы.
 *
 * <p>Чистая функция: вход — строки задач (sprint_id, status_raw, effort_days, actual_days).
 */
final class LoreSprintTotals {

    private LoreSprintTotals() {}

    /** Правило подсчёта словами — уходит в модель (rule_text): его читают люди и kit-сессия. */
    static final String RULE = "Задачи спринта по открытой версии истории. «из» (of) — все, кроме категории "
        + "withdrawn (отменённые). «готово» (done) — только категория finished; PARTIAL и READY FOR DEPLOY "
        + "не готово. Сумма — по заполненным значениям; known — сколько заполнено; при known = 0 value = null.";

    static List<Map<String, Object>> aggregate(List<Map<String, Object>> tasks, List<String> sprintIds) {
        Map<String, Acc> by = new LinkedHashMap<>();
        for (String sid : sprintIds) by.put(sid, new Acc());
        for (Map<String, Object> t : tasks) {
            Object sid = t.get("sprint_id");
            if (sid == null) continue;
            Acc a = by.computeIfAbsent(String.valueOf(sid), k -> new Acc());
            String category = LoreStatusCategory.of("task", t.get("status_raw"));
            if ("withdrawn".equals(category)) continue;
            a.of++;
            if ("finished".equals(category)) a.done++;
            Double e = num(t.get("effort_days"));
            if (e != null) { a.effortKnown++; a.effort += e; }
            Double x = num(t.get("actual_days"));
            if (x != null) { a.actualKnown++; a.actual += x; }
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map.Entry<String, Acc> e : by.entrySet()) {
            Acc a = e.getValue();
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("sprint_id", e.getKey());
            row.put("state", "ok");
            Map<String, Object> total = new LinkedHashMap<>();
            total.put("value", a.of);
            total.put("known", a.of);
            total.put("of", a.of);
            total.put("done", a.done);
            row.put("tasks_total", total);
            row.put("effort_days_total", sum(a.effort, a.effortKnown, a.of));
            row.put("actual_days_total", sum(a.actual, a.actualKnown, a.of));
            out.add(row);
        }
        return out;
    }

    private static Map<String, Object> sum(double value, int known, int of) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("value", known == 0 ? null : value);
        m.put("known", known);
        m.put("of", of);
        return m;
    }

    private static Double num(Object v) {
        if (v instanceof Number n) return n.doubleValue();
        if (v == null) return null;
        try { return Double.parseDouble(String.valueOf(v)); } catch (NumberFormatException e) { return null; }
    }

    private static final class Acc {
        int of, done, effortKnown, actualKnown;
        double effort, actual;
    }
}
