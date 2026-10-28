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
 *
 * <p><b>Калибровка 28.10.2026</b> (MT-TASK-SHAPE-2, {@code TaskShapeCalibrationReport}
 * по выгрузке 5310 задач, медиана цикла «создана → done» без заведённых уже
 * сделанными): v1 давала S 1,48 / M 1,41 / L 3,62 / XL 5,02 д — S и M не
 * различались, потому что факторы срабатывали на обзоре и итоге. После
 * отсечения контекстных разделов: S 1,47 / M 1,61 / L 2,88 / XL 6,83 д —
 * монотонно. Пороги баллов не трогали: монотонность дала правка ВХОДА, а
 * подгонка порогов под одну выгрузку переобучила бы классификатор.
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

    // MT-TASK-SHAPE-2: номер шага бывает жирным («**1. …**», «- **2.**»), словом
    // («Шаг 3», «Фаза 2») и заголовком («### 4. …») — в первой версии ловилась
    // только голая цифра в начале строки, и разложенные задачи числились
    // одношаговыми.
    private static final Pattern STEP = Pattern.compile(
        "(?m)^[ \\t]*(?:#{2,4}[ \\t]*)?(?:[-*+][ \\t]+)?(?:\\*\\*|__)?[ \\t]*"
        + "(?:\\d+[.)](?=[\\s*_])|(?:шаг|step|фаза|phase)[ \\t]*\\d+|\\[[ xX]\\])",
        Pattern.UNICODE_CASE | Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CHARACTER_CLASS);
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

    // MT-TASK-SHAPE-2: разделы, которые описывают мир, а не работу. Заметка со
    // срезом статистики упоминает все слои и прод — и в v1 получала XL, хотя
    // сама задача была подписью кнопки. Итог/результат дописывают ПОСЛЕ работы,
    // и без отсечения сделанные задачи «тяжелели» задним числом — калибровка
    // по циклу мерила бы отчёты, а не задачи.
    private static final Pattern HEADING = Pattern.compile(
        "^[ \\t]*(?:#{1,6}[ \\t]+(.+?)|\\*\\*([^*]{2,60}?)\\*\\*[ \\t]*:?.*)$",
        Pattern.UNICODE_CASE | Pattern.UNICODE_CHARACTER_CLASS);
    private static final Pattern CONTEXT_HEADING = ci(
        "^(контекст|повод|почему|зачем|проблем|симптом|факт|находк|статистик|срез|истори|итог|результат"
        + "|отчёт|отчет|обзор|сделано|выполнено|context|background|why|problem|result|summary|связано|см\\.)");

    /**
     * Текст, по которому ищутся факторы сложности: всё, кроме контекстных и
     * итоговых разделов. Заголовок — markdown {@code #…} или строка, начатая
     * жирной меткой ({@code **Проблема:** …}); у метки текст на той же строке
     * принадлежит её разделу. Заметка без заголовков берётся целиком.
     */
    static String workText(String note) {
        StringBuilder out = new StringBuilder();
        boolean skip = false;
        for (String line : note.split("\n", -1)) {
            Matcher h = HEADING.matcher(line);
            if (h.matches()) {
                String label = (h.group(1) != null ? h.group(1) : h.group(2)).trim();
                // «**1. Тест.**» — шаг, а не заголовок раздела.
                if (!label.matches("^\\d+[.)].*")) {
                    skip = CONTEXT_HEADING.matcher(label.replaceAll("^[^\\p{L}]+", "")).find();
                }
            }
            if (!skip) out.append(line).append('\n');
        }
        return out.toString();
    }

    /**
     * Заметки, записанные с буквальным «\n» (два символа) вместо переноса —
     * так пишут вызовы с двойным экранированием. Срез 28.10.2026: ~65 тыс.
     * таких вхождений на 5310 задач; без нормализации шаги и разделы в них не
     * видны вовсе. Меняем, только когда буквальных больше настоящих: в коде
     * внутри заметки «\n» законен.
     */
    static String normalize(String note) {
        if (note == null || note.isEmpty()) return "";
        int literal = note.split("\\\\n", -1).length - 1;
        int real = note.split("\n", -1).length - 1;
        return literal > real ? note.replace("\\n", "\n") : note;
    }

    private static Pattern ci(String re) {
        return Pattern.compile(re, Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE | Pattern.UNICODE_CHARACTER_CLASS);
    }

    /**
     * @param daysInStatus сколько дней задача в текущем статусе; null — неизвестно
     */
    static Shape analyze(String title, String noteMd, String taskType, Double effortDays,
                         String statusRaw, Long daysInStatus) {
        String note = normalize(noteMd);
        String text = (title == null ? "" : title) + "\n" + note;
        // Слои, прод и точки правки — только по разделам работы; гипотеза и
        // решение владельца — по всему тексту: они живут как раз в «Проблеме».
        String work = (title == null ? "" : title) + "\n" + workText(note);
        int len = note.length();

        int steps = count(STEP, note);
        boolean why = WHY.matcher(note).find();
        boolean verify = VERIFY.matcher(note).find();
        boolean test = TEST.matcher(text).find();
        boolean probe = PROBE.matcher(text).find();

        List<String> factors = new ArrayList<>();
        int points = 0;
        Set<String> layers = new LinkedHashSet<>();
        for (var e : LAYERS.entrySet()) if (e.getValue().matcher(work).find()) layers.add(e.getKey());
        if (layers.size() > 1) {
            points += layers.size() - 1;
            factors.add("слоёв " + layers.size() + ": " + String.join(", ", layers));
        }
        if (PROD.matcher(work).find())       { points += 2; factors.add("прод-данные / необратимое"); }
        if (HYPOTHESIS.matcher(text).find()) { points += 1; factors.add("причина — гипотеза"); }
        if (OWNER.matcher(text).find())      { points += 1; factors.add("нужно решение владельца"); }
        Set<String> files = new LinkedHashSet<>();
        Matcher fm = FILE.matcher(work);
        while (fm.find()) files.add(fm.group().toLowerCase());
        if (files.size() >= 10)     { points += 2; factors.add("точек правки " + files.size()); }
        else if (files.size() >= 5) { points += 1; factors.add("точек правки " + files.size()); }
        int workLen = work.length() - (title == null ? 0 : title.length()) - 1;
        if (workLen > EPIC_NOTE_CHARS) { points += 1; factors.add("заметка " + workLen + " симв. вне обзора"); }

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
