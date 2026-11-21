package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * SPRINT_LORE_PRODUCT_BACKLOG/DBR-07 — раздел {@code series} модели LORE: временные ряды, которые
 * модель 1.18 объявляет сама (первый — {@code AuditDbLogin}, ряд сторожа входов в ArcadeDB).
 *
 * <p>Почему в модели, а не шагом V: схема новой модели собирается из модели (MIG-01, установщик
 * переноса заводит типы по ней), а цепочка V заморожена словом владелицы 15.11.2026. Из раздела
 * строится DDL ({@link #ddl}) — тот же текст, что у установщика ({@code scripts/model-migration/series.mjs}).
 *
 * <p>Ряд ArcadeDB запечатан: тег после создания не добавить (проба 14.11, см. {@link AgentActionLog}),
 * поэтому состав тегов и полей — часть контракта, и правка его — пересоздание ряда.
 */
final class LoreModelSeries {

    private LoreModelSeries() {}

    /** Ряд: момент, теги (имя → тип) в порядке DDL, поля-значения, кто пишет. */
    record Series(String about, String timestamp, Map<String, String> tags, Map<String, String> fields, String writer) {}

    /** Типы столбцов, которые ряд ArcadeDB принимает и которые мы готовы читать. */
    static final Set<String> COLUMN_TYPES = Set.of("STRING", "INTEGER", "LONG", "DOUBLE", "BOOLEAN");

    private static final Pattern IDENT = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");

    @SuppressWarnings("unchecked")
    static Map<String, Series> parse(Object section) {
        Map<String, Series> out = new LinkedHashMap<>();
        if (section == null) return out; // модель до DBR-07 — раздела нет, LoreModelStore досеет
        if (!(section instanceof Map<?, ?> m)) throw new IllegalStateException("файл модели: «series» — ждали объект");
        List<String> bad = new ArrayList<>();
        for (Map.Entry<?, ?> e : m.entrySet()) {
            String name = String.valueOf(e.getKey());
            if (!(e.getValue() instanceof Map<?, ?> v)) throw new IllegalStateException("файл модели: series." + name + " — ждали объект");
            Map<String, Object> d = (Map<String, Object>) v;
            Series s = new Series(str(d.get("about")), str(d.get("timestamp")), cols(d.get("tags"), "series." + name + ".tags"),
                cols(d.get("fields"), "series." + name + ".fields"), str(d.get("writer")));
            bad.addAll(problems(name, s));
            out.put(name, s);
        }
        if (!bad.isEmpty()) throw new IllegalStateException("файл модели несогласован: " + bad);
        return out;
    }

    static List<String> problems(String name, Series s) {
        List<String> bad = new ArrayList<>();
        if (!IDENT.matcher(name).matches()) bad.add("series: имя ряда «" + name + "» — не идентификатор");
        if (s.timestamp() == null || !IDENT.matcher(s.timestamp()).matches()) bad.add(name + ": нет момента (timestamp)");
        if (s.tags().isEmpty()) bad.add(name + ": у ряда нет тегов");
        Map<String, String> all = new LinkedHashMap<>(s.tags());
        all.putAll(s.fields());
        for (Map.Entry<String, String> c : all.entrySet()) {
            if (!IDENT.matcher(c.getKey()).matches()) bad.add(name + ": столбец «" + c.getKey() + "» — не идентификатор");
            if (!COLUMN_TYPES.contains(c.getValue())) bad.add(name + "." + c.getKey() + ": тип «" + c.getValue() + "», бывают " + new java.util.TreeSet<>(COLUMN_TYPES));
        }
        if (s.writer() == null || s.writer().isBlank()) bad.add(name + ": не сказано, кто пишет ряд (writer)");
        return bad;
    }

    /** DDL ряда. Тот же текст строит установщик (series.mjs) — сверяют оба теста. */
    static String ddl(String name, Series s) {
        StringBuilder sb = new StringBuilder("CREATE TIMESERIES TYPE ").append(name).append(" IF NOT EXISTS TIMESTAMP ").append(s.timestamp());
        sb.append(" TAGS (").append(columns(s.tags())).append(")");
        if (!s.fields().isEmpty()) sb.append(" FIELDS (").append(columns(s.fields())).append(")");
        return sb.toString();
    }

    static Map<String, Object> render(Map<String, Series> series) {
        Map<String, Object> out = new TreeMap<>();
        series.forEach((k, s) -> {
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("about", s.about());
            d.put("timestamp", s.timestamp());
            d.put("tags", new LinkedHashMap<>(s.tags()));
            d.put("fields", new LinkedHashMap<>(s.fields()));
            d.put("writer", s.writer());
            out.put(k, d);
        });
        return out;
    }

    private static String columns(Map<String, String> cols) {
        List<String> parts = new ArrayList<>();
        cols.forEach((k, v) -> parts.add(k + " " + v));
        return String.join(", ", parts);
    }

    private static Map<String, String> cols(Object v, String where) {
        Map<String, String> out = new LinkedHashMap<>();
        if (v == null) return out;
        if (!(v instanceof Map<?, ?> m)) throw new IllegalStateException("файл модели: " + where + " — ждали объект «имя → тип»");
        m.forEach((k, x) -> out.put(String.valueOf(k), String.valueOf(x)));
        return out;
    }

    private static String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }
}
