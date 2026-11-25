package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * SPRINT_LORE_PRODUCT_BACKLOG/SUPERTAGS-SPIKE · Свободные поля на ребре (модель 1.18).
 *
 * <p>Решение (док report_supertags_tana_for_lore_2026_11, ред. 2.0; прототип docs/prototypes/supertags-spike.html):
 * <ul>
 *   <li>костяк полей закреплён за типом (SCD2, как сейчас);</li>
 *   <li>тег несёт свободные schemaless-поля как атрибуты ребра TAGGED_WITH — <b>без истории</b>: правка
 *       перезаписывает значение, прежнее не хранится;</li>
 *   <li>набор полей тега не объявляется: колонки среза «сущности по тегу» — объединение ключей рёбер.</li>
 * </ul>
 * Какие связи несут свободные поля, в каком свойстве и какие служебные отметки ставятся — раздел
 * {@code edge_free_fields} модели (по образцу {@code edge_history}). Кому поля положены (owners) — выводится из
 * модели: типы, у которых связь ведёт к {@code target_type} (у задачи TAGGED_WITH ведёт к компоненту — не ей).
 */
final class LoreEdgeFreeFields {

    private LoreEdgeFreeFields() {}

    /** Раздел модели для одной связи. property — свойство-словарь ребра со значениями. */
    record Spec(String targetType, String vertex, String key, String property, List<String> stamp, String why) {}

    static final Pattern KEY = Pattern.compile("[a-z][a-z0-9_]{0,39}");
    static final int MAX_FIELDS = 24;
    static final int MAX_VALUE = 500;
    static final int MAX_FACET_VALUES = 12;

    // ── Модель ────────────────────────────────────────────────────────────

    static boolean carries(String edge) {
        return edge != null && LoreModelFile.content().edgeFreeFields().containsKey(edge);
    }

    static Spec spec(String edge) {
        return LoreModelFile.content().edgeFreeFields().get(edge);
    }

    /** Типы, которым положены свободные поля связи (у связи — конец target_type), в порядке модели. */
    static List<String> owners(String edge) {
        return owners(LoreModelFile.content(), edge);
    }

