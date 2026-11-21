package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-05 — сторож «поле либо в DDL, либо в модели».
 *
 * <p>Поле, которое читает срез или паспорт, обязано быть объявлено в схеме (DDL) или описано в модели
 * ({@code shared/model/lore-model.json}). Повод: 204 поля оказались в проде без объявления — ничто не
 * мешало читать поле, которого нет ни в схеме, ни в модели.
 *
 * <p>Что считается DDL: эталон v1 ({@code v1-schema-baseline.txt}, шаги 1..62), каждый {@code CREATE PROPERTY}
 * в коде сервера (шаги V после 62 и самозаводящиеся типы) и схема, которую собирает из модели перенос 1.18
 * ({@code scripts/model-migration/schema/*.json}, MIG-01).
 *
 * <p>Как читается срез: из SQL выбрасываются строки в кавычках, параметры, переменные {@code $x},
 * служебные {@code @rid}, псевдонимы {@code AS x}, функции и методы (имя перед скобкой), ключевые слова,
 * имена типов и рёбер — остаток и есть имена полей. Сверка — по имени поля без привязки к типу: обход
 * графа ({@code out('X').поле}) тип не называет, и честно определить его без исполнения нельзя
 * (ограничение первого шага; выдуманное имя ловится, поле «не того типа» — нет).
 *
 * <p>Паспорт: колонки частей ({@code parts[].columns/optionalColumns}) — поля типа части; здесь сверка
 * по типу точная: поле модели этого типа или свойство его вершины/версии в DDL.
 *
 * <p>Исключения — {@link #LEGACY} («срез.поле» с причиной) и {@link #COMPUTED_PART_COLUMNS} (колонки, которые
 * считает сервер); исключение среза, которое больше не нужно, тоже роняет сборку.
 */
class FieldDeclaredGuardTest {

    private static final String PLAN_BOARD = "старая доска плана: писателя в коде нет, перенос 1.18 её по умолчанию не берёт "
        + "(D-2026-MIG-PLAN-BOARD-INSTALLER-OPTION, срез отвечает 410), читает только экран плана v1";
    // MDL-08 ч.2: ссылки решения (adr/sprint/pr/release_refs) читаются по связям REFERENCES — исключения сняты.

    /** «срез.поле» → причина, по которой чтение принято без объявления (легаси до решения владелицы). */
    static final Map<String, String> LEGACY = Map.ofEntries(
        Map.entry("plan_config.w0_date", PLAN_BOARD),
        Map.entry("plan_config.weeks_total", PLAN_BOARD),
        Map.entry("plan_sections.start_week", PLAN_BOARD),
        Map.entry("plan_sections.end_week", PLAN_BOARD),
        Map.entry("plan_checkpoints.desc_md", PLAN_BOARD),
        Map.entry("plan_versions.changelog_md", PLAN_BOARD),
        Map.entry("plan_versions.version_date", PLAN_BOARD),
        // qg_metrics.threshold снято: QGMetric в 1.18 — тип «только схема» со свойством threshold (MD-02 8а, 19.11.2026)
        Map.entry("history_sprint.pr_refs", "KnowSprintHist.pr_refs — смешанные типы значений, канон не выбран (MDL-03 придержал); "
            + "в переносе 1.18 — связи с PR (MIG-01)"));

    /** Колонки частей паспорта, которые считает сервер, а не читает из базы: «тип.колонка» → кто считает. */
    static final Map<String, String> COMPUTED_PART_COLUMNS = Map.of(
        "phase.status", "LoreRecordValues.phaseItem — по статусам задач фазы (done / partial)",
        "phase.progress", "LoreRecordValues.phaseItem — «x/y» по задачам фазы",
        // метрика гейта — тип только-ребёнок (child_only), вершина QGMetric; ключи значений — LoreRecordFrom.ITEMS
        "qg_metric.code", "LoreRecordFrom.Transform.ROW_CODE — код строки таблицы гейта из QGMetric.metric_id",
        "qg_metric.title", "LoreRecordFrom.ITEMS qg_metric — подпись из QGMetric.name");

    // ── Сторожа ───────────────────────────────────────────────────────────

    @Test
    void everyFieldASliceReadsIsDeclaredOrModeled() {
        Map<String, Set<String>> bad = undeclaredBySlice();
        bad.forEach((slice, fields) -> fields.removeIf(f -> LEGACY.containsKey(slice + "." + f)));
        bad.values().removeIf(Set::isEmpty);
        assertEquals(Map.of(), bad,
            "срез читает поле, которого нет ни в DDL, ни в lore-model.json — объявите поле в схеме, опишите в модели или уберите чтение (MDL-05)");
    }

    @Test
    void everyPassportPartColumnIsDeclaredOrModeled() {
        assertEquals(List.of(), undeclaredPartColumns(),
            "часть паспорта читает колонку, которой у её типа нет ни в DDL, ни в модели (MDL-05)");
    }

    @Test
    void legacyExemptionsAreStillNeeded() {
        Set<String> used = new TreeSet<>();
        undeclaredBySlice().forEach((slice, fields) -> fields.forEach(f -> used.add(slice + "." + f)));
        Set<String> stale = new TreeSet<>(LEGACY.keySet());
        stale.removeAll(used);
        assertEquals(Set.of(), stale, "исключение больше не нужно — уберите его из LEGACY");
        LEGACY.forEach((k, v) -> assertFalse(v.isBlank(), "исключение без причины: " + k));
    }

    /** Обратная проверка: выдуманное поле в срезе сторож видит, объявленное и описанное — нет. */
    @Test
    void reverseCheckInventedFieldIsCaught() {
        Set<String> known = known();
        Set<String> read = fieldsRead("SELECT task_uid, zz_mdl05_invented AS x, out('HAS_STATE')[valid_to IS NULL].status_raw[0] AS s "
            + "FROM KnowTask WHERE title LIKE :q AND $p = 1 ORDER BY x");
        assertTrue(read.contains("zz_mdl05_invented"), read.toString());
        assertTrue(read.containsAll(Set.of("task_uid", "valid_to", "status_raw", "title")), read.toString());
        assertFalse(read.contains("x") || read.contains("s") || read.contains("q") || read.contains("KnowTask")
            || read.contains("HAS_STATE") || read.contains("out"), read.toString());
        assertFalse(known.contains("zz_mdl05_invented"));
        assertTrue(known.containsAll(Set.of("task_uid", "valid_to", "status_raw", "title")));
    }

    // ── Срезы ─────────────────────────────────────────────────────────────

    static Map<String, Set<String>> undeclaredBySlice() {
        Set<String> known = known();
        Map<String, Set<String>> out = new TreeMap<>();
        for (String id : LoreSlices.ids()) {
            LoreSlices.SliceDef d = LoreSlices.get(id);
            StringBuilder sql = new StringBuilder(d.baseSql()).append(' ').append(d.suffix() == null ? "" : d.suffix());
            d.optionalFilters().values().forEach(f -> sql.append(' ').append(f));
            Set<String> miss = new TreeSet<>(fieldsRead(sql.toString()));
            miss.removeAll(known);
            if (!miss.isEmpty()) out.put(id, miss);
        }
        return out;
    }

    private static final Pattern LITERAL = Pattern.compile("'(?:[^'\\\\]|\\\\.)*'|\"(?:[^\"\\\\]|\\\\.)*\"");
    private static final Pattern ALIAS = Pattern.compile("(?i)\\bAS\\s+`?([A-Za-z_]\\w*)`?");
    private static final Pattern SIGIL = Pattern.compile("[:$@][A-Za-z_]\\w*");
    private static final Pattern IDENT = Pattern.compile("\\b([A-Za-z_]\\w*)\\b(\\s*\\()?");

    /** Ключевые слова SQL ArcadeDB, которые выглядят как имя. */
    static final Set<String> KEYWORDS = Set.of(
        "select", "from", "where", "and", "or", "not", "in", "is", "null", "as", "order", "by", "asc", "desc",
        "limit", "skip", "group", "let", "unwind", "distinct", "case", "when", "then", "else", "end", "like", "ilike",
        "between", "contains", "containsall", "containsany", "containskey", "containsvalue", "containstext",
        "instanceof", "matches", "true", "false", "if", "exists", "timeout", "fetchplan", "nocache", "parallel",
        "having", "return", "union", "all", "any", "none", "offset", "with");

    /** Псевдонимы выборки ({@code AS x}) — имена колонок ответа среза. */
    static Set<String> aliases(String sql) {
        Set<String> out = new TreeSet<>();
        Matcher a = ALIAS.matcher(LITERAL.matcher(sql).replaceAll(" ").replace('`', ' '));
        while (a.find()) out.add(a.group(1));
        return out;
    }

    /** Имена полей из SQL: всё, что не строка, не параметр, не псевдоним, не функция, не слово SQL и не имя типа. */
    static Set<String> fieldsRead(String sql) {
        String s = LITERAL.matcher(sql).replaceAll(" ");
        s = s.replace('`', ' ');
        Set<String> aliases = new TreeSet<>();
        Matcher a = ALIAS.matcher(s);
        while (a.find()) aliases.add(a.group(1));
        s = ALIAS.matcher(s).replaceAll(" ");
        s = SIGIL.matcher(s).replaceAll(" ");
        Set<String> types = typeNames();
        Set<String> out = new TreeSet<>();
        Matcher m = IDENT.matcher(s);
        while (m.find()) {
            String w = m.group(1);
            if (m.group(2) != null) continue;                       // функция или метод
            if (KEYWORDS.contains(w.toLowerCase(java.util.Locale.ROOT))) continue;
            if (aliases.contains(w) || types.contains(w)) continue;
            out.add(w);
        }
        return out;
    }

    // ── Паспорт ───────────────────────────────────────────────────────────

    static List<String> undeclaredPartColumns() {
        JsonObject model = model();
        JsonObject graph = model.getJsonObject("graph");
        Map<String, Set<String>> ddl = ddlByType();
        List<String> out = new ArrayList<>();
        for (Object o : model.getJsonArray("types")) {
            JsonObject t = (JsonObject) o;
            JsonArray parts = t.getJsonArray("parts");
            if (parts == null) continue;
            for (Object po : parts) {
                JsonObject p = (JsonObject) po;
                String pt = p.getString("type");
                Set<String> ok = new TreeSet<>(modelFieldsOf(model, pt));
                JsonObject g = pt == null ? null : graph.getJsonObject(pt);
                if (g != null) {
                    ok.addAll(ddl.getOrDefault(g.getString("vertex"), Set.of()));
                    if (g.getString("hist") != null) ok.addAll(ddl.getOrDefault(g.getString("hist"), Set.of()));
                }
                // колонка, которую отдаёт срез части (псевдоним или поле): поля самого среза сверяет сторож срезов
                LoreSlices.SliceDef sd = p.getString("slice") == null ? null : LoreSlices.get(p.getString("slice"));
                if (sd != null) {
                    ok.addAll(aliases(sd.baseSql()));
                    ok.addAll(fieldsRead(sd.baseSql()));
                }
                for (String col : strings(p.getJsonArray("columns"), p.getJsonArray("optionalColumns")))
                    if (!ok.contains(col) && !COMPUTED_PART_COLUMNS.containsKey(pt + "." + col)) out.add(t.getString("type") + "." + p.getString("key") + " → " + pt + "." + col);
            }
        }
        return out;
    }

    /** Поля модели одного типа: ключи, их свойства-псевдонимы и поле записи. */
    static Set<String> modelFieldsOf(JsonObject model, String type) {
        Set<String> out = new TreeSet<>();
        for (Object o : model.getJsonArray("types")) {
            JsonObject t = (JsonObject) o;
            if (!t.getString("type").equals(type)) continue;
            for (String arr : List.of("fields", "body"))
                if (t.getJsonArray(arr) != null)
                    for (Object fo : t.getJsonArray(arr)) {
                        JsonObject f = (JsonObject) fo;
                        out.add(f.getString("key"));
                        JsonObject w = f.getJsonObject("write");
                        if (w != null && w.getString("field") != null) out.add(w.getString("field"));
                    }
        }
        JsonObject al = model.getJsonObject("aliases");
        if (al != null && al.getJsonObject(type) != null)
            al.getJsonObject(type).forEach(e -> out.add(String.valueOf(e.getValue())));
        JsonObject comp = model.getJsonObject("computed");
        if (comp != null && comp.getJsonArray(type) != null)
            for (Object c : comp.getJsonArray(type)) out.add(((JsonObject) c).getString("key"));
        return out;
    }

    // ── Что известно: DDL ∪ модель ────────────────────────────────────────

    private static Set<String> known;

    static synchronized Set<String> known() {
        if (known != null) return known;
        Set<String> k = new TreeSet<>();
        ddlByType().values().forEach(k::addAll);
        k.addAll(modelNames());
        return known = k;
    }

    /** Все имена полей, которые называет модель. */
    static Set<String> modelNames() {
        JsonObject model = model();
        Set<String> out = new TreeSet<>();
        for (Object o : model.getJsonArray("types")) {
            JsonObject t = (JsonObject) o;
            out.addAll(modelFieldsOf(model, t.getString("type")));
            if (t.getJsonArray("parts") != null)
                for (Object po : t.getJsonArray("parts")) {
                    JsonObject p = (JsonObject) po;
                    out.addAll(strings(p.getJsonArray("columns"), p.getJsonArray("optionalColumns")));
                }
            if (t.getJsonArray("linkTabs") != null)
                for (Object lo : t.getJsonArray("linkTabs"))
                    if (((JsonObject) lo).getJsonArray("rels") != null)
                        for (Object ro : ((JsonObject) lo).getJsonArray("rels"))
                            out.addAll(strings(((JsonObject) ro).getJsonArray("edgeProps")));
        }
        JsonObject graph = model.getJsonObject("graph");
        graph.forEach(e -> out.add(((JsonObject) e.getValue()).getString("key")));
        JsonObject series = model.getJsonObject("series");
        if (series != null)
            series.forEach(e -> {
                JsonObject s = (JsonObject) e.getValue();
                if (s.getString("timestamp") != null) out.add(s.getString("timestamp"));
                if (s.getJsonObject("tags") != null) out.addAll(s.getJsonObject("tags").fieldNames());
                if (s.getJsonObject("fields") != null) out.addAll(s.getJsonObject("fields").fieldNames());
            });
        return out;
    }

    private static Map<String, Set<String>> ddl;

    /** DDL: тип → объявленные свойства (эталон v1, CREATE PROPERTY в коде, схема переноса 1.18). */
    static synchronized Map<String, Set<String>> ddlByType() {
        if (ddl != null) return ddl;
        Map<String, Set<String>> out = new TreeMap<>();
        LoreModelGoldenTest.schemaV1().props().forEach((t, ps) -> out.computeIfAbsent(t, x -> new TreeSet<>()).addAll(ps));
        Pattern create = Pattern.compile("CREATE PROPERTY\\s+(?:`?(\\w+)`?|\"\\s*\\+\\s*\\w+\\s*\\+\\s*\")\\.`?(\\w+)`?");
        // временной ряд объявляет колонки в самом CREATE: момент, теги и поля (AgentActionLog и др.)
        Pattern series = Pattern.compile("CREATE TIMESERIES TYPE\\s+(\\w+)[^;]*?TIMESTAMP\\s+`?(\\w+)`?\\s*\"?\\s*\\+?\\s*\"?\\s*TAGS\\s*\\(([^)]*)\\)"
            + "\\s*\"?\\s*\\+?\\s*\"?\\s*FIELDS\\s*\\(([^)]*)\\)");
        Pattern column = Pattern.compile("`?(\\w+)`?\\s+[A-Z]+");
        try (Stream<Path> files = Files.walk(Path.of("src", "main", "java"))) {
            for (Path f : (Iterable<Path>) files.filter(p -> p.toString().endsWith(".java"))::iterator) {
                String src = Files.readString(f, StandardCharsets.UTF_8);
                Matcher m = create.matcher(src);
                while (m.find()) out.computeIfAbsent(m.group(1) == null ? "*" : m.group(1), x -> new TreeSet<>()).add(m.group(2));
                Matcher s = series.matcher(src);
                while (s.find()) {
                    Set<String> set = out.computeIfAbsent(s.group(1), x -> new TreeSet<>());
                    set.add(s.group(2));
                    for (String cols : List.of(s.group(3), s.group(4))) {
                        Matcher c = column.matcher(cols);
                        while (c.find()) set.add(c.group(1));
                    }
                }
            }
            try (Stream<Path> schema = Files.list(Path.of("..", "scripts", "model-migration", "schema"))) {
                for (Path f : (Iterable<Path>) schema.filter(p -> p.toString().endsWith(".json"))::iterator) {
                    JsonObject types = new JsonObject(Files.readString(f, StandardCharsets.UTF_8)).getJsonObject("types");
                    // В каталоге схем лежат не только описания типов: model-version.json (номер модели, 1.18.1)
                    // типов не несёт. Файл без "types" — не описание типов, а не «схема без полей».
                    if (types == null) continue;
                    types.forEach(e -> {
                        JsonObject fields = ((JsonObject) e.getValue()).getJsonObject("fields");
                        Set<String> set = out.computeIfAbsent(e.getKey(), x -> new TreeSet<>());
                        if (fields != null) set.addAll(fields.fieldNames());
                    });
                }
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return ddl = out;
    }

    /** Имена типов (вершины, рёбра, ряды) — в SQL стоят на месте имени, но полем не являются. */
    static Set<String> typeNames() {
        Set<String> out = new TreeSet<>(ddlByType().keySet());
        out.remove("*");
        JsonObject model = model();
        model.getJsonObject("graph").forEach(e -> {
            JsonObject g = (JsonObject) e.getValue();
            out.add(g.getString("vertex"));
            if (g.getString("hist") != null) out.add(g.getString("hist"));
        });
        if (model.getJsonObject("series") != null) out.addAll(model.getJsonObject("series").fieldNames());
        return out;
    }

    private static JsonObject modelJson;

    static synchronized JsonObject model() {
        if (modelJson != null) return modelJson;
        try {
            return modelJson = new JsonObject(Files.readString(Path.of("..", "shared", "model", "lore-model.json"), StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static List<String> strings(JsonArray... arrays) {
        List<String> out = new ArrayList<>();
        for (JsonArray a : arrays) if (a != null) for (Object o : a) out.add(String.valueOf(o));
        return out;
    }
}
