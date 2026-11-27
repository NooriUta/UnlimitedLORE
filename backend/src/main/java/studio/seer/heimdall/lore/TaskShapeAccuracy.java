package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Точность формы задачи по факту (SPRINT_LORE_MEASURE_TRUTH/MT-TASK-SHAPE-2 п.3) —
 * ЧИСТАЯ функция над строками {@code /lore/task-shape}, без БД.
 *
 * <p><b>Зачем.</b> Критерий задачи «медиана цикла монотонна по классам S &lt; M &lt; L &lt; XL»
 * дважды (28.10 и 25.11) проверялся ручным счётом по выгрузке. Теперь вердикт
 * считается в сводке по каждому проекту и по «*», и повторная калибровка — это
 * чтение сводки, а не пересчёт.
 *
 * <p>В замер входят только закрытые строки с циклом и НЕ заведённые уже
 * сделанными ({@code created_done}) — те же правила, что у медиан сводки.
 *
 * <ul>
 *   <li>{@code verdict}: {@code monotonic} / {@code not_monotonic} /
 *       {@code insufficient}. Последний — когда сравнивать не с чем (меньше двух
 *       классов) или в каком-то классе меньше {@link #MIN_CLASS_N} задач: на
 *       горстке задач (в L/XL отдельных проектов 25.11 их было 7–33) вывод о
 *       порогах — переобучение.</li>
 *   <li>{@code violations}: соседние пары классов с достаточной выборкой, где
 *       медиана старшего не больше младшего, — «M&lt;=S».</li>
 *   <li>{@code spearman_points_cycle}: ранговая корреляция баллов с циклом —
 *       насколько баллы вообще упорядочивают задачи по длительности; null,
 *       если у одной из величин нет разброса.</li>
 * </ul>
 *
 * <p>Цикл «создана → done» меряет очередь вместе с работой (см.
 * SPRINT_LORE_MEASURE_TRUTH/MT-CAL-START), поэтому это измеритель, а не
 * автоподбор порогов: пороги здесь не меняются.
 */
final class TaskShapeAccuracy {

    private TaskShapeAccuracy() {}

    /**
     * Минимум задач в классе для вердикта. ASSUMED (26.11.2026): по срезу 25.11 в
     * классах ≥ 200 задач порядок по корпусу устойчив, а в классах из 7–33 задач
     * отдельных проектов — нет; 20 отсекает явные горстки.
     */
    static final int MIN_CLASS_N = 20;

    static final List<String> ORDER = List.of("S", "M", "L", "XL");

    static Map<String, Object> evaluate(List<Map<String, Object>> rows) {
        Map<String, List<Double>> byClass = new LinkedHashMap<>();
        for (String c : ORDER) byClass.put(c, new ArrayList<>());
        List<double[]> pairs = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            if (!(r.get("cycle_days") instanceof Number cycle)) continue;
            if (Boolean.TRUE.equals(r.get("created_done"))) continue;
            List<Double> bucket = byClass.get(String.valueOf(r.get("complexity")));
            if (bucket == null) continue;
            bucket.add(cycle.doubleValue());
            if (r.get("points") instanceof Number p) pairs.add(new double[] {p.doubleValue(), cycle.doubleValue()});
        }

        Map<String, Integer> nBy = new LinkedHashMap<>();
        Map<String, Double> med = new LinkedHashMap<>();
        List<String> small = new ArrayList<>();
        int n = 0;
        for (String c : ORDER) {
            List<Double> v = byClass.get(c);
            if (v.isEmpty()) continue;
            nBy.put(c, v.size());
            med.put(c, median(v));
            n += v.size();
            if (v.size() < MIN_CLASS_N) small.add(c);
        }

        List<String> violations = new ArrayList<>();
        String prev = null;
        for (String c : ORDER) {
            if (!med.containsKey(c) || small.contains(c)) continue;
            if (prev != null && med.get(c) <= med.get(prev)) violations.add(c + "<=" + prev);
            prev = c;
        }

        String verdict;
        if (med.size() < 2 || !small.isEmpty()) verdict = "insufficient";
        else verdict = violations.isEmpty() ? "monotonic" : "not_monotonic";

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("n", n);
        out.put("n_by_complexity", nBy);
        out.put("median_cycle_days", med);
        out.put("verdict", verdict);
        out.put("violations", violations);
        out.put("small_classes", small);
        out.put("min_class_n", MIN_CLASS_N);
        Double rho = spearman(pairs);
        out.put("spearman_points_cycle", rho == null ? null : Math.round(rho * 1000) / 1000.0);
        return out;
    }

    /** Верхняя медиана — та же, что у {@code median_cycle_days_by_complexity} сводки. */
    static double median(List<Double> v) {
        List<Double> s = new ArrayList<>(v);
        s.sort(Double::compare);
        return Math.round(s.get(s.size() / 2) * 100) / 100.0;
    }

    /** Спирмен: Пирсон по средним рангам (связки делят ранг). */
    static Double spearman(List<double[]> pairs) {
        if (pairs.size() < 2) return null;
        double[] rx = ranks(pairs, 0), ry = ranks(pairs, 1);
        double mx = mean(rx), my = mean(ry), sxy = 0, sxx = 0, syy = 0;
        for (int i = 0; i < rx.length; i++) {
            double dx = rx[i] - mx, dy = ry[i] - my;
            sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
        }
        if (sxx == 0 || syy == 0) return null;
        return sxy / Math.sqrt(sxx * syy);
    }

    private static double[] ranks(List<double[]> pairs, int k) {
        int n = pairs.size();
        Integer[] idx = new Integer[n];
        for (int i = 0; i < n; i++) idx[i] = i;
        java.util.Arrays.sort(idx, (a, b) -> Double.compare(pairs.get(a)[k], pairs.get(b)[k]));
        double[] r = new double[n];
        int i = 0;
        while (i < n) {
            int j = i;
            while (j + 1 < n && pairs.get(idx[j + 1])[k] == pairs.get(idx[i])[k]) j++;
            double avg = (i + j) / 2.0 + 1;
            for (int t = i; t <= j; t++) r[idx[t]] = avg;
            i = j + 1;
        }
        return r;
    }

    private static double mean(double[] a) {
        double s = 0;
        for (double d : a) s += d;
        return s / a.length;
    }
}