    static List<String> owners(LoreModelFile.Content c, String edge) {
        Spec s = c.edgeFreeFields().get(edge);
        List<String> out = new ArrayList<>();
        if (s == null) return out;
        for (String t : c.types()) {
            LoreRecordRegistry.TypeDef d = c.typeDefs().get(t);
            if (d == null) continue;
            for (LoreRecordRegistry.Relation r : d.relations())
                if (edge.equals(r.rel()) && "out".equals(r.dir()) && s.targetType().equals(r.targetType())) { out.add(t); break; }
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    static Map<String, Spec> parse(Object raw) {
        if (raw == null) return Map.of();
        if (!(raw instanceof Map<?, ?> m)) throw new IllegalStateException("файл модели: edge_free_fields — не объект");
        Map<String, Spec> out = new LinkedHashMap<>();
        for (Map.Entry<?, ?> e : m.entrySet()) {
            if (!(e.getValue() instanceof Map<?, ?> v))
                throw new IllegalStateException("файл модели: edge_free_fields." + e.getKey() + " — не объект");
            for (Object k : v.keySet())
                if (!List.of("target_type", "vertex", "key", "property", "stamp", "why").contains(String.valueOf(k)))
                    throw new IllegalStateException("файл модели: edge_free_fields." + e.getKey() + " — неизвестный ключ «" + k + "»");
            List<String> stamp = new ArrayList<>();
            if (v.get("stamp") instanceof List<?> l) for (Object o : l) stamp.add(String.valueOf(o));
            out.put(String.valueOf(e.getKey()), new Spec(str(v.get("target_type")), str(v.get("vertex")), str(v.get("key")),
                str(v.get("property")), List.copyOf(stamp), str(v.get("why"))));
        }
        return Collections.unmodifiableMap(out);
    }

    private static String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    /** Согласованность: связь — связь модели, не историчная, есть владельцы, свойство и причина названы. */
    static List<String> problems(Map<String, Spec> specs, Map<String, LoreRecordRegistry.TypeDef> types,
                                 LoreEdgeHistory.EdgeHistory history) {
        List<String> bad = new ArrayList<>();
        for (Map.Entry<String, Spec> e : specs.entrySet()) {
            String edge = e.getKey();
            Spec s = e.getValue();
            boolean known = false, owned = false;
            for (LoreRecordRegistry.TypeDef t : types.values())
                for (LoreRecordRegistry.Relation r : t.relations())
                    if (edge.equals(r.rel())) {
                        known = true;
                        if (s.targetType() != null && s.targetType().equals(r.targetType())) owned = true;
                    }
            if (!known) bad.add("edge_free_fields: связи " + edge + " нет среди связей типов модели");
            else if (!owned) bad.add("edge_free_fields." + edge + ": ни у одного типа связь не ведёт к «" + s.targetType() + "»");
            if (history.edges().containsKey(edge))
                bad.add("edge_free_fields." + edge + ": связь историчная (edge_history), а свободные поля — без истории");
            if (blank(s.vertex()) || blank(s.key())) bad.add("edge_free_fields." + edge + ": нужны vertex и key конца");
            if (blank(s.property()) || !KEY.matcher(s.property()).matches())
                bad.add("edge_free_fields." + edge + ": property — имя свойства snake_case");
            if (blank(s.why())) bad.add("edge_free_fields." + edge + ": не сказано, зачем связи свободные поля");
            if (history.fields().stream().anyMatch(s.stamp()::contains))
                bad.add("edge_free_fields." + edge + ": отметки совпадают с полями версии ребра");
        }
        return bad;
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    /** Вывод раздела: в файле модели (withOwners = false) и в /lore/model (с owners — кому положены поля). */
    static Map<String, Object> surface(LoreModelFile.Content c, boolean withOwners) {
        Map<String, Object> d = new TreeMap<>();
        c.edgeFreeFields().forEach((edge, s) -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("target_type", s.targetType());
            m.put("vertex", s.vertex());
            m.put("key", s.key());
            m.put("property", s.property());
            m.put("stamp", s.stamp());
            m.put("why", s.why());
            if (withOwners) m.put("owners", owners(c, edge));
            d.put(edge, m);
        });
        return d;
    }

    // ── Значения ──────────────────────────────────────────────────────────

    /**
     * Входные значения полей → строки. Пустая строка и null — «снять поле» (ключ с null). Ключ — snake_case,
     * значение — скаляр не длиннее {@link #MAX_VALUE}; у schemaless-полей типов нет, всё хранится строкой.
     */
    static Map<String, String> clean(Map<String, ?> in) {
        Map<String, String> out = new LinkedHashMap<>();
        if (in == null) return out;
        if (in.size() > MAX_FIELDS) throw new IllegalArgumentException("полей тега не больше " + MAX_FIELDS + ", пришло " + in.size());
        for (Map.Entry<String, ?> e : in.entrySet()) {
            String k = e.getKey();
            if (k == null || !KEY.matcher(k).matches())
                throw new IllegalArgumentException("ключ поля «" + k + "»: латиница snake_case, с буквы, до 40 знаков");
            Object v = e.getValue();
            if (v == null) { out.put(k, null); continue; }
            if (v instanceof Map<?, ?> || v instanceof Iterable<?> || v.getClass().isArray())
                throw new IllegalArgumentException("значение поля «" + k + "» — строка или число, не список и не объект");
            String s = String.valueOf(v).strip();
            if (s.length() > MAX_VALUE) throw new IllegalArgumentException("значение поля «" + k + "» длиннее " + MAX_VALUE);
            out.put(k, s.isEmpty() ? null : s);
        }
        return out;
    }

    /** Новое значение словаря ребра: patch перезаписывает (истории нет), null снимает ключ. Ключи по алфавиту. */
    static Map<String, String> merge(Map<String, ?> current, Map<String, String> patch) {
        Map<String, String> m = new TreeMap<>();
        if (current != null) current.forEach((k, v) -> { if (v != null && !String.valueOf(v).isEmpty()) m.put(k, String.valueOf(v)); });
        patch.forEach((k, v) -> { if (v == null) m.remove(k); else m.put(k, v); });
        if (m.size() > MAX_FIELDS) throw new IllegalArgumentException("полей тега не больше " + MAX_FIELDS);
        return m;
    }

    // ── Срез «сущности по тегу с полями» ─────────────────────────────────

    /** Тип записи по классу вершины — из графа модели (только владельцы связи). */
    static Map<String, String> ownerVertices(String edge) {
        Map<String, String> out = new LinkedHashMap<>();
        for (String t : owners(edge)) {
            LoreModelTypes.Graph g = LoreModelFile.content().graph().get(t);
            if (g != null) out.put(g.vertex(), t);
        }
        return out;
    }

    /**
     * Рёбра тега с полями: начало — запись типа-владельца, конец — вершина тега.
     * Параметры — {@code :tag} (как прислали) и {@code :tag_geoid} (геоид-форма,
     * TagRename#geoid): вершины легаси ключаются свободным токеном, новые — tag:<slug>,
     * срез обязан находить обе. Ключ и название записи — по графу модели
     * (ключ у каждого типа свой).
     */
    static String entitiesSql(String edge) {
        Spec s = spec(edge);
        Map<String, String> vx = ownerVertices(edge);
        List<String> keys = new ArrayList<>(), quoted = new ArrayList<>();
        for (Map.Entry<String, String> e : vx.entrySet()) {
            keys.add("@out." + LoreModelFile.content().graph().get(e.getValue()).key());
            quoted.add("'" + e.getKey() + "'");
        }
        return "SELECT @out.@type AS vertex, coalesce(" + String.join(", ", keys) + ") AS id, " +
            "coalesce(@out.name, @out.title) AS title, " + s.property() + " AS fields, " +
            String.join(", ", s.stamp()) + " " +
            "FROM " + edge + " WHERE @in.@type = '" + s.vertex() + "' AND (@in." + s.key() + " = :tag " +
            "OR @in." + s.key() + " = :tag_geoid) " +
            "AND @out.@type IN [" + String.join(", ", quoted) + "]";
    }

    /**
     * Таблица среза: строки, колонки (объединение ключей рёбер, по заполненности, при равенстве — по алфавиту),
     * фасеты по каждой колонке (форма Facet kit: values · empty · nonempty · total; ось длиннее
     * {@link #MAX_FACET_VALUES} — truncated), счёт по типам. Пусто — state «empty», а не отсутствие ответа.
     */
    @SuppressWarnings("unchecked")
    static Map<String, Object> table(String tag, List<Map<String, Object>> rows) {
        Map<String, Integer> filled = new TreeMap<>();
        Map<String, Integer> types = new TreeMap<>();
        Map<String, Map<String, Integer>> counts = new TreeMap<>();
        for (Map<String, Object> r : rows) {
            types.merge(String.valueOf(r.get("type")), 1, Integer::sum);
            Object f = r.get("fields");
            if (!(f instanceof Map<?, ?> fm)) continue;
            for (Map.Entry<?, ?> e : fm.entrySet()) {
                if (e.getValue() == null || String.valueOf(e.getValue()).isEmpty()) continue;
                String k = String.valueOf(e.getKey());
                filled.merge(k, 1, Integer::sum);
                counts.computeIfAbsent(k, x -> new LinkedHashMap<>()).merge(String.valueOf(e.getValue()), 1, Integer::sum);
            }
        }
        List<String> order = new ArrayList<>(filled.keySet());
        order.sort(Comparator.comparing((String k) -> -filled.get(k)).thenComparing(Comparator.naturalOrder()));
        List<Map<String, Object>> columns = new ArrayList<>();
        Map<String, Object> facets = new LinkedHashMap<>();
        int total = rows.size();
        for (String k : order) {
            columns.add(Map.of("key", k, "filled", filled.get(k)));
            List<Map.Entry<String, Integer>> vs = new ArrayList<>(counts.get(k).entrySet());
            vs.sort(Comparator.comparing((Map.Entry<String, Integer> e) -> -e.getValue()).thenComparing(Map.Entry::getKey));
            List<Map<String, Object>> values = new ArrayList<>();
            for (Map.Entry<String, Integer> e : vs.subList(0, Math.min(vs.size(), MAX_FACET_VALUES)))
                values.add(Map.of("value", e.getKey(), "count", e.getValue()));
            Map<String, Object> facet = new LinkedHashMap<>();
            facet.put("values", values);
            facet.put("empty", total - filled.get(k));
            facet.put("nonempty", filled.get(k));
            facet.put("total", total);
            if (vs.size() > MAX_FACET_VALUES) facet.put("truncated", true);
            facets.put(k, facet);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("tag", tag);
        out.put("state", rows.isEmpty() ? "empty" : "ok");
        out.put("total", total);
        out.put("types", types);
        out.put("columns", columns);
        out.put("facets", facets);
        out.put("rows", rows);
        return out;
    }
}
