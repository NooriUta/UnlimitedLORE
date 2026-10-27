package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Форма задачи (SPRINT_LORE_MEASURE_TRUTH/MT-TASK-SHAPE) — ЧИСТАЯ логика, без БД.
 *
 * <p><b>Зачем.</b> Срез 27.10.2026 по 5310 задачам всех проектов: у 88% заметок
 * нет списка шагов, критерий готовности — у 7%, оценка с объёмом заметки не
 * связана вовсе (корреляция −0,15), а календарный цикл задач с оценкой от часа
 * до полудня одинаков (~1,7 д). Оценку ставят числом «на глаз», задачу пишут
 * одним шагом — и объём всплывает уже в работе (DBR-17: «добавить outcome»
 * оказалось шестью тихими порчами данных).
 *
 * <p>Здесь два независимых вывода из ТЕКСТА задачи:
 * <ul>
 *   <li><b>скелет</b> — есть ли «почему», шаги, критерий готовности, тест/проба;</li>
 *   <li><b>сложность по факторам</b> — сколько слоёв, трогает ли прод, гипотеза
 *       ли причина, нужно ли решение владельца, сколько точек правки. Класс
 *       S/M/L/XL сверяется с effort_days: расхождение — подсказка, что оценка не
 *       сходится с составом.</li>
 * </ul>
 *
 * <p>Всё советующее: вердикт ничего не блокирует. Запрет поощрял бы писать
 * шаги ради шагов, а пустая форма, заполненная наугад, хуже честно пустой.
 *
 * <p>Эвристики текстовые и намеренно грубые: это измеритель «чего не видно в
 * заметке», а не суждение о задаче. Пороги — ASSUMED владельцем 27.10.2026,
 * калибруются срезом /lore/task-shape (цикл против класса).
 */
final class TaskShape {

    private TaskShape() {}

    /** Порог «эпика»: заметка длиннее при оценке не больше {@link #EPIC_MAX_EFFORT}. */
    static final int EPIC_NOTE_CHARS = 3000;
    static final double EPIC_MAX_EFFORT = 0.5;
    /** «Слить в чек-лист соседней»: оценка до часа и шагов нет. */
    static final double MERGE_MAX_EFFORT = 0.125;
    /** Застрявший partial — дольше стольких дней без смены статуса. */
    static final long STALE_PARTIAL_DAYS = 14;

    record Recommendation(String code, String message) {}

