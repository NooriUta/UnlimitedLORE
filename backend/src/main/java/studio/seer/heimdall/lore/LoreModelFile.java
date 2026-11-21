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
        Map<String, List<LorePassportSurface.Slot>> passport,
        // MC-07: общее меню и видимость разделов по аудитории (LoreModelNav).
        List<LoreModelNav.Group> nav,
        Map<String, String> audience,
        // S4-24: паспорт создания _new — путь записи, поля формы, обязательное «одно из» (LoreModelCreate).
        Map<String, LoreModelCreate.Spec> create,
        // WK-05: переходы ядра и виды работы со стадиями и доказательством done (LoreModelWorkflow).
        LoreModelWorkflow.Workflow workflow,
        // DBR-07: временные ряды модели 1.18 (AuditDbLogin) — DDL строится из модели (LoreModelSeries).
        Map<String, LoreModelSeries.Series> series,
        // MDL-02: историчные связи — история в самом ребре, одно описание на модель (LoreEdgeHistory).
        LoreEdgeHistory.EdgeHistory edgeHistory,
        // SUPERTAGS-SPIKE: свободные поля на ребре (TAGGED_WITH → тег), без истории (LoreEdgeFreeFields).
        Map<String, LoreEdgeFreeFields.Spec> edgeFreeFields,
        // MC-09: контракт экрана-списка по типам — surfaces.list (LoreModelList).
        Map<String, LoreModelList.Spec> listSurface,
        // Служебные свойства записей (перенос 1.18, хранение справочника): имя → зачем. Видны MCP и админке, в общий
        // паспорт не идут — ни полем, ни блоком «Не описано в модели» (решение владелицы: служебные поля — без вопросов).
        Map<String, String> serviceFields,
        // OH-MCP-HOSTED-SWITCH: роли учёток MCP с порядком и главная роль harness (LoreModelAgentProfiles).
        LoreModelAgentProfiles.AgentProfiles agentProfiles,
        // Патч 1.18.1 (владелица: «версию модели после миграции начни с 1»): номер модели; 0 — в файле его нет.
        int modelVersion) {}

    /**
     * Модель сервера. Ошибка чтения или проверки — ExceptionInInitializerError у первого читателя
     * (реестр паспорта грузится при старте): старт падает явно. Держатель — чтобы разбор и вывод
     * (выгрузчик, тесты) работали без файла в classpath.
     */
    static Content content() {
        Content c = current;
        if (c != null) return c;
        synchronized (LoreModelFile.class) {
            if (current == null) current = load();
            return current;
        }
    }

    /**
     * MC-05 (SPEC-LORE-MODEL-CONFIG-STORE §3): действующая модель заменяется целиком и атомарно —
     * читатели видят либо прежнюю, либо новую, но не смесь. Проверка согласованности — ДО вызова
     * (LoreModelStore): сюда приходит только проверенное содержимое.
     */
    static void replace(Content c) {
        current = java.util.Objects.requireNonNull(c, "модель не может быть пустой");
    }

    private static volatile Content current;

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

        List<LoreModelNav.Group> nav = new ArrayList<>();
        int gi = 0;
        for (Object o : list(doc, "nav")) nav.add(LoreModelCodec.decode(LoreModelNav.Group.class, o, "nav[" + gi++ + "]"));

        Map<String, LoreModelCreate.Spec> create = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : map(doc, "create").entrySet())
            create.put(e.getKey(), LoreModelCodec.decode(LoreModelCreate.Spec.class, e.getValue(), "create." + e.getKey()));

        Content c = new Content(List.copyOf(types), ro(typeDefs), ro(childOnly), set(doc, "read_only"), ro(graph), ro(aliases),
            strMap(doc.get("type_color"), "type_color"), set(doc, "no_type_color"), strMap(doc.get("precision"), "precision"),
            ro(time), ro(display), ro(computed), strMap(doc.get("edge_fields"), "edge_fields"),
            set(doc, "legacy_role_strings"), ro(passport), List.copyOf(nav), strMap(doc.get("audience"), "audience"), ro(create),
            LoreModelWorkflow.parse(doc.get("workflow")), ro(LoreModelSeries.parse(doc.get("series"))),
            LoreEdgeHistory.parse(doc.get("edge_history")), LoreEdgeFreeFields.parse(doc.get("edge_free_fields")),
            ro(LoreModelList.parse(doc.get("surfaces"))),
            doc.get("service_fields") == null ? Map.of() : strMap(doc.get("service_fields"), "service_fields"),
            LoreModelAgentProfiles.parse(doc.get("agent_profiles")),
            doc.get("model_version") instanceof Number n ? n.intValue() : 0);
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
            // MDL-02: название обязательно; слой — из двух значений; историчному полю нужна история типа.
            boolean versions = c.time().containsKey(t) && "scd2".equals(c.time().get(t).get("history"));
            for (LoreRecordRegistry.Field f : d.fields())
                fieldTexts(bad, t + "." + f.key(), f.label(), f.labelKey(), f.layer(), f.historic(), versions);
            for (LoreRecordRegistry.Body b : d.body())
                fieldTexts(bad, t + "." + b.key(), b.label(), b.labelKey(), b.layer(), b.historic(), versions);
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
        bad.addAll(LoreModelNav.problems(c.nav(), c.audience()));
        bad.addAll(LoreModelCreate.problems(c.create(), c.typeDefs()));
        bad.addAll(LoreModelWorkflow.problems(c.workflow()));
        bad.addAll(LoreEdgeHistory.problems(c.edgeHistory(), c.typeDefs()));
        bad.addAll(LoreEdgeFreeFields.problems(c.edgeFreeFields(), c.typeDefs(), c.edgeHistory()));
        bad.addAll(LoreModelAgentProfiles.problems(c.agentProfiles()));
        bad.addAll(LoreModelList.problems(c.listSurface(), c.typeDefs(), c.passport()));
        if (!bad.isEmpty()) throw new IllegalStateException("файл модели несогласован: " + bad);
    }

    private static void fieldTexts(List<String> bad, String id, String label, String labelKey, String layer, boolean historic, boolean versions) {
        if (label == null || label.isBlank()) bad.add(id + ": у поля нет названия (label) — оно обязательно");
        // MDL-09: ключ локализации — у каждого поля, это общий ключ веба и телефона.
        if (blank(labelKey)) bad.add(id + ": у поля нет ключа локализации (labelKey)");
        if (layer != null && !LoreRecordRegistry.LAYERS.contains(layer))
            bad.add(id + ": слой «" + layer + "», бывают " + LoreRecordRegistry.LAYERS);
        if (historic && !versions) bad.add(id + ": поле помечено историчным, а у типа истории версий нет (time.history)");
    }

    /**
     * MDL-02: сколько полей (с разделами текста) и у скольких нет определения. Определение
     * рекомендуется, а не обязательно: модель принимается, счётчик виден в ответе.
     */
    static Map<String, Object> fieldTextsCount(Content c) {
        int fields = 0, noDefinition = 0, noLabelEn = 0, noDefinitionEn = 0, noLabelPl = 0;
        for (String t : c.types()) {
            LoreRecordRegistry.TypeDef d = c.typeDefs().get(t);
            for (LoreRecordRegistry.Field f : d.fields()) {
                fields++;
                if (blank(f.definition())) noDefinition++;
                if (blank(f.labelEn())) noLabelEn++;
                if (blank(f.labelPl())) noLabelPl++;
                if (blank(f.definitionEn())) noDefinitionEn++;
            }
            for (LoreRecordRegistry.Body b : d.body()) {
                fields++;
                if (blank(b.definition())) noDefinition++;
                if (blank(b.labelEn())) noLabelEn++;
                if (blank(b.labelPl())) noLabelPl++;
                if (blank(b.definitionEn())) noDefinitionEn++;
            }
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("fields", fields);
        m.put("without_definition", noDefinition);
        m.put("without_label_en", noLabelEn);
        m.put("without_label_pl", noLabelPl);
        m.put("without_definition_en", noDefinitionEn);
        return m;
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    // ── Канонический вывод (выгрузчик и проверка совпадения) ─────────────

    static String render(Content c) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("format", FORMAT);
        // Патч 1.18.1: номер модели — рядом с форматом
        if (c.modelVersion() > 0) d.put("model_version", c.modelVersion());
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
        if (!c.edgeHistory().edges().isEmpty()) d.put("edge_history", LoreEdgeHistory.surface(c));
        if (!c.edgeFreeFields().isEmpty()) d.put("edge_free_fields", LoreEdgeFreeFields.surface(c, false));
        d.put("legacy_role_strings", sorted(c.legacyRoleStrings()));
        if (!c.serviceFields().isEmpty()) d.put("service_fields", new TreeMap<>(c.serviceFields()));
        Map<String, Object> passport = new TreeMap<>();
        c.passport().forEach((k, v) -> passport.put(k, LoreModelCodec.encode(v)));
        d.put("passport", passport);
        d.put("nav", LoreModelCodec.encode(c.nav()));
        d.put("audience", new TreeMap<>(c.audience()));
        Map<String, Object> create = new TreeMap<>();
        c.create().forEach((k, v) -> create.put(k, LoreModelCodec.encode(v)));
        d.put("create", create);
        d.put("workflow", LoreModelWorkflow.render(c.workflow()));
        d.put("series", LoreModelSeries.render(c.series()));
        if (!c.agentProfiles().profiles().isEmpty() || !c.agentProfiles().harness().isEmpty())
            d.put("agent_profiles", LoreModelAgentProfiles.render(c.agentProfiles()));
        // MC-09: последним ключом — правка модели другими ветками (новые типы) не задевает этот блок.
        if (!c.listSurface().isEmpty()) d.put("surfaces", Map.of("list", LoreModelList.surface(c.listSurface())));
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
