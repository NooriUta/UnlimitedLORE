package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * SPRINT_LORE_MODEL_AS_CONFIG/MC-02 (D-2026-LORE-MODEL-AS-CONFIG, шаг 1; ADR-LORE-048) — модель LORE
 * лежит конфигурацией, а не таблицами в Java. Канон — {@code shared/model/lore-model.json}; в образ
 * бэкенда едет его копия {@code src/main/resources/lore-model/lore-model.json} (контекст сборки —
 * только backend/), совпадение держит LoreModelFileParityTest.
 *
 * <p>Что в файле: типы паспорта (поля, разделы, части, вкладки, рёбра с концами и видом UML, пути
 * записи), граф типа (вершина, история, деловой ключ), сопоставления полей со свойствами, цвета,
 * время записи, подсказки показа, вычисляемые поля, поля-рёбра и порядок разделов паспорта.
 *
 * <p>Файл читается один раз при загрузке класса. Невалидный файл — исключение при старте, а не
 * пустая модель: сервер без модели хуже сервера, который не поднялся и сказал почему.
 */
final class LoreModelFile {

    private LoreModelFile() {}

    static final String FORMAT = "lore-model/1";
    static final String RESOURCE = "/lore-model/lore-model.json";

    /** Содержимое файла в формах, которыми пользуются реестр, типы модели и поверхность паспорта. */
    record Content(
        List<String> types,
        Map<String, LoreRecordRegistry.TypeDef> typeDefs,
        Map<String, LoreRecordRegistry.TypeDef> childOnly,
        Set<String> readOnly,
        Map<String, LoreModelTypes.Graph> graph,
        Map<String, Map<String, String>> aliases,
        Map<String, String> typeColor,
        Set<String> noTypeColor,
        Map<String, String> precision,
        Map<String, Map<String, Object>> time,
        Map<String, Object[]> displayOverrides,
        Map<String, List<Map<String, Object>>> computed,
        Map<String, String> edgeFields,
        Set<String> legacyRoleStrings,
        Map<String, List<LorePassportSurface.Slot>> passport) {}

    /**
     * Модель сервера. Ошибка чтения или проверки — ExceptionInInitializerError у первого читателя
     * (реестр паспорта грузится при старте): старт падает явно. Держатель — чтобы разбор и вывод
     * (выгрузчик, тесты) работали без файла в classpath.
     */
    static Content content() {
        return Holder.CONTENT;
    }

    private static final class Holder {
        static final Content CONTENT = load();
    }

