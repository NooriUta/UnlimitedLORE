package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Калибровка порогов {@link TaskShape} по истории (MT-TASK-SHAPE-2) — НЕ тест
 * в обычном прогоне: включается только переменной {@code LORE_SHAPE_DUMP},
 * указывающей на каталог с выгрузками слайсов {@code all_tasks} (tasks.json),
 * {@code task_created_dates} (created.json), {@code task_done_dates} (done.json).
 *
 * <p>Печатает по классу S/M/L/XL число сделанных задач и медиану календарного
 * цикла «создана → done». Классификатор осмыслен, только если медиана растёт
 * с классом; задачи, заведённые уже сделанными (цикл меньше часа), в медиану
 * не входят — их цикл ничего не говорит о сложности.
 */
@EnabledIfEnvironmentVariable(named = "LORE_SHAPE_DUMP", matches = ".+")
class TaskShapeCalibrationReport {

    @Test
    void report() throws Exception {
        Path dir = Path.of(System.getenv("LORE_SHAPE_DUMP"));
        JsonArray tasks = new JsonArray(Files.readString(dir.resolve("tasks.json")));
        Map<String, LocalDateTime> created = new HashMap<>();
        for (Object o : new JsonArray(Files.readString(dir.resolve("created.json")))) {
            JsonObject r = (JsonObject) o;
            LocalDateTime d = parse(r.getString("valid_from"));
            String uid = r.getString("task_uid");
            if (d != null && uid != null) created.merge(uid, d, (a, b) -> a.isBefore(b) ? a : b);
        }
        Map<String, LocalDateTime> done = new HashMap<>();
        for (Object o : new JsonArray(Files.readString(dir.resolve("done.json")))) {
            JsonObject r = (JsonObject) o;
            LocalDateTime d = parse(r.getString("valid_from"));
            if (d != null && r.getString("task_uid") != null) done.put(r.getString("task_uid"), d);
        }

        Map<String, List<Double>> cycles = new LinkedHashMap<>();
        Map<String, Integer> all = new LinkedHashMap<>();
        for (String c : List.of("S", "M", "L", "XL")) { cycles.put(c, new ArrayList<>()); all.put(c, 0); }
        int withSteps = 0, n = 0;
        for (Object o : tasks) {
            JsonObject t = (JsonObject) o;
            Object e = t.getValue("effort_days");
            TaskShape.Shape s = TaskShape.analyze(t.getString("title"), t.getString("note_md"),
                t.getString("task_type"), e instanceof Number num ? num.doubleValue() : null,
                t.getString("status_raw"), null);
            n++;
            if (s.steps() >= 2) withSteps++;
            all.merge(s.complexity(), 1, Integer::sum);
            String uid = t.getString("task_uid");
            String st = t.getString("status_raw");
            if (st == null || !st.toUpperCase().contains("DONE") || uid == null) continue;
            LocalDateTime a = created.get(uid), b = done.get(uid);
            if (a == null || b == null) continue;
            double days = ChronoUnit.MINUTES.between(a, b) / 1440.0;
            if (days >= 1.0 / 24) cycles.get(s.complexity()).add(days);
        }
        System.out.printf("CALIB tasks=%d with_steps(>=2)=%d (%.0f%%)%n", n, withSteps, 100.0 * withSteps / n);
        for (var en : cycles.entrySet()) {
            List<Double> v = en.getValue();
            Collections.sort(v);
            System.out.printf("CALIB class=%-2s all=%5d done_n=%5d median=%.2f p75=%.2f%n", en.getKey(),
                all.get(en.getKey()), v.size(), q(v, 0.5), q(v, 0.75));
        }
    }

    private static double q(List<Double> v, double p) {
        return v.isEmpty() ? Double.NaN : v.get((int) Math.floor(p * (v.size() - 1)));
    }

    private static LocalDateTime parse(String s) {
        if (s == null || s.length() < 19) return null;
        try { return LocalDateTime.parse(s.substring(0, 19).replace(' ', 'T')); }
        catch (Exception e) { return null; }
    }
}
