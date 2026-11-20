package studio.seer.heimdall.lore;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Поля метрики гейта {@code QGMetric} по спеке LORE_SCHEMA_V12_NEW_TYPES — чистая часть.
 *
 * <p>Спека задаёт threshold, unit ({@code % · s · MB/s · count}), direction ({@code gte · lte · eq}),
 * current_value (последнее измерение, NULL если нет) и status ({@code pass · fail · unknown}); код до 20.11.2026
 * писал только metric_id, name и threshold (владелица 19–20.11: «доделать функции, чтобы все поля работали»).
 *
 * <p>Откуда что:
 * <ul>
 *   <li>direction, число порога и unit — из текста порога таблицы гейта ({@code ≥ 98%}, {@code ≤ 200 ms});
 *       голое число — равенство; порог без числа — направления и числа нет, они не выдумываются;</li>
 *   <li>current_value — значение метрики из ПОСЛЕДНЕГО прогона гейта ({@code ClRoutineMetric} прогона, имя
 *       которого — {@link #routineOf}); метрика прогона сопоставляется по коду строки таблицы
 *       ({@code P-1}) или по имени, без учёта регистра; «не измерено» в прогоне — значения нет, а не ноль;</li>
 *   <li>unit — из порога, иначе из прогона;</li>
 *   <li>status — по порогу и направлению; нет измерения, числа порога или направления — {@code unknown}.</li>
 * </ul>
 */
final class QgMetricState {

    private QgMetricState() {}

    static final List<String> DIRECTIONS = List.of("gte", "lte", "eq");
    static final List<String> STATUSES = List.of("pass", "fail", "unknown");

    record Threshold(String direction, Double value, String unit) {}

    record Measured(Double value, String unit) {}

    record Fields(String direction, Double threshold, String unit, Double currentValue, String status) {}

    /** Оператор · число (запятая или точка) · единица. Пробелы между частями допустимы. */
    private static final Pattern THRESHOLD = Pattern.compile(
        "^\\s*(≥|>=|=>|>|≤|<=|=<|<|=|==)?\\s*(-?\\d+(?:[.,]\\d+)?)\\s*([%A-Za-zА-Яа-я/]+)?\\s*$");

    static Threshold parseThreshold(String raw) {
        if (raw == null || raw.isBlank()) return new Threshold(null, null, null);
        Matcher m = THRESHOLD.matcher(raw.strip());
        if (!m.matches()) return new Threshold(null, null, null);
        String op = m.group(1);
        String dir = op == null || op.startsWith("=") ? "eq"
            : op.startsWith(">") || op.startsWith("≥") ? "gte"
            : "lte";
        // «>= 80» и «> 80» — оба «не меньше»: спека знает три направления, строгость порога в ней не задана.
        if (op != null && (op.equals("=>"))) dir = "gte";
        if (op != null && (op.equals("=<"))) dir = "lte";
        Double v = Double.valueOf(m.group(2).replace(',', '.'));
        String unit = m.group(3);
        return new Threshold(dir, v, unit);
    }

    /** pass · fail · unknown по порогу и направлению. */
    static String status(String direction, Double threshold, Double current) {
        if (direction == null || threshold == null || current == null) return "unknown";
        return switch (direction) {
            case "gte" -> current >= threshold ? "pass" : "fail";
            case "lte" -> current <= threshold ? "pass" : "fail";
            case "eq" -> Math.abs(current - threshold) < 1e-9 ? "pass" : "fail";
            default -> "unknown";
        };
    }

    /** Код строки таблицы гейта из metric_id «{qg_id}:{ID}:{номер}» (QualityGateParser). */
    static String rowCode(String metricId) {
        if (metricId == null) return null;
        String[] p = metricId.split(":");
        return p.length >= 3 ? p[p.length - 2] : null;
    }

    /** Статусы прогона, означающие «измерения не было» (LoreQgRunWriter.UNMEASURED_STATUSES). */
    private static boolean unmeasured(Object status) {
        return status != null && LoreQgRunWriter.UNMEASURED_STATUSES.contains(String.valueOf(status));
    }

    /**
     * Измерение метрики в строках последнего прогона; {@code null} — метрики в прогоне нет. Значение
     * {@code null} внутри — метрика в прогоне есть, но не измерена.
     */
    static Measured measured(List<Map<String, Object>> runRows, String metricId, String name) {
        if (runRows == null) return null;
        String code = rowCode(metricId);
        for (Map<String, Object> r : runRows) {
            Object k = r.get("metric_key");
            if (k == null) continue;
            String key = String.valueOf(k).strip();
            boolean hit = (code != null && key.equalsIgnoreCase(code)) || (name != null && key.equalsIgnoreCase(name.strip()));
            if (!hit) continue;
            Double v = !unmeasured(r.get("status")) && r.get("value") instanceof Number n ? n.doubleValue() : null;
            Object u = r.get("unit");
            return new Measured(v, u == null || String.valueOf(u).isBlank() ? null : String.valueOf(u));
        }
        return null;
    }

    static Fields fields(String metricId, String name, String threshold, List<Map<String, Object>> runRows) {
        Threshold t = parseThreshold(threshold);
        Measured m = measured(runRows, metricId, name);
        Double cur = m == null ? null : m.value();
        String unit = t.unit() != null ? t.unit() : m == null ? null : m.unit();
        return new Fields(t.direction(), t.value(), unit, cur, status(t.direction(), t.value(), cur));
    }

    private static final Pattern ROUTINE = Pattern.compile("\\*\\*Routine:\\*\\*\\s*`([^`]+)`");

    /** Имя прогона гейта: «**Routine:** `…`» в тексте гейта, иначе код строчными (ADR-QG-004, как страница QG). */
    static String routineOf(String qgId, String contentMd) {
        if (contentMd != null) {
            Matcher m = ROUTINE.matcher(contentMd);
            if (m.find()) return m.group(1).strip();
        }
        return qgId == null ? null : qgId.toLowerCase(Locale.ROOT);
    }

    // ── SQL (одна правда для инжеста, регистратора прогонов и тестов) ─────────

    /** Запись метрики со всеми полями спеки. */
    static final String UPSERT_SQL =
        "UPDATE QGMetric SET metric_id=:metric_id, name=:name, threshold=:threshold, unit=:unit, "
        + "direction=:direction, current_value=:current_value, status=:status UPSERT WHERE metric_id=:metric_id";

    /**
     * Пересчёт после нового прогона: только измерение и итог, порог и имя — от инжеста. Возвращает число задетых
     * строк ({@link WriteCount}): 0 — метрику удалили между чтением и записью, вызывающий пишет промах в журнал,
     * а не считает пересчёт сделанным.
     */
    static long refresh(java.util.function.BiFunction<String, Map<String, Object>, Object> exec, String metricId, Fields f) {
        Object r = exec.apply("UPDATE QGMetric SET unit=:unit, direction=:direction, current_value=:current_value, status=:status "
            + "WHERE metric_id=:metric_id", params(metricId, null, null, f));
        return WriteCount.of(r);
    }

    /**
     * Дата последнего прогона гейта. Отдельным запросом, а не подзапросом в WHERE: в ArcadeDB
     * {@code run_date = (SELECT max(run_date) …)} сравнивает со строкой результата, а не со скаляром,
     * и не находит ничего (проба на встроенном движке 20.11.2026, EmptyTypesSchemaOnlyWriteTest).
     */
    static final String LAST_RUN_DATE_SQL =
        "SELECT max(run_date) AS d FROM ClRoutineMetric WHERE routine_name = :rn";

    /** Строки прогона гейта за дату. */
    static final String RUN_ROWS_SQL =
        "SELECT metric_key, value, unit, status, run_date FROM ClRoutineMetric WHERE routine_name = :rn AND run_date = :d";

    /** Строки последнего прогона: дата, затем строки за неё. Прогонов нет — пусто. */
    static List<Map<String, Object>> latestRun(String routine,
            java.util.function.BiFunction<String, Map<String, Object>, List<Map<String, Object>>> query) {
        List<Map<String, Object>> d = query.apply(LAST_RUN_DATE_SQL, Map.of("rn", routine));
        Object date = d.isEmpty() ? null : d.get(0).get("d");
        if (date == null) return List.of();
        return query.apply(RUN_ROWS_SQL, Map.of("rn", routine, "d", date));
    }

    /** Метрики гейта для пересчёта. */
    static final String METRICS_OF_GATE_SQL =
        "SELECT metric_id, name, threshold FROM QGMetric WHERE in('MEASURED_BY').qg_id CONTAINS :qg";

    /** Гейты-кандидаты на имя прогона: код строчными или упоминание в тексте; точная сверка — {@link #routineOf}. */
    static final String GATES_OF_ROUTINE_SQL =
        "SELECT qg_id, content_md FROM QualityGate WHERE qg_id.toLowerCase() = :rn OR content_md LIKE :pat";

    static Map<String, Object> params(String metricId, String name, String threshold, Fields f) {
        Map<String, Object> p = new java.util.HashMap<>();
        p.put("metric_id", metricId);
        p.put("name", name);
        p.put("threshold", threshold);
        p.put("unit", f.unit());
        p.put("direction", f.direction());
        p.put("current_value", f.currentValue());
        p.put("status", f.status());
        return p;
    }
}