    static Content load() {
        try (InputStream in = LoreModelFile.class.getResourceAsStream(RESOURCE)) {
            if (in == null) throw new IllegalStateException("файла модели нет в classpath: " + RESOURCE);
            return parse(new String(in.readAllBytes(), StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new IllegalStateException("файл модели не прочитан: " + e.getMessage(), e);
        }
    }

    // ── Разбор ───────────────────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    static Content parse(String json) {
        Map<String, Object> doc;
        try {
            doc = (Map<String, Object>) plain(new JsonObject(json));
        } catch (RuntimeException e) {
            throw new IllegalStateException("файл модели — не JSON: " + e.getMessage(), e);
        }
        if (!FORMAT.equals(doc.get("format")))
            throw new IllegalStateException("файл модели: format «" + doc.get("format") + "», ждали «" + FORMAT + "»");

        Map<String, LoreRecordRegistry.TypeDef> typeDefs = new LinkedHashMap<>();
        List<String> types = new ArrayList<>();
        for (Object o : list(doc, "types")) {
            LoreRecordRegistry.TypeDef d = LoreModelCodec.decode(LoreRecordRegistry.TypeDef.class, o, "types[" + types.size() + "]");
            if (typeDefs.put(d.type(), d) != null) throw new IllegalStateException("файл модели: тип «" + d.type() + "» объявлен дважды");
            types.add(d.type());
        }
        if (types.isEmpty()) throw new IllegalStateException("файл модели: типов нет");
        Map<String, LoreRecordRegistry.TypeDef> childOnly = new LinkedHashMap<>();
        int i = 0;
        for (Object o : list(doc, "child_only")) {
            LoreRecordRegistry.TypeDef d = LoreModelCodec.decode(LoreRecordRegistry.TypeDef.class, o, "child_only[" + i++ + "]");
            childOnly.put(d.type(), d);
        }
        Map<String, LoreModelTypes.Graph> graph = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : map(doc, "graph").entrySet())
            graph.put(e.getKey(), LoreModelCodec.decode(LoreModelTypes.Graph.class, e.getValue(), "graph." + e.getKey()));
        Map<String, Map<String, String>> aliases = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : map(doc, "aliases").entrySet()) aliases.put(e.getKey(), strMap(e.getValue(), "aliases." + e.getKey()));
        Map<String, Map<String, Object>> time = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : map(doc, "time").entrySet()) time.put(e.getKey(), (Map<String, Object>) e.getValue());
        Map<String, Object[]> display = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : map(doc, "display_overrides").entrySet()) {
            Map<String, Object> d = (Map<String, Object>) e.getValue();
            display.put(e.getKey(), new Object[]{d.get("priority"), d.get("width"), d.get("overflow")});
        }
        Map<String, List<Map<String, Object>>> computed = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : map(doc, "computed").entrySet())
            computed.put(e.getKey(), (List<Map<String, Object>>) e.getValue());
        Map<String, List<LorePassportSurface.Slot>> passport = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : map(doc, "passport").entrySet()) {
            List<LorePassportSurface.Slot> slots = new ArrayList<>();
            int j = 0;
            for (Object o : (List<Object>) e.getValue())
                slots.add(LoreModelCodec.decode(LorePassportSurface.Slot.class, o, "passport." + e.getKey() + "[" + j++ + "]"));
            passport.put(e.getKey(), List.copyOf(slots));
        }

        Content c = new Content(List.copyOf(types), ro(typeDefs), ro(childOnly), set(doc, "read_only"), ro(graph), ro(aliases),
            strMap(doc.get("type_color"), "type_color"), set(doc, "no_type_color"), strMap(doc.get("precision"), "precision"),
            ro(time), ro(display), ro(computed), strMap(doc.get("edge_fields"), "edge_fields"),
            set(doc, "legacy_role_strings"), ro(passport));
        check(c);
        return c;
    }

    /** Согласованность внутри файла: ссылки разделов на поля, типы без графа, порядок паспорта. */
    static void check(Content c) {
        List<String> bad = new ArrayList<>();
        for (String t : c.types()) {
            if (!c.graph().containsKey(t)) bad.add(t + ": нет graph (вершина, ключ)");
            if (!c.time().containsKey(t)) bad.add(t + ": нет time");
            LoreRecordRegistry.TypeDef d = c.typeDefs().get(t);
            Set<String> keys = new LinkedHashSet<>();
            for (LoreRecordRegistry.Field f : d.fields()) keys.add(f.key());
            for (LoreRecordRegistry.Relation r : d.relations()) keys.add(r.key());
            for (LoreRecordRegistry.PropSection s : d.props())
                for (String f : s.fields()) if (!keys.contains(f)) bad.add(t + ": раздел свойств ссылается на неизвестное поле «" + f + "»");
        }
        for (String t : c.readOnly()) if (!c.typeDefs().containsKey(t)) bad.add("read_only: неизвестный тип " + t);
        for (String t : c.passport().keySet()) if (!c.typeDefs().containsKey(t)) bad.add("passport: неизвестный тип " + t);
        for (String k : c.edgeFields().keySet()) {
            String[] p = k.split("\\.", 2);
            if (p.length != 2 || !c.typeDefs().containsKey(p[0]) || c.typeDefs().get(p[0]).field(p[1]) == null)
                bad.add("edge_fields: нет поля " + k);
        }
        if (!bad.isEmpty()) throw new IllegalStateException("файл модели несогласован: " + bad);
    }

    // ── Канонический вывод (выгрузчик и проверка совпадения) ─────────────

    static String render(Content c) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("format", FORMAT);
        d.put("about", "Модель LORE — типы паспорта, их поля, связи и поверхности (ADR-LORE-048, D-2026-LORE-MODEL-AS-CONFIG). "
            + "Канон; копия для образа бэкенда — backend/src/main/resources/lore-model/lore-model.json (LoreModelFileParityTest). "
            + "Правка меняет контракт /lore/model и /lore/record — эталон MC-01 (LoreModelGoldenTest) покажет дифф.");
        List<Object> types = new ArrayList<>();
        for (String t : c.types()) types.add(LoreModelCodec.encode(c.typeDefs().get(t)));
        d.put("types", types);
        List<Object> child = new ArrayList<>();
        for (LoreRecordRegistry.TypeDef t : c.childOnly().values()) child.add(LoreModelCodec.encode(t));
        d.put("child_only", child);
        d.put("read_only", sorted(c.readOnly()));
        Map<String, Object> graph = new TreeMap<>();
        c.graph().forEach((k, v) -> graph.put(k, LoreModelCodec.encode(v)));
        d.put("graph", graph);
        Map<String, Object> aliases = new TreeMap<>();
        c.aliases().forEach((k, v) -> aliases.put(k, new TreeMap<>(v)));
        d.put("aliases", aliases);
        d.put("type_color", new TreeMap<>(c.typeColor()));
        d.put("no_type_color", sorted(c.noTypeColor()));
        d.put("precision", new TreeMap<>(c.precision()));
        d.put("time", new TreeMap<>(c.time()));
        Map<String, Object> disp = new TreeMap<>();
        c.displayOverrides().forEach((k, v) -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("priority", v[0]);
            m.put("width", v[1]);
            m.put("overflow", v[2]);
            disp.put(k, m);
        });
        d.put("display_overrides", disp);
        d.put("computed", new TreeMap<>(c.computed()));
        d.put("edge_fields", new TreeMap<>(c.edgeFields()));
        d.put("legacy_role_strings", sorted(c.legacyRoleStrings()));
        Map<String, Object> passport = new TreeMap<>();
        c.passport().forEach((k, v) -> passport.put(k, LoreModelCodec.encode(v)));
        d.put("passport", passport);
        return new JsonObject(d).encodePrettily().replace("\r\n", "\n") + "\n";
    }

    // ── Мелочи ───────────────────────────────────────────────────────────

    /** JsonObject/JsonArray → обычные LinkedHashMap/ArrayList (потребители приводят к Map/List). */
    static Object plain(Object v) {
        if (v instanceof JsonObject o) {
            Map<String, Object> m = new LinkedHashMap<>();
            for (String k : o.fieldNames()) m.put(k, plain(o.getValue(k)));
            return m;
        }
        if (v instanceof JsonArray a) {
            List<Object> l = new ArrayList<>();
            for (Object x : a) l.add(plain(x));
            return l;
        }
        if (v instanceof Map<?, ?> m) {
            Map<String, Object> out = new LinkedHashMap<>();
            m.forEach((k, x) -> out.put(String.valueOf(k), plain(x)));
            return out;
        }
        if (v instanceof List<?> l) {
            List<Object> out = new ArrayList<>();
            for (Object x : l) out.add(plain(x));
            return out;
        }
        return v;
    }

    @SuppressWarnings("unchecked")
    private static List<Object> list(Map<String, Object> doc, String key) {
        Object v = doc.get(key);
        if (!(v instanceof List<?>)) throw new IllegalStateException("файл модели: «" + key + "» — ждали список");
        return (List<Object>) v;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Map<String, Object> doc, String key) {
        Object v = doc.get(key);
        if (!(v instanceof Map<?, ?>)) throw new IllegalStateException("файл модели: «" + key + "» — ждали объект");
        return (Map<String, Object>) v;
    }

    private static Map<String, String> strMap(Object v, String where) {
        if (!(v instanceof Map<?, ?> m)) throw new IllegalStateException("файл модели: «" + where + "» — ждали объект");
        Map<String, String> out = new LinkedHashMap<>();
        m.forEach((k, x) -> {
            if (!(x instanceof String s)) throw new IllegalStateException("файл модели: " + where + "." + k + " — ждали строку");
            out.put(String.valueOf(k), s);
        });
        return Collections.unmodifiableMap(out);
    }

    private static Set<String> set(Map<String, Object> doc, String key) {
        Set<String> out = new LinkedHashSet<>();
        for (Object o : list(doc, key)) out.add(String.valueOf(o));
        return Collections.unmodifiableSet(out);
    }

    private static List<String> sorted(Set<String> s) {
        List<String> l = new ArrayList<>(s);
        Collections.sort(l);
        return l;
    }

    private static <K, V> Map<K, V> ro(Map<K, V> m) {
        return Collections.unmodifiableMap(m);
    }
}