    record Shape(int length, int steps, boolean why, boolean verify, boolean test, boolean probe,
                 List<String> factors, int points, String complexity,
                 double expectedMin, double expectedMax, Boolean estimateFits,
                 List<Recommendation> recommendations) {

        /** Компактный вид для ответа записи и для BI: без самого текста. */
        Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("complexity", complexity);
            m.put("points", points);
            m.put("factors", factors);
            m.put("steps", steps);
            m.put("expected_effort", expectedMax >= 99 ? "> " + fmt(expectedMin) + " д"
                : fmt(expectedMin) + "–" + fmt(expectedMax) + " д");
            if (estimateFits != null) m.put("estimate_fits", estimateFits);
            if (!recommendations.isEmpty()) {
                List<Map<String, String>> recs = new ArrayList<>();
                for (Recommendation r : recommendations) recs.add(Map.of("code", r.code(), "message", r.message()));
                m.put("recommendations", recs);
            }
            return m;
        }
    }

    // ── распознавание скелета ────────────────────────────────────────────────

    private static final Pattern STEP = Pattern.compile(
        "(?m)^\\s*(?:\\d+[.)]|- \\[[ xX]\\]|#{2,4}\\s*(?:шаг|step)\\b)\\s*", Pattern.UNICODE_CASE | Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CHARACTER_CLASS);
    private static final Pattern WHY = ci(
        "(повод|зачем|почему|факт|контекст|проблем|симптом|корень|причин|находк|источник:)");
    private static final Pattern VERIFY = ci(
        "(как проверя|чем проверя|проверк|критери|готово,? когда|done when|acceptance|ожидаем|положительн\\w* контрол)");
    private static final Pattern TEST = ci("(тест|test|vitest|junit|playwright)");
    private static final Pattern PROBE = ci(
        "(проб[аеуы]|curl|health|на стенде|после (выкатки|деплоя|изменени|рестарта)|убедит)");

    // ── факторы сложности ────────────────────────────────────────────────────

    private static final Map<String, Pattern> LAYERS = new LinkedHashMap<>();
    static {
        LAYERS.put("backend", ci("(\\bjava\\b|бэкенд|backend|resource\\b|quarkus|слайс|slice)"));
        LAYERS.put("mcp", ci("(\\bmcp\\b|mcp-server|инструмент mcp)"));
        LAYERS.put("ui", ci("(\\bui\\b|\\.tsx|фронт|frontend|экран|панел|вкладк)"));
        LAYERS.put("schema", ci("(миграц|схем[аеуы]|schema|migration|индекс|index\\b)"));
        LAYERS.put("infra", ci("(docker|nginx|traefik|\\bci\\b|\\bcd\\b|деплой|deploy|keycloak|infisical|раннер)"));
    }
    private static final Pattern PROD = ci(
        "(\\bпрод\\w*|production|бэкфилл|backfill|\\bdelete\\b|снос|необратим|данные на)");
    private static final Pattern HYPOTHESIS = ci(
        "(гипотез|не подтвержд|не воспроизвед|непонятно|неизвестн|не установлено)");
    private static final Pattern OWNER = ci(
        "(решени\\w* владел|ждёт решения|решает владел|развилк|с\\s+«да»\\s+владел)");
    private static final Pattern FILE = ci(
        "\\b[\\w.-]+\\.(java|ts|tsx|yml|yaml|json|sql|sh|ps1|mjs|kt|dart|py)\\b");

    private static Pattern ci(String re) {
        return Pattern.compile(re, Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE | Pattern.UNICODE_CHARACTER_CLASS);
    }

    /**
     * @param daysInStatus сколько дней задача в текущем статусе; null — неизвестно
     */
    static Shape analyze(String title, String noteMd, String taskType, Double effortDays,
                         String statusRaw, Long daysInStatus) {
        String note = noteMd == null ? "" : noteMd;
        String text = (title == null ? "" : title) + "\n" + note;
        int len = note.length();

        int steps = count(STEP, note);
        boolean why = WHY.matcher(note).find();
        boolean verify = VERIFY.matcher(note).find();
        boolean test = TEST.matcher(text).find();
        boolean probe = PROBE.matcher(text).find();

        List<String> factors = new ArrayList<>();
        int points = 0;
        Set<String> layers = new LinkedHashSet<>();
        for (var e : LAYERS.entrySet()) if (e.getValue().matcher(text).find()) layers.add(e.getKey());
        if (layers.size() > 1) {
            points += layers.size() - 1;
            factors.add("слоёв " + layers.size() + ": " + String.join(", ", layers));
        }
        if (PROD.matcher(text).find())       { points += 2; factors.add("прод-данные / необратимое"); }
        if (HYPOTHESIS.matcher(text).find()) { points += 1; factors.add("причина — гипотеза"); }
        if (OWNER.matcher(text).find())      { points += 1; factors.add("нужно решение владельца"); }
        Set<String> files = new LinkedHashSet<>();
        Matcher fm = FILE.matcher(note);
        while (fm.find()) files.add(fm.group().toLowerCase());
        if (files.size() >= 10)     { points += 2; factors.add("точек правки " + files.size()); }
        else if (files.size() >= 5) { points += 1; factors.add("точек правки " + files.size()); }
        if (len > EPIC_NOTE_CHARS)  { points += 1; factors.add("заметка " + len + " симв."); }

        String cls;
        double min, max;
        if (points <= 1)      { cls = "S";  min = 0;    max = 0.5; }
        else if (points <= 3) { cls = "M";  min = 0.25; max = 1.5; }
        else if (points <= 5) { cls = "L";  min = 1;    max = 3; }
        else                  { cls = "XL"; min = 2.5;  max = 99; }

        Boolean fits = null;
        if (effortDays != null && effortDays > 0) fits = effortDays >= min && effortDays <= max;

        List<Recommendation> recs = new ArrayList<>();
        boolean small = effortDays != null && effortDays > 0;
        if (len > EPIC_NOTE_CHARS && (!small || effortDays <= EPIC_MAX_EFFORT))
            recs.add(new Recommendation("epic",
                "Заметка " + len + " симв. при оценке " + (small ? fmt(effortDays) + " д" : "без оценки")
                + " — похоже на эпик: разбейте на шаги или фазы, каждой — свой критерий готовности"));
        if (small && effortDays <= MERGE_MAX_EFFORT && steps < 2 && len < 400)
            recs.add(new Recommendation("merge",
                "Оценка до часа и шагов нет — слейте в чек-лист соседней задачи того же спринта"));
        if (statusRaw != null && statusRaw.toUpperCase().contains("PARTIAL")
                && daysInStatus != null && daysInStatus > STALE_PARTIAL_DAYS)
            recs.add(new Recommendation("stale_partial",
                "В partial " + daysInStatus + " д — выделите остаток в новую задачу, эту закройте сделанным"));
        if (steps < 2 && len <= EPIC_NOTE_CHARS)
            recs.add(new Recommendation("steps",
                "Шагов меньше двух — распишите: проба/воспроизведение → правка → проверка"));
        if (!verify)
            recs.add(new Recommendation("verify",
                "Нет критерия готовности — чем будет доказано, что сделано (наблюдаемый факт, не «код написан»)"));
        if ("dev".equals(taskType) && !test)
            recs.add(new Recommendation("test",
                "dev без теста в заметке — какой тест упадёт до правки и позеленеет после"));
        if ("ops".equals(taskType) && !probe)
            recs.add(new Recommendation("probe",
                "ops без пробы — какой запрос/лог после изменения подтвердит эффект"));
        if (Boolean.FALSE.equals(fits))
            recs.add(new Recommendation("estimate",
                "Оценка " + fmt(effortDays) + " д не сходится с составом (класс " + cls + ", ожидается "
                + (max >= 99 ? "> " + fmt(min) : fmt(min) + "–" + fmt(max)) + " д): "
                + (factors.isEmpty() ? "факторов не найдено" : String.join("; ", factors))));

        return new Shape(len, steps, why, verify, test, probe, List.copyOf(factors), points, cls,
            min, max, fits, List.copyOf(recs));
    }

    private static int count(Pattern p, String s) {
        int n = 0;
        Matcher m = p.matcher(s);
        while (m.find()) n++;
        return n;
    }

    static String fmt(double d) {
        return d == Math.rint(d) ? String.valueOf((long) d) : String.valueOf(d);
    }
}
