package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-02 — генератор KnowRegistry (ADR-LORE-057, SPEC-MODEL-EXPORT-064 §5).
 *
 * <p>Чистая функция «входы → записи KnowKind»: без базы, без CDI, детерминированно (один вход — один
 * текст выдачи). Входы — канон репозитория: документ модели ({@code shared/model/lore-model.json}),
 * DDL (тип → свойство → объявленный тип ArcadeDB), реестр срезов {@link LoreSlices} и матрица записи
 * агентов {@link AgentScopeFilter#FAMILY_AGENTS}. Выдача — {@code know-registry.json} в ресурсах
 * бэкенда; ручная правка выдачи = дефект (сторож KnowRegistryGeneratorTest сверяет файл с прогоном).
 *
 * <p><b>Гейт MDL-05 (тройка).</b> Поле попадает в реестр, только если оно объявлено: в DDL
 * ({@code layer: ddl}), в модели ({@code layer: model}) или на ребре ({@code layer: edge}; связь
 * типа, {@code edge_fields} модели, TAGGED_WITH). Свойство живой схемы, которого нет ни там, ни там,
 * в реестр не попадает — уходит в {@code unclassified} (блок MDL-10 «не описано в модели»).
 *
 * <p>Виды: {@code entity:<тип>} — типы паспорта и дочерние (модель + DDL); {@code ddl:<Вершина>} —
 * вершины вне паспорта (только DDL; так в реестр входит «типы вне паспорта» словаря модели
 * lore_model_dictionary — словарь сам снят с тех же входов); {@code slice:<id>} — срезы чтения
 * (KREG-04); {@code tag:<slug>} — супертеги, импорт из графа в граф ({@link #tagKind}, KREG-03).
 */
final class KnowRegistry {

    /**
     * KREG-10: прежние имена момента создания из DDL старой схемы (ledger). В схеме 1.18 их нет — момент создания
     * лежит в created_at, и модель называет его так же; в реестр видов они не попадают даже как «DDL-поля».
     */
    static final java.util.Set<String> RENAMED_IN_MODEL_SCHEMA = java.util.Set.of("date_created", "created_date");

    private KnowRegistry() {}

    static final String FORMAT = "know-registry/1";
    static final String SOURCE_MODEL = "model+ddl";
    static final String SOURCE_DDL = "ddl";
    static final String SOURCE_SLICE = "slice-registry";
    static final String SOURCE_TAG = "graph:KnowTag";

    /**
     * Общие параметры любого среза: страница и проекция (SE-01), where — JSON-список условий над
     * строками среза (KREG-12, ADR-LORE-061 шаг 2; разбор — {@link SliceQuery#parseWhere}).
     */
    static final List<String> COMMON_SLICE_PARAMS = List.of("limit", "offset", "fields", "where");

    /**
     * Входы генератора.
     *
     * @param model       документ модели (формат lore-model/1)
     * @param ddl         тип схемы → свойство → объявленный тип ArcadeDB ("" — тип не известен)
     * @param slices      реестр срезов (id → определение)
     * @param familyRoles семейство записи → профили агентов, которым запись разрешена
     */
    record Inputs(JsonObject model, Map<String, Map<String, String>> ddl,
                  Map<String, LoreSlices.SliceDef> slices, Map<String, Set<String>> familyRoles) {}

    /** Выдача: записи KnowKind (по kind) и свойства схемы вне тройки (MDL-10). */
    record Result(List<Map<String, Object>> kinds, List<Map<String, Object>> unclassified) {
        Map<String, Object> kind(String kind) {
            for (Map<String, Object> k : kinds) if (kind.equals(k.get("kind"))) return k;
            return null;
        }
    }

    // ── Генерация ─────────────────────────────────────────────────────────

    /**
     * @param schemaDump живая схема (вершина → свойства, {@code SELECT name, properties FROM schema:types});
     *                   null — раздел unclassified не считается (нет дампа — нечего сверять)
     */
    static Result generate(Inputs in, Map<String, Set<String>> schemaDump) {
        Map<String, Map<String, Object>> out = new TreeMap<>();
        JsonObject model = in.model();
        JsonObject graph = obj(model, "graph");
        Set<String> passportVertices = new TreeSet<>();
        graph.forEach(e -> {
            JsonObject g = (JsonObject) e.getValue();
            passportVertices.add(g.getString("vertex"));
            if (g.getString("hist") != null) passportVertices.add(g.getString("hist"));
        });

        List<JsonObject> types = new ArrayList<>();
        Set<String> seen = new TreeSet<>();
        for (Object o : arr(model, "types")) { types.add((JsonObject) o); seen.add(((JsonObject) o).getString("type")); }
        for (Object o : arr(model, "child_only"))
            if (seen.add(((JsonObject) o).getString("type"))) types.add((JsonObject) o);

        for (JsonObject t : types) {
            Map<String, Object> k = entityKind(in, t);
            out.put((String) k.get("kind"), k);
        }
        for (String vertex : in.ddl().keySet()) {
            if (!isVertexName(vertex) || passportVertices.contains(vertex) || vertex.endsWith("Hist")) continue;
            Map<String, Object> k = ddlKind(vertex, in.ddl().get(vertex));
            out.put((String) k.get("kind"), k);
        }
        if (in.ddl().containsKey(SKILL_VERTEX)) {
            Map<String, Object> k = skillKind(in);
            out.put((String) k.get("kind"), k);
        }
        for (Map.Entry<String, LoreSlices.SliceDef> s : new TreeMap<>(in.slices()).entrySet()) {
            Map<String, Object> k = sliceKind(s.getKey(), s.getValue(), allProfiles(model));
            out.put((String) k.get("kind"), k);
        }
        List<Map<String, Object>> unclassified = schemaDump == null ? List.of() : unclassified(in, types, schemaDump);
        return new Result(List.copyOf(out.values()), unclassified);
    }

    /** Вид типа паспорта: поля по тройке, связи с допполями рёбер, гарды, роли записи. */
    static Map<String, Object> entityKind(Inputs in, JsonObject t) {
        JsonObject model = in.model();
        String type = t.getString("type");
        JsonObject g = obj(model, "graph").getJsonObject(type);
        String vertex = g == null ? null : g.getString("vertex");
        String hist = g == null ? null : g.getString("hist");
        Map<String, String> ddlProps = new TreeMap<>();
        if (vertex != null) ddlProps.putAll(in.ddl().getOrDefault(vertex, Map.of()));
        if (hist != null) in.ddl().getOrDefault(hist, Map.of()).forEach(ddlProps::putIfAbsent);
        JsonObject alias = obj(obj(model, "aliases"), type);
        JsonObject edgeFields = obj(model, "edge_fields");
        Set<String> relNames = new TreeSet<>();
        for (Object o : arr(t, "relations")) relNames.add(((JsonObject) o).getString("rel"));

        List<Map<String, Object>> fields = new ArrayList<>();
        Set<String> covered = new TreeSet<>();
        Set<String> names = new TreeSet<>();
        for (String part : List.of("fields", "body"))
            for (Object o : arr(t, part)) {
                JsonObject f = (JsonObject) o;
                String key = f.getString("key");
                if (!names.add(key)) continue;
                JsonObject w = f.getJsonObject("write");
                String wf = w == null ? null : w.getString("field");
                String prop = alias.getString(key) != null ? alias.getString(key) : wf != null ? wf : key;
                String layer;
                if (edgeFields.getString(type + "." + key) != null || f.getString("rel") != null
                    || (wf != null && relNames.contains(wf))) layer = "edge";
                else if (ddlProps.containsKey(prop) || ddlProps.containsKey(key)) layer = "ddl";
                else layer = "model";
                covered.add(prop);
                covered.add(key);
                if (wf != null) covered.add(wf);
                Map<String, Object> fd = new LinkedHashMap<>();
                fd.put("name", key);
                fd.put("type", fieldType(f.getString("kind")));
                fd.put("required", Boolean.TRUE.equals(f.getBoolean("required")) || Boolean.TRUE.equals(f.getBoolean("notnull")));
                fd.put("enum_ref", f.getString("dict") == null ? null : "dict:" + f.getString("dict"));
                fd.put("pattern", null);
                fd.put("desc", f.getString("definition"));
                fd.put("layer", layer);
                fd.put("property", layer.equals("edge") ? null : prop);
                if (layer.equals("edge")) {
                    String rel = edgeFields.getString(type + "." + key) != null ? edgeFields.getString(type + "." + key)
                        : f.getString("rel") != null ? f.getString("rel") : wf;
                    fd.put("rel", rel);
                }
                if (f.getString("refType") != null) fd.put("ref_kind", "entity:" + f.getString("refType"));
                if (Boolean.TRUE.equals(f.getBoolean("multi"))) fd.put("multi", true);
                if (Boolean.TRUE.equals(f.getBoolean("historic"))) fd.put("historic", true);
                fields.add(fd);
            }
        for (Object o : arr(obj(model, "computed"), type)) {
            JsonObject c = (JsonObject) o;
            String key = c.getString("key");
            if (!names.add(key)) continue;
            Map<String, Object> fd = new LinkedHashMap<>();
            fd.put("name", key);
            fd.put("type", "number".equals(c.getString("kind")) || "count".equals(c.getString("kind")) ? "number" : fieldType(c.getString("kind")));
            fd.put("required", false);
            fd.put("enum_ref", null);
            fd.put("pattern", null);
            fd.put("desc", c.getString("rule_text"));
            fd.put("layer", "computed");
            fd.put("property", null);
            fields.add(fd);
        }
        // DDL-поля, которых модель не показывает: стабильный слой, в реестре — как есть.
        JsonObject service = obj(model, "service_fields");
        for (Map.Entry<String, String> p : ddlProps.entrySet()) {
            if (covered.contains(p.getKey()) || names.contains(p.getKey())) continue;
            if (RENAMED_IN_MODEL_SCHEMA.contains(p.getKey())) continue;
            names.add(p.getKey());
            Map<String, Object> fd = new LinkedHashMap<>();
            fd.put("name", p.getKey());
            fd.put("type", ddlType(p.getValue()));
            fd.put("required", false);
            fd.put("enum_ref", null);
            fd.put("pattern", null);
            fd.put("desc", service.getString(p.getKey()));
            fd.put("layer", "ddl");
            fd.put("property", p.getKey());
            if (service.containsKey(p.getKey())) fd.put("service", true);
            fields.add(fd);
        }

        Map<String, Object> k = new LinkedHashMap<>();
        k.put("kind", "entity:" + type);
        k.put("id_field", g == null ? null : g.getString("key"));
        k.put("title", t.getString("label"));
        k.put("fields", fields);
        k.put("links", links(in, t));
        k.put("guards", entityGuards(model, t, fields));
        k.put("roles", rolesOf(in.familyRoles(), type));
        k.put("replaces", List.of());
        k.put("source", SOURCE_MODEL);
        if (vertex != null) k.put("vertex", vertex);
        if (hist != null) k.put("hist", hist);
        return withHash(k);
    }

    static List<Map<String, Object>> links(Inputs in, JsonObject t) {
        JsonObject model = in.model();
        Map<String, Map<String, Object>> out = new TreeMap<>();
        for (Object o : arr(t, "relations")) {
            JsonObject r = (JsonObject) o;
            List<String> targets = new ArrayList<>();
            if (r.getString("targetType") != null) targets.add(r.getString("targetType"));
            for (Object tt : arr(r, "targetTypes")) targets.add(String.valueOf(tt));
            for (String target : targets) addLink(in, out, r.getString("rel"), r.getString("dir"), target, r.getString("key"), List.of());
        }
        for (Object o : arr(t, "linkTabs"))
            for (Object ro : arr((JsonObject) o, "rels")) {
                JsonObject r = (JsonObject) ro;
                List<String> props = new ArrayList<>();
                for (Object p : arr(r, "edgeProps")) props.add(String.valueOf(p));
                addLink(in, out, r.getString("rel"), r.getString("dir"), null, ((JsonObject) o).getString("key"), props);
            }
        // супертеги: свободные поля на ребре TAGGED_WITH — у типов-владельцев связи
        JsonObject free = obj(model, "edge_free_fields");
        free.forEach(e -> {
            JsonObject spec = (JsonObject) e.getValue();
            boolean owner = false;
            for (Object ro : arr(t, "relations")) {
                JsonObject r = (JsonObject) ro;
                if (e.getKey().equals(r.getString("rel")) && "out".equals(r.getString("dir"))
                    && String.valueOf(spec.getString("target_type")).equals(r.getString("targetType"))) owner = true;
            }
            if (owner) {
                List<String> stamps = new ArrayList<>();
                for (Object s : arr(spec, "stamp")) stamps.add(String.valueOf(s));
                stamps.add(spec.getString("property") + "{*}");
                addLink(in, out, e.getKey(), "out", spec.getString("target_type"), "tags", stamps);
            }
        });
        return List.copyOf(out.values());
    }

    private static void addLink(Inputs in, Map<String, Map<String, Object>> out, String rel, String dir, String target,
                                String key, List<String> edgeProps) {
        if (rel == null) return;
        String base = rel + "|" + (dir == null ? "out" : dir) + "|";
        if (target == null) {
            // вкладка связей не называет цель: допполя ребра — уже известным связям того же ребра
            boolean merged = false;
            for (Map.Entry<String, Map<String, Object>> e : new ArrayList<>(out.entrySet()))
                if (e.getKey().startsWith(base) && e.getValue().get("target_kind") != null) {
                    addLink(in, out, rel, dir, String.valueOf(e.getValue().get("target_kind")).substring("entity:".length()), key, edgeProps);
                    merged = true;
                }
            if (merged) return;
        }
        String id = base + (target == null ? "*" : target);
        Map<String, Object> l = out.computeIfAbsent(id, x -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("rel", rel);
            m.put("dir", dir == null ? "out" : dir);
            m.put("target_kind", target == null ? null : "entity:" + target);
            m.put("keys", new ArrayList<String>());
            m.put("edge_fields", new ArrayList<String>());
            return m;
        });
        @SuppressWarnings("unchecked") List<String> keys = (List<String>) l.get("keys");
        if (key != null && !keys.contains(key)) { keys.add(key); keys.sort(null); }
        @SuppressWarnings("unchecked") List<String> ef = (List<String>) l.get("edge_fields");
        Set<String> all = new TreeSet<>(ef);
        all.addAll(edgeProps);
        all.addAll(in.ddl().getOrDefault(rel, Map.of()).keySet());
        ef.clear();
        ef.addAll(all);
    }

    static List<Map<String, Object>> entityGuards(JsonObject model, JsonObject t, List<Map<String, Object>> fields) {
        String type = t.getString("type");
        List<Map<String, Object>> g = new ArrayList<>();
        List<String> required = new ArrayList<>();
        for (Map<String, Object> f : fields) if (Boolean.TRUE.equals(f.get("required"))) required.add((String) f.get("name"));
        if (!required.isEmpty()) g.add(guard("required-fields", required));
        for (Map<String, Object> f : fields)
            if ("status".equals(f.get("name")) && f.get("enum_ref") != null) {
                g.add(guard("status-moves", List.of(String.valueOf(f.get("enum_ref")))));
                break;
            }
        for (Object o : arr(model, "read_only")) if (type.equals(o)) g.add(guard("read-only-surface", List.of()));
        for (Object o : arr(model, "child_only")) if (type.equals(((JsonObject) o).getString("type"))) {
            g.add(guard("child-only", List.of()));
            break;
        }
        return g;
    }

    static Map<String, Object> ddlKind(String vertex, Map<String, String> props) {
        List<Map<String, Object>> fields = new ArrayList<>();
        for (Map.Entry<String, String> p : new TreeMap<>(props).entrySet()) {
            Map<String, Object> fd = new LinkedHashMap<>();
            fd.put("name", p.getKey());
            fd.put("type", ddlType(p.getValue()));
            fd.put("required", false);
            fd.put("enum_ref", null);
            fd.put("pattern", null);
            fd.put("desc", null);
            fd.put("layer", "ddl");
            fd.put("property", p.getKey());
            fields.add(fd);
        }
        Map<String, Object> k = new LinkedHashMap<>();
        k.put("kind", "ddl:" + vertex);
        k.put("id_field", null);
        k.put("title", vertex);
        k.put("fields", fields);
        k.put("links", List.of());
        k.put("guards", List.of(guard("outside-passport", List.of())));
        k.put("roles", List.of());
        k.put("replaces", List.of());
        k.put("source", SOURCE_DDL);
        k.put("vertex", vertex);
        return withHash(k);
    }

    // ── Срезы (KREG-04) ───────────────────────────────────────────────────

    /** Вид среза: params из сигнатуры (обязательные, фильтры, SE-01), fields — колонки ответа. */
    static Map<String, Object> sliceKind(String id, LoreSlices.SliceDef d, List<String> readers) {
        List<Map<String, Object>> params = new ArrayList<>();
        Set<String> named = new LinkedHashSet<>();
        for (String r : d.required()) if (named.add(r)) params.add(param(r, true, "required"));
        for (String o : new TreeSet<>(d.optionalFilters().keySet())) if (named.add(o)) params.add(param(o, false, "filter"));
        for (String c : COMMON_SLICE_PARAMS) if (named.add(c)) params.add(param(c, false, "common"));
        List<Map<String, Object>> fields = new ArrayList<>();
        for (String col : selectColumns(d.baseSql())) {
            Map<String, Object> fd = new LinkedHashMap<>();
            fd.put("name", col);
            fd.put("type", null);
            fd.put("required", false);
            fd.put("enum_ref", null);
            fd.put("pattern", null);
            fd.put("desc", null);
            fd.put("layer", "slice");
            fd.put("property", null);
            fields.add(fd);
        }
        List<Map<String, Object>> guards = new ArrayList<>();
        if (!d.required().isEmpty()) guards.add(guard("required-params", d.required()));
        guards.add(guard("value-whitelist", List.of(LoreSlices.VALUE_RE.pattern())));
        Map<String, Object> k = new LinkedHashMap<>();
        k.put("kind", "slice:" + id);
        k.put("id_field", null);
        k.put("title", id);
        k.put("params", params);
        k.put("fields", fields);
        k.put("links", List.of());
        k.put("guards", guards);
        k.put("roles", readers);
        k.put("replaces", List.of());
        k.put("source", SOURCE_SLICE);
        return withHash(k);
    }

    private static Map<String, Object> param(String name, boolean required, String role) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("name", name);
        p.put("type", "limit".equals(name) || "offset".equals(name) ? "number" : "string");
        p.put("required", required);
        p.put("role", role);
        return p;
    }

    private static final Pattern LITERAL = Pattern.compile("'(?:[^'\\\\]|\\\\.)*'|\"(?:[^\"\\\\]|\\\\.)*\"");
    private static final Pattern ALIAS_TAIL = Pattern.compile("(?is).*\\bAS\\s+`?([A-Za-z_]\\w*)`?\\s*$");
    private static final Pattern BARE = Pattern.compile("`?([A-Za-z_]\\w*)`?");

    /**
     * Колонки ответа среза: верхний список выборки первого SELECT. Псевдоним — его имя; голое поле —
     * имя поля; {@code *} и выражения без псевдонима колонки не называют (честно: не знаем — не пишем).
     */
    static List<String> selectColumns(String sql) {
        String s = LITERAL.matcher(sql).replaceAll("''");
        Matcher sel = Pattern.compile("(?i)^\\s*SELECT\\s+(?:DISTINCT\\s+)?").matcher(s);
        if (!sel.find()) return List.of();
        int depth = 0, start = sel.end();
        int end = -1;
        for (int i = start; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '(' || c == '[' || c == '{') depth++;
            else if (c == ')' || c == ']' || c == '}') depth--;
            else if (depth == 0 && s.regionMatches(true, i, " FROM ", 0, 6)) { end = i; break; }
            else if (depth == 0 && (c == '\n' || c == '\t') && s.regionMatches(true, i + 1, "FROM ", 0, 5)) { end = i; break; }
        }
        if (end < 0) return List.of();
        List<String> items = new ArrayList<>();
        depth = 0;
        int from = start;
        for (int i = start; i < end; i++) {
            char c = s.charAt(i);
            if (c == '(' || c == '[' || c == '{') depth++;
            else if (c == ')' || c == ']' || c == '}') depth--;
            else if (c == ',' && depth == 0) { items.add(s.substring(from, i)); from = i + 1; }
        }
        items.add(s.substring(from, end));
        Set<String> out = new LinkedHashSet<>();
        for (String it : items) {
            String x = it.strip();
            Matcher a = ALIAS_TAIL.matcher(x);
            if (a.matches()) { out.add(a.group(1)); continue; }
            Matcher b = BARE.matcher(x);
            if (b.matches() && !x.startsWith("@")) out.add(b.group(1));
        }
        return List.copyOf(out);
    }

    // ── Навыки (SKILL-04 / KREG-07) ───────────────────────────────────────

    static final String SKILL_VERTEX = "KnowSkill";
    static final String SOURCE_SKILL = "ddl+skill-rules";

    /**
     * Вид {@code skill:*} — вершина KnowSkill вне паспорта модели (типа skill в модели нет), поэтому вид не
     * выводится из {@code types}, как entity:*. Поля — из DDL KnowSkill (гейт MDL-05: только объявленное);
     * обязательность, словари, связи, гарды, жизненный цикл и роли записи — из {@link SkillRules}: тех же
     * констант, что исполняют гарды записи {@code /lore/skill}, так что карточка describe и поведение не
     * расходятся. ddl:KnowSkill остаётся как был (импорт не удаляет виды, KnowKindImport.stale).
     */
    static Map<String, Object> skillKind(Inputs in) {
        Map<String, String> props = in.ddl().getOrDefault(SKILL_VERTEX, Map.of());
        Set<String> required = Set.of("skill_id", "title", "body_md");
        List<Map<String, Object>> fields = new ArrayList<>();
        for (Map.Entry<String, String> p : new TreeMap<>(props).entrySet()) {
            Map<String, Object> fd = new LinkedHashMap<>();
            fd.put("name", p.getKey());
            fd.put("type", "body_md".equals(p.getKey()) ? "md" : "status".equals(p.getKey()) || "source".equals(p.getKey())
                ? "enum" : ddlType(p.getValue()));
            fd.put("required", required.contains(p.getKey()));
            fd.put("enum_ref", "status".equals(p.getKey()) ? "dict:skill_status" : null);
            if ("source".equals(p.getKey())) fd.put("enum", SkillRules.SOURCES);
            fd.put("pattern", "skill_id".equals(p.getKey()) ? "skill:[a-z0-9][a-z0-9-]{0,62}" : null);
            fd.put("desc", null);
            fd.put("layer", "ddl");
            fd.put("property", p.getKey());
            fields.add(fd);
        }
        List<Map<String, Object>> links = new ArrayList<>();
        links.add(skillLink("BELONGS_TO_PROJECT", "entity:project", "project", 1));
        links.add(skillLink("APPLIES_TO_ROLE", "dict:agent_profile", "role", 1));
        links.add(skillLink("SKILL_EXTENDS", "skill:*", "extends", null));
        links.add(skillLink("OWNED_BY", "entity:user", "owner", null));
        List<Map<String, Object>> guards = new ArrayList<>();
        guards.add(guard("required-edges", SkillRules.REQUIRED_EDGES));
        guards.add(guard("no-extends-cycle", List.of()));
        guards.add(guard("no-dangling-unlink", SkillRules.REQUIRED_EDGES));
        guards.add(guard("status-moves", List.of("создание → draft", "draft → active", "draft → deprecated",
            "active → deprecated", "deprecated → active: owner only")));
        Map<String, Object> lifecycle = new LinkedHashMap<>();
        lifecycle.put("draft", List.of("active", "deprecated"));
        lifecycle.put("active", List.of("deprecated"));
        lifecycle.put("deprecated", List.of("active"));
        Map<String, Object> k = new LinkedHashMap<>();
        k.put("kind", SkillRules.PREFIX + "*");
        k.put("id_field", "skill_id");
        k.put("title", "Навык роли: процедура «как делать» (KnowSkill)");
        k.put("fields", fields);
        k.put("links", links);
        k.put("guards", guards);
        k.put("roles", rolesOf(in.familyRoles(), "skill"));
        k.put("replaces", List.of());
        k.put("source", SOURCE_SKILL);
        k.put("lifecycle", lifecycle);
        k.put("vertex", SKILL_VERTEX);
        return withHash(k);
    }

    private static Map<String, Object> skillLink(String rel, String target, String apiRel, Integer min) {
        Map<String, Object> l = new LinkedHashMap<>();
        l.put("rel", rel);
        l.put("dir", "out");
        l.put("target_kind", target);
        l.put("keys", List.of(apiRel));
        l.put("edge_fields", List.of("linked_at", "linked_by"));
        if (min != null) l.put("min", min);
        return l;
    }

    // ── Супертеги (KREG-03) ───────────────────────────────────────────────

    /**
     * Вид {@code tag:<slug>} из вершины KnowTag и полей на её рёбрах TAGGED_WITH (опыт чип-редактора).
     * Набор полей тега не объявляется — он собирается из рёбер (edge_free_fields модели 1.18), поэтому
     * field_schema — подсказка: тип выводится из значений (все числа — number, все да/нет — bool,
     * иначе string), обязательных полей нет. Значения не мигрируются — рёбра уже в графе.
     *
     * @param tagId      tag_id вершины (как в графе: «security-review» или «tag:security-review»)
     * @param edgeFields словари полей по рёбрам тега (null-элементы — рёбра без полей)
     */
    static Map<String, Object> tagKind(JsonObject model, String tagId, List<Map<String, Object>> edgeFields,
                                       Map<String, Set<String>> familyRoles) {
        String slug = tagId.startsWith("tag:") ? tagId.substring(4) : tagId;
        JsonObject spec = obj(obj(model, "edge_free_fields"), LoreTagResource.EDGE);
        // Счётчики применений («сколько рёбер», «заполнено у N из M») в вид НЕ входят: вид — форма тега, а не
        // статистика; иначе каждое применение меняло content_hash и давало новую SCD2-версию при старте
        // (приёмка KREG-03/KREG-09). Статистика применений — срезы tags_usage / tag_entities.
        Map<String, List<Object>> values = new TreeMap<>();
        for (Map<String, Object> m : edgeFields) {
            if (m == null) continue;
            m.forEach((key, v) -> values.computeIfAbsent(key, x -> new ArrayList<>()).add(v));
        }
        List<Map<String, Object>> fields = new ArrayList<>();
        Map<String, Object> schema = new LinkedHashMap<>();
        for (Map.Entry<String, List<Object>> e : values.entrySet()) {
            String type = inferType(e.getValue());
            Map<String, Object> fd = new LinkedHashMap<>();
            fd.put("name", e.getKey());
            fd.put("type", type);
            fd.put("required", false);
            fd.put("enum_ref", null);
            fd.put("pattern", null);
            fd.put("desc", "поле на ребре " + LoreTagResource.EDGE);
            fd.put("layer", "edge");
            fd.put("property", null);
            fd.put("rel", LoreTagResource.EDGE);
            fields.add(fd);
            schema.put(e.getKey(), Map.of("type", type));
        }
        List<String> stamps = new ArrayList<>();
        for (Object s : arr(spec, "stamp")) stamps.add(String.valueOf(s));
        List<Map<String, Object>> links = new ArrayList<>();
        Map<String, Object> l = new LinkedHashMap<>();
        l.put("rel", LoreTagResource.EDGE);
        l.put("dir", "in");
        l.put("target_kind", null);
        l.put("keys", List.of());
        List<String> ef = new ArrayList<>(stamps);
        ef.add((spec.getString("property") == null ? "fields" : spec.getString("property")) + "{*}");
        l.put("edge_fields", ef);
        links.add(l);
        List<Map<String, Object>> guards = new ArrayList<>();
        guards.add(guard("tag-token", List.of(LoreTagResource.TAG.pattern())));
        guards.add(guard("rename-guard", List.of("synonyms", "broken-link-invariant")));
        guards.add(guard("rename-identity", List.of("новое имя не занято")));
        guards.add(guard("edge-free-fields", List.of("patch: value overwrites, empty removes, no history")));
        Map<String, Object> k = new LinkedHashMap<>();
        k.put("kind", "tag:" + slug);
        k.put("id_field", spec.getString("key") == null ? "tag_id" : spec.getString("key"));
        k.put("title", slug);
        k.put("fields", fields);
        k.put("field_schema", schema);
        k.put("links", links);
        k.put("guards", guards);
        k.put("roles", rolesOf(familyRoles, "tag"));
        k.put("replaces", List.of());
        k.put("source", SOURCE_TAG);
        return withHash(k);
    }

    /**
     * Импорт справочника тегов: строки {@code {tag_id, fl:[поля ребра…]}} (как их отдаёт чтение тегов,
     * {@link #TAGS_SQL}) → виды tag:*, по kind. «x» и «tag:x» — один вид: двойник — отказ с перечнем,
     * а не тихое слияние (UNIQUE kind, SPEC-MODEL-EXPORT-064 §5).
     */
    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> tagKinds(JsonObject model, List<Map<String, Object>> rows,
                                             Map<String, Set<String>> familyRoles) {
        Map<String, Map<String, Object>> out = new TreeMap<>();
        Set<String> dup = new TreeSet<>();
        for (Map<String, Object> r : rows) {
            if (r.get("tag_id") == null) continue;
            List<Map<String, Object>> edges = new ArrayList<>();
            if (r.get("fl") instanceof List<?> l)
                for (Object o : l) edges.add(o instanceof Map<?, ?> m ? (Map<String, Object>) m
                    : o instanceof JsonObject j ? j.getMap() : null);
            // рёбра без полей проекция fields не отдаёт — их число добирается из uses
            if (r.get("uses") instanceof Number n) while (edges.size() < n.intValue()) edges.add(null);
            Map<String, Object> k = tagKind(model, String.valueOf(r.get("tag_id")), edges, familyRoles);
            if (out.put((String) k.get("kind"), k) != null) dup.add((String) k.get("kind"));
        }
        if (!dup.isEmpty()) throw new IllegalStateException("двойники видов в справочнике тегов: " + dup);
        return List.copyOf(out.values());
    }

    /** Чтение справочника тегов для импорта: тег и поля на всех его рёбрах TAGGED_WITH. */
    static final String TAGS_SQL = "SELECT tag_id, in('TAGGED_WITH').size() AS uses, inE('TAGGED_WITH').fields AS fl FROM KnowTag WHERE tag_id IS NOT NULL ORDER BY tag_id";

    /** Одна строка справочника тегов по имени (легаси-токен или геоид) — для карточки describe tag:<slug>. */
    static final String TAG_ROW_SQL = "SELECT tag_id, in('TAGGED_WITH').size() AS uses, inE('TAGGED_WITH').fields AS fl FROM KnowTag WHERE tag_id = :s OR tag_id = :g";

    static String inferType(List<Object> vs) {
        boolean num = true, bool = true;
        for (Object v : vs) {
            String s = String.valueOf(v);
            if (!(v instanceof Number) && !s.matches("-?\\d+(\\.\\d+)?")) num = false;
            if (!(v instanceof Boolean) && !s.equals("true") && !s.equals("false")) bool = false;
        }
        return vs.isEmpty() ? "string" : bool ? "bool" : num ? "number" : "string";
    }

    // ── MDL-10: свойства живой схемы вне тройки ───────────────────────────

    static List<Map<String, Object>> unclassified(Inputs in, List<JsonObject> types, Map<String, Set<String>> dump) {
        JsonObject model = in.model();
        JsonObject graph = obj(model, "graph");
        JsonObject service = obj(model, "service_fields");
        List<Map<String, Object>> out = new ArrayList<>();
        for (JsonObject t : types) {
            String type = t.getString("type");
            JsonObject g = graph.getJsonObject(type);
            if (g == null) continue;
            Set<String> declared = new TreeSet<>();
            for (String v : new String[]{g.getString("vertex"), g.getString("hist")})
                if (v != null) declared.addAll(in.ddl().getOrDefault(v, Map.of()).keySet());
            declared.add(g.getString("key"));
            declared.addAll(service.fieldNames());
            JsonObject alias = obj(obj(model, "aliases"), type);
            alias.forEach(e -> declared.add(String.valueOf(e.getValue())));
            for (String part : List.of("fields", "body"))
                for (Object o : arr(t, part)) {
                    JsonObject f = (JsonObject) o;
                    declared.add(f.getString("key"));
                    if (f.getJsonObject("write") != null && f.getJsonObject("write").getString("field") != null)
                        declared.add(f.getJsonObject("write").getString("field"));
                }
            for (Object o : arr(obj(model, "computed"), type)) declared.add(((JsonObject) o).getString("key"));
            for (String v : new String[]{g.getString("vertex"), g.getString("hist")}) {
                if (v == null) continue;
                for (String p : new TreeSet<>(dump.getOrDefault(v, Set.of()))) {
                    if (p.startsWith("@") || declared.contains(p)) continue;
                    Map<String, Object> u = new LinkedHashMap<>();
                    u.put("type", type);
                    u.put("vertex", v);
                    u.put("property", p);
                    u.put("reason", "schema-only");
                    out.add(u);
                }
            }
        }
        return out;
    }

    // ── Вывод ─────────────────────────────────────────────────────────────

    /** Документ выдачи: формат, версия модели, счётчики и записи. Без времени — детерминированно. */
    static Map<String, Object> document(JsonObject model, Result r) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("format", FORMAT);
        d.put("about", "KnowRegistry — записи KnowKind, сгенерированные из модели, DDL и реестра срезов "
            + "(SPRINT_LORE_KNOW_REGISTRY/KREG-02, ADR-LORE-057, SPEC-MODEL-EXPORT-064 §5). Не править руками: "
            + "KNOW_REGISTRY_REGEN=1 и KnowRegistryGeneratorTest перепишут файл.");
        d.put("model_version", model.getValue("model_version"));
        Map<String, Integer> counts = new TreeMap<>();
        for (Map<String, Object> k : r.kinds()) counts.merge(String.valueOf(k.get("kind")).split(":", 2)[0], 1, Integer::sum);
        d.put("counts", counts);
        d.put("kinds", r.kinds());
        return d;
    }

    static String render(Map<String, Object> doc) {
        return new JsonObject(doc).encodePrettily().replace("\r\n", "\n") + "\n";
    }

    // ── Мелочи ────────────────────────────────────────────────────────────

    static List<String> allProfiles(JsonObject model) {
        List<String> out = new ArrayList<>();
        for (Object o : arr(obj(model, "agent_profiles"), "profiles")) out.add(((JsonObject) o).getString("code"));
        return out;
    }

    /** Семейство записи вида: тип модели, кроме известных расхождений имён. */
    static final Map<String, String> FAMILY_OF = Map.of("quality_gate", "qg", "phase", "phase", "qg_metric", "qg");

    static List<String> rolesOf(Map<String, Set<String>> familyRoles, String type) {
        Set<String> r = familyRoles.get(FAMILY_OF.getOrDefault(type, type));
        return r == null ? List.of() : List.copyOf(new TreeSet<>(r));
    }

    static String fieldType(String kind) {
        if (kind == null) return "string";
        return switch (kind) {
            case "text" -> "string";
            case "kv" -> "map";
            default -> kind;
        };
    }

    static String ddlType(String t) {
        if (t == null || t.isBlank()) return "unknown";
        return switch (t.toUpperCase(Locale.ROOT)) {
            case "STRING" -> "string";
            case "DATETIME", "DATE", "DATETIME_MICROS", "DATETIME_NANOS", "DATETIME_SECOND" -> "date";
            case "BOOLEAN" -> "bool";
            case "INTEGER", "LONG", "SHORT", "BYTE", "FLOAT", "DOUBLE", "DECIMAL" -> "number";
            case "LIST", "EMBEDDEDLIST" -> "list";
            case "MAP", "EMBEDDEDMAP", "EMBEDDED" -> "map";
            case "LINK" -> "ref";
            default -> t.toLowerCase(Locale.ROOT);
        };
    }

    static boolean isVertexName(String name) {
        return name.length() > 1 && Character.isUpperCase(name.charAt(0)) && Character.isLowerCase(name.charAt(1));
    }

    static Map<String, Object> guard(String name, List<String> params) {
        Map<String, Object> g = new LinkedHashMap<>();
        g.put("name", name);
        g.put("params", List.copyOf(params));
        return g;
    }

    /** content_hash — sha256 записи без самого хэша: по нему импорт решает «писать ли версию». */
    @SuppressWarnings("unchecked")
    static Map<String, Object> withHash(Map<String, Object> k) {
        k.remove("content_hash");
        // пустые атрибуты полей и связей не пишутся (tolerant reader: нет ключа = null) — выдача вдвое короче
        for (String list : List.of("fields", "params", "links"))
            if (k.get(list) instanceof List<?> l)
                for (Object o : l) if (o instanceof Map<?, ?> m) {
                    try {
                        ((Map<String, Object>) m).values().removeIf(java.util.Objects::isNull);
                    } catch (UnsupportedOperationException ignored) {
                        // неизменяемая карта (Map.of) нулей и так не держит
                    }
                }
        k.put("content_hash", sha256(new JsonObject(k).encode()));
        return k;
    }

    static String sha256(String s) {
        try {
            return "sha256:" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    static JsonObject obj(JsonObject o, String key) {
        JsonObject v = o == null ? null : o.getJsonObject(key);
        return v == null ? new JsonObject() : v;
    }

    static JsonArray arr(JsonObject o, String key) {
        if (o == null || key == null) return new JsonArray();
        Object v = o.getValue(key);
        return v instanceof JsonArray a ? a : new JsonArray();
    }
}
