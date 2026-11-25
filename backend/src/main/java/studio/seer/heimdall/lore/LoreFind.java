package studio.seer.heimdall.lore;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;

/**
 * SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-05 (SPEC-LORE-GRAPH-SEARCH §6) — {@code find}: структурный запрос
 * «тип + поля + связь» для {@code POST /lore/find} и MCP {@code find}.
 *
 * <p><b>Как исполняется.</b> Связи ({@code links_to}, {@code not_linked}) и {@code id_in} компилируются в
 * SQL ArcadeDB по описанию типа ({@link #TYPES}); значения — ТОЛЬКО связанными параметрами, имена рёбер —
 * после проверки формы ({@code [A-Z][A-Z_]*}), имена полей — из кода, не из запроса. Условия {@code where}
 * вычисляются над спроецированной строкой в Java: категория статуса ({@code status_category}) — серверная
 * функция ({@link LoreStatusCategory}), в SQL её нет, и одна семантика на все поля проще, чем две.
 * Поле текущей версии SCD2 — COALESCE открытой и последней известной версии, как у срезов.
 *
 * <p><b>Честность ответа.</b> {@code meta.complete/truncated/capped_at/total}, {@code hidden_by_scope} — сколько
 * подошедших строк скрыто проектным скоупом, {@code empty_reason} у пустого ответа: {@code hidden_by_scope}
 * (найдено, но вне скоупа) или {@code no_match}. Скоуп fail-closed, как у графа: пустое множество — 403
 * SCOPE_EMPTY; проект в {@code links_to} вне скоупа — 403 OUTSIDE_SCOPE.
 *
 * <p><b>Не сделано в этой версии</b> (SPEC §6.1, шаг 6 — «find полный»): {@code neighbor}, {@code neighbors},
 * {@code edge_fields}, {@code view} — отвечают 400 NOT_IMPLEMENTED, а не молча игнорируются.
 */
final class LoreFind {

    private LoreFind() {}

    static final int DEFAULT_LIMIT = 500;
    static final int MAX_LIMIT = 2_000;
    /** Потолок чтения кандидатов из БД. Выше — {@code complete:false} с причиной, а не тихая обрезка. */
    static final int SCAN_CAP = 20_000;
    static final int MAX_LINK_DEPTH = 3;

    private static final Pattern REL = Pattern.compile("[A-Z][A-Z_]{1,39}");
    private static final Set<String> OPS = Set.of("=", "!=", "set", "<", ">", "<=", ">=", "contains");
    private static final Set<String> NOT_YET = Set.of("neighbor", "neighbors", "edge_fields", "view");
    private static final Set<String> KNOWN_KEYS = Set.of("type", "where", "links_to", "not_linked", "id_in",
        "changed_within_days", "fields", "sort", "limit", "neighbor", "neighbors", "edge_fields", "view",
        // GC-05, 21.11: один параметр проекта (project; scope_projects — прежнее имя, с _warning) и текст поиска.
        "project", SliceProjectParam.LEGACY, "search");

    /** Ключи проекта (короткий код, aliases, slug) → slug базы; читаются один раз на запрос, только когда нужны. */
    private static final class ProjectKeys {
        private final LoreGraphResource.DbSource.Sql db;
        private Map<String, String> keys;
        ProjectKeys(LoreGraphResource.DbSource.Sql db) { this.db = db; }
        Map<String, String> get() {
            if (keys == null) keys = SliceProjectParam.keys(db.queryPublic("SELECT slug, short_code, aliases FROM KnowGitProject", Map.of()));
            return keys;
        }
        String canonical(String key) { return SliceProjectParam.canonical(key, get()); }
        boolean known(String slug) { return get().containsValue(slug); }
    }

    private static final String OPEN = "out('HAS_STATE')[valid_to IS NULL]";

    /** SCD2: поле открытой версии, иначе последней, где оно задано. */
    private static String scd2(String f) {
        return "COALESCE(" + OPEN + "." + f + "[0], out('HAS_STATE')[" + f + " IS NOT NULL]." + f + "[0])";
    }

    /** Поле: SQL-выражения (несколько — сливаются в один список) и признак многозначности. */
    record Field(List<String> sql, boolean list) {
        static Field one(String sql) { return new Field(List.of(sql), false); }
        static Field many(String... sql) { return new Field(List.of(sql), true); }
    }

    /**
     * Описание типа для find. {@code statusField} — поле с сырым статусом (для {@code status_category});
     * {@code repoLinks} — как запись типа связана с репозиторием (SQL-пути до {@code url}).
     */
    record TypeDef(String type, String vertexClass, String idField, Map<String, Field> fields, String statusField,
                   List<String> repoLinks) {
        boolean scoped() { return fields.containsKey("project"); }
    }

    private static final String TASK_PROJECT = "out('PART_OF').out('BELONGS_TO_PROJECT').slug";

    static final Map<String, TypeDef> TYPES = new LinkedHashMap<>();
    static {
        Map<String, Field> task = new LinkedHashMap<>();
        task.put("title", Field.one("title"));
        task.put("task_id", Field.one("task_id"));
        task.put("task_type", Field.one("task_type"));
        task.put("work_class", Field.one("work_class"));
        task.put("status_raw", Field.one(scd2("status_raw")));
        task.put("effort_days", Field.one(scd2("effort_days")));
        task.put("waiting_for", Field.one(scd2("waiting_for")));
        task.put("sprint_id", Field.one("out('PART_OF').sprint_id[0]"));
        task.put("phase_uid", Field.one("outE('IN_PHASE')[valid_to IS NULL].inV().phase_uid[0]"));
        task.put("component", Field.many("out('TAGGED_WITH').component_id"));
        task.put("project", Field.many(TASK_PROJECT));
        task.put("release_ids", Field.many("out('CLOSED_BY').out('SHIPPED_IN').release_id"));
        task.put("created_at", Field.one("out('HAS_STATE')[valid_from IS NOT NULL].valid_from[0]"));
        task.put("changed_at", Field.one(OPEN + ".valid_from[0]"));
        put(new TypeDef("task", "KnowTask", "task_uid", task, "status_raw", List.of(
            "out('TAGGED_WITH').out('COMPONENT_REPOSITORY').url",
            "out('PART_OF').out('BELONGS_TO_PROJECT').out('HAS_REPOSITORY').url")));

        Map<String, Field> sprint = new LinkedHashMap<>();
        sprint.put("title", Field.one("coalesce(title, name)"));
        sprint.put("status_raw", Field.one(scd2("status_raw")));
        sprint.put("priority", Field.one(scd2("priority")));
        sprint.put("created_date", Field.one("created_date"));
        sprint.put("planned_start_date", Field.one(scd2("planned_start_date")));
        sprint.put("planned_end_date", Field.one(scd2("planned_end_date")));
        sprint.put("milestone_ids", Field.many("outE('TARGETS_MILESTONE')[valid_to IS NULL].inV().milestone_id"));
        sprint.put("component", Field.many("out('BELONGS_TO')[component_id IS NOT NULL].component_id"));
        sprint.put("project", Field.many("out('BELONGS_TO_PROJECT').slug"));
        sprint.put("changed_at", Field.one(OPEN + ".valid_from[0]"));
        put(new TypeDef("sprint", "KnowSprint", "sprint_id", sprint, "status_raw", List.of(
            "out('BELONGS_TO').out('COMPONENT_REPOSITORY').url",
            "out('BELONGS_TO_PROJECT').out('HAS_REPOSITORY').url")));

        Map<String, Field> adr = new LinkedHashMap<>();
        adr.put("title", Field.one("name"));
        adr.put("status", Field.one("status"));
        adr.put("date_created", Field.one("date_created"));
        adr.put("component", Field.many("out('BELONGS_TO').component_id"));
        adr.put("project", Field.many("out('BELONGS_TO_PROJECT').slug"));
        put(new TypeDef("adr", "KnowADR", "adr_id", adr, "status", List.of(
            "out('BELONGS_TO').out('COMPONENT_REPOSITORY').url")));

        Map<String, Field> decision = new LinkedHashMap<>();
        decision.put("title", Field.one("title"));
        decision.put("status_raw", Field.one("status_raw"));
        decision.put("adr_id", Field.one("out('DECIDED_IN').adr_id[0]"));
        decision.put("component", Field.many("out('BELONGS_TO').component_id", "out('DECIDED_IN').out('BELONGS_TO').component_id"));
        decision.put("project", Field.many("out('BELONGS_TO_PROJECT').slug", "out('DECIDED_IN').out('BELONGS_TO_PROJECT').slug"));
        put(new TypeDef("decision", "KnowDecision", "decision_id", decision, "status_raw", List.of()));

        Map<String, Field> spec = new LinkedHashMap<>();
        spec.put("title", Field.one("title"));
        spec.put("status", Field.one(scd2("status")));
        spec.put("version", Field.one("COALESCE(" + OPEN + ".version[0], version)"));
        spec.put("component", Field.many("out('BELONGS_TO').component_id", "in('DOCUMENTED_IN').component_id"));
        spec.put("project", Field.many("out('BELONGS_TO_PROJECT').slug"));
        spec.put("changed_at", Field.one(OPEN + ".valid_from[0]"));
        put(new TypeDef("spec", "KnowSpec", "spec_id", spec, "status", List.of()));
    }

    private static void put(TypeDef d) { TYPES.put(d.type(), d); }

    /** Цель связи {@code <тип>:<ключ>}: класс и поле ключа. Репозиторий — вне графа GC-04, ключ — адрес. */
    record Target(String type, String vertexClass, String idField, String id) {}

    static Target target(String raw) {
        String s = raw == null ? "" : raw.strip();
        int colon = s.indexOf(':');
        if (colon <= 0 || colon == s.length() - 1)
            throw bad("links_to.id — в форме <тип>:<ключ>, например project:NooriUta/UnlimitedLORE или component:FORSETI");
        String type = s.substring(0, colon).strip();
        String id = s.substring(colon + 1).strip();
        if (id.length() > 300) throw bad("links_to.id: ключ длиннее 300 символов");
        if ("repository".equals(type)) return new Target(type, "KnowRepository", "url", id);
        if ("phase".equals(type)) return new Target(type, "KnowPhase", "phase_uid", id);
        LoreGraphResource.VDef v = LoreGraphResource.byType(type);
        if (v == null) {
            List<String> ok = new ArrayList<>(LoreGraphResource.graphTypes());
            ok.add("repository");
            ok.add("phase");
            throw bad("links_to.id: тип «" + type + "» не поддержан; допустимы " + ok);
        }
        return new Target(type, v.vertexClass(), v.idField(), id);
    }

    // ── вход ─────────────────────────────────────────────────────────────────

    /** Исполнение: разбор, SQL, условия, скоуп, сортировка, потолок. Без {@code took_ms} — его ставит ресурс. */
    static Map<String, Object> run(Map<String, Object> req, LoreGraphResource.DbSource.Sql db, Set<String> allowed,
                                   Instant now) {
        if (req == null) throw bad("тело запроса пусто: нужен как минимум type");
        for (String k : req.keySet()) {
            if (!KNOWN_KEYS.contains(k)) throw bad("неизвестный ключ «" + k + "»; допустимы " + new TreeSet<>(KNOWN_KEYS));
            if (NOT_YET.contains(k) && req.get(k) != null)
                throw new LoreGraphBuilder.GraphException(400, "NOT_IMPLEMENTED",
                    "«" + k + "» описан в SPEC-LORE-GRAPH-SEARCH §6.1, но в этой версии find ещё не исполняется");
        }
        TypeDef def = TYPES.get(str(req.get("type")));
        if (def == null) throw bad("type — один из " + TYPES.keySet() + "; получено «" + req.get("type") + "»");
        LoreGraphBuilder.requireNonEmpty(allowed);

        Set<String> known = new TreeSet<>(def.fields().keySet());
        known.add("id");
        known.add("status_category");

        ProjectKeys pk = new ProjectKeys(db);
        Object where = req.get("where");
        List<Object> conds = where == null ? List.of() : asList(where, "where");
        for (Object c : conds) validate(c, known);
        // GC-05, 21.11: значение поля project в условии — тоже ключ проекта (короткий код, aliases).
        List<Object> canon = new ArrayList<>();
        for (Object c : conds) canon.add(canonProject(c, pk));
        conds = canon;

        // GC-05 «поиск с мультифильтром» (§12.4): текст — тонкий мост поверх тех же строк и условий, не второй
        // механизм. Каждое слово обязано встретиться в коде или названии записи (без регистра).
        List<String> searchTokens = null;
        String searchText = null;
        if (req.get("search") != null) {
            searchText = str(req.get("search")).strip();
            if (searchText.isEmpty()) throw bad("search — непустая строка");
            if (searchText.length() > 160) throw bad("search — не длиннее 160 символов");
            searchTokens = new ArrayList<>();
            for (String w : searchText.toLowerCase(Locale.ROOT).split("\\s+")) if (!w.isEmpty()) searchTokens.add(w);
        }

        // GC-05, 21.11: один параметр проекта. project — каноническое имя; scope_projects — прежнее, с _warning.
        List<String> warnings = new ArrayList<>();
        List<String> projects = projectList(req.get("project"), "project", pk);
        List<String> legacyProjects = projectList(req.get(SliceProjectParam.LEGACY), SliceProjectParam.LEGACY, pk);
        if (legacyProjects != null) warnings.add(SliceProjectParam.LEGACY_WARNING);

        int limit = intOr(req.get("limit"), DEFAULT_LIMIT, "limit");
        if (limit < 1 || limit > MAX_LIMIT) throw bad("limit — от 1 до " + MAX_LIMIT);

        List<String> fields = new ArrayList<>();
        Object fieldsRaw = req.get("fields");
        if (fieldsRaw == null) {
            if (def.fields().containsKey(def.statusField())) fields.add(def.statusField());
            fields.add("status_category");
        } else {
            for (Object f : asList(fieldsRaw, "fields")) {
                String name = str(f);
                if (!known.contains(name)) throw bad("fields: поле «" + name + "» у типа " + def.type() + " нет; допустимы " + known);
                if (!"id".equals(name) && !"title".equals(name)) fields.add(name);
            }
        }

        List<Map<String, Object>> sort = new ArrayList<>();
        Object sortRaw = req.get("sort");
        if (sortRaw != null) {
            for (Object s : asList(sortRaw, "sort")) {
                Map<String, Object> m = asMap(s, "sort[]");
                String f = str(m.get("field"));
                if (!known.contains(f)) throw bad("sort: поле «" + f + "» у типа " + def.type() + " нет; допустимы " + known);
                String d = m.get("dir") == null ? "asc" : str(m.get("dir")).toLowerCase(Locale.ROOT);
                if (!"asc".equals(d) && !"desc".equals(d)) throw bad("sort.dir — asc или desc");
                sort.add(Map.of("field", f, "dir", d));
            }
        }

        Integer changedDays = null;
        if (req.get("changed_within_days") != null) {
            changedDays = intOr(req.get("changed_within_days"), 0, "changed_within_days");
            if (changedDays < 1 || changedDays > 3650) throw bad("changed_within_days — от 1 до 3650");
            if (!def.fields().containsKey("changed_at"))
                throw bad("changed_within_days: у типа " + def.type() + " нет даты версии (changed_at)");
        }

        // ── SQL ──
        Map<String, Object> params = new LinkedHashMap<>();
        List<String> sqlWhere = new ArrayList<>();
        Object ids = req.get("id_in");
        if (ids != null) {
            List<String> list = new ArrayList<>();
            for (Object o : asList(ids, "id_in")) list.add(str(o));
            if (list.isEmpty()) throw bad("id_in — непустой список ключей");
            if (list.size() > MAX_LIMIT) throw bad("id_in — не больше " + MAX_LIMIT + " ключей");
            params.put("ids", list);
            sqlWhere.add(def.idField() + " IN :ids");
        }
        Object links = req.get("links_to");
        if (links != null) {
            List<Object> all = links instanceof List<?> l ? new ArrayList<>(l) : List.of(links);
            int i = 0;
            for (Object o : all) sqlWhere.add(linkSql(def, asMap(o, "links_to"), "lt" + (i++), params, allowed, db, pk));
        }
        if (projects != null || legacyProjects != null) {
            if (!def.fields().containsKey("project"))
                throw bad("project: у типа " + def.type() + " проекта нет — фильтровать нечем");
            List<String> chosen = new ArrayList<>(projects != null ? projects : legacyProjects);
            List<String> all = new ArrayList<>(chosen);
            if (projects != null && legacyProjects != null) all.addAll(legacyProjects);
            for (String p : all) {
                if (!pk.known(p))
                    throw new LoreGraphBuilder.GraphException(404, "NOT_FOUND", "project: проект «" + p + "» не найден");
                if (allowed != null && !allowed.contains(p))
                    throw new LoreGraphBuilder.GraphException(403, "OUTSIDE_SCOPE",
                        "project: проект «" + p + "» вне разрешённых вызывающему проектов");
            }
            if (projects != null && legacyProjects != null) chosen.retainAll(new LinkedHashSet<>(legacyProjects));
            if (chosen.isEmpty()) chosen.add(SliceProjectNarrowing.NO_PROJECT);
            List<String> parts = new ArrayList<>();
            for (int j = 0; j < chosen.size(); j++) {
                params.put("pj" + j, chosen.get(j));
                for (String path : def.fields().get("project").sql()) parts.add(path + " CONTAINS :pj" + j);
            }
            sqlWhere.add("(" + String.join(" OR ", parts) + ")");
        }
        Object notLinked = req.get("not_linked");
        if (notLinked != null) {
            Map<String, Object> m = asMap(notLinked, "not_linked");
            List<String> rels = rels(m.get("rels"), "not_linked.rels");
            if (rels.isEmpty()) throw bad("not_linked.rels — хотя бы одно ребро");
            sqlWhere.add(currentEdges(dir(m.get("dir"), "out"), rels) + ".size() = 0");
        }

        StringBuilder sb = new StringBuilder("SELECT ").append(def.idField()).append(" AS __id");
        for (Map.Entry<String, Field> en : def.fields().entrySet()) {
            List<String> sqls = en.getValue().sql();
            for (int i = 0; i < sqls.size(); i++) sb.append(", ").append(sqls.get(i)).append(" AS ").append(alias(en.getKey(), i));
        }
        sb.append(" FROM ").append(def.vertexClass());
        if (!sqlWhere.isEmpty()) sb.append(" WHERE ").append(String.join(" AND ", sqlWhere));
        sb.append(" LIMIT ").append(SCAN_CAP + 1);
        String sql = sb.toString();

        List<Map<String, Object>> raw = db.queryPublic(sql, params);
        boolean scanCapped = raw.size() > SCAN_CAP;
        if (scanCapped) raw = raw.subList(0, SCAN_CAP);

        // ── строки, условия, скоуп ──
        Instant since = changedDays == null ? null : now.minus(changedDays, ChronoUnit.DAYS);
        List<Map<String, Object>> matched = new ArrayList<>();
        int hidden = 0;
        for (Map<String, Object> r : raw) {
            Map<String, Object> row = project(def, r);
            if (row.get("id") == null) continue;
            if (since != null) {
                Instant at = instant(row.get("changed_at"));
                if (at == null || at.isBefore(since)) continue;
            }
            boolean ok = true;
            if (searchTokens != null) {
                String hay = (row.get("id") + " " + str(row.get("title"))).toLowerCase(Locale.ROOT);
                for (String w : searchTokens) if (!hay.contains(w)) { ok = false; break; }
            }
            if (ok) for (Object c : conds) if (!eval(c, row)) { ok = false; break; }
            if (!ok) continue;
            if (!visible(def, row, allowed)) { hidden++; continue; }
            matched.add(row);
        }

        Comparator<Map<String, Object>> cmp = null;
        for (Map<String, Object> s : sort) {
            String f = (String) s.get("field");
            Comparator<Map<String, Object>> c = (a, b) -> compareNullsLast(a.get(f), b.get(f));
            if ("desc".equals(s.get("dir"))) c = (a, b) -> compareNullsLast(b.get(f), a.get(f), true);
            cmp = cmp == null ? c : cmp.thenComparing(c);
        }
        Comparator<Map<String, Object>> byId = Comparator.comparing(r -> String.valueOf(r.get("id")));
        matched.sort(cmp == null ? byId : cmp.thenComparing(byId));

        int total = matched.size();
        boolean truncated = total > limit;
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Map<String, Object> r : matched.subList(0, Math.min(limit, total))) {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("id", r.get("id"));
            out.put("type", def.type());
            out.put("title", r.get("title"));
            for (String f : fields) out.put(f, r.get(f));
            rows.add(out);
        }

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("type", def.type());
        meta.put("complete", !truncated && !scanCapped);
        meta.put("truncated", truncated);
        meta.put("capped_at", truncated ? limit : null);
        meta.put("limit", limit);
        meta.put("total", total);
        meta.put("scan_capped", scanCapped);
        if (scanCapped) meta.put("scan_cap", SCAN_CAP);
        meta.put("hidden_by_scope", hidden);
        if (rows.isEmpty()) meta.put("empty_reason", hidden > 0 ? "hidden_by_scope" : "no_match");
        if (rows.isEmpty() && hidden > 0)
            meta.put("note", "подходящие записи есть (" + hidden + "), но все вне разрешённых вызывающему проектов");
        meta.put("sql_hash", sha(sql));
        if (searchText != null) {
            Map<String, Object> s = new LinkedHashMap<>();
            s.put("text", searchText);
            s.put("mode", "substring");
            s.put("fields", List.of("id", "title"));
            s.put("note", "каждое слово — в коде или названии записи; ранжированный полнотекстовый поиск по телам — search");
            meta.put("search", s);
        }
        if (projects != null || legacyProjects != null) {
            Map<String, Object> p = new LinkedHashMap<>();
            if (projects != null) p.put("project", projects);
            if (legacyProjects != null) p.put(SliceProjectParam.LEGACY, legacyProjects);
            meta.put("project", p);
        }
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("rows", rows);
        res.put("meta", meta);
        if (!warnings.isEmpty()) res.put("_warning", String.join("; ", warnings));
        return res;
    }

    // ── связи ────────────────────────────────────────────────────────────────

    private static String linkSql(TypeDef def, Map<String, Object> m, String p, Map<String, Object> params,
                                  Set<String> allowed, LoreGraphResource.DbSource.Sql db, ProjectKeys pk) {
        Target t = target(str(m.get("id")));
        // GC-05, 21.11: project:<короткий код | прежнее «владелец/репо»> → ключ проекта этой базы.
        if ("project".equals(t.type())) t = new Target(t.type(), t.vertexClass(), t.idField(), pk.canonical(t.id()));
        List<String> rels = rels(m.get("rels"), "links_to.rels");
        int depth = intOr(m.get("depth"), 1, "links_to.depth");
        if (depth < 1 || depth > MAX_LINK_DEPTH) throw bad("links_to.depth — от 1 до " + MAX_LINK_DEPTH);
        String dir = dir(m.get("dir"), "both");

        // Цель обязана существовать: «нет такой записи» ≠ «ничего не связано».
        if (db.queryPublic("SELECT " + t.idField() + " FROM " + t.vertexClass() + " WHERE " + t.idField() + " = :v LIMIT 1",
                Map.of("v", t.id())).isEmpty())
            throw new LoreGraphBuilder.GraphException(404, "NOT_FOUND", "links_to: " + t.type() + " «" + t.id() + "» не найден");
        if ("project".equals(t.type()) && allowed != null && !allowed.contains(t.id()))
            throw new LoreGraphBuilder.GraphException(403, "OUTSIDE_SCOPE",
                "links_to: проект «" + t.id() + "» вне разрешённых вызывающему проектов");
        params.put(p, t.id());

        if (rels.isEmpty()) {
            // Без rels — связь по устройству модели: проект и компонент — те же пути, что у срезов
            // (open_tasks?project, фасет компонента), репозиторий — через компонент или проект.
            List<String> paths = switch (t.type()) {
                case "project" -> def.fields().containsKey("project") ? def.fields().get("project").sql() : List.of();
                case "component" -> def.fields().containsKey("component") ? def.fields().get("component").sql() : List.of();
                case "repository" -> def.repoLinks();
                default -> List.of();
            };
            if (paths.isEmpty())
                throw bad("links_to " + t.type() + " у типа " + def.type() + " без rels не определена — укажите rels (и depth/dir)");
            List<String> parts = new ArrayList<>();
            for (String path : paths) parts.add(path + " CONTAINS :" + p);
            return "(" + String.join(" OR ", parts) + ")";
        }
        List<String> parts = new ArrayList<>();
        StringBuilder chain = new StringBuilder();
        for (int d = 1; d <= depth; d++) {
            if (d > 1) chain.append('.');
            chain.append(hop(dir, rels));
            parts.add(chain + "." + t.idField() + " CONTAINS :" + p);
        }
        String linked = "(" + String.join(" OR ", parts) + ")";
        // bothV() отдаёт и сам исходный узел: запись «связана сама с собой» — не связь.
        if ("both".equals(dir) && t.vertexClass().equals(def.vertexClass()))
            linked = "(" + linked + " AND " + def.idField() + " <> :" + p + ")";
        return linked;
    }

    /**
     * Один шаг по рёбрам {@code rels} — ТОЛЬКО по текущим (без {@code valid_to}). Историчные связи
     * (edge_history модели: IN_PHASE, TARGETS_MILESTONE, ROLE_HELD_BY, …) хранят закрытые рёбра рядом
     * с открытым; переход {@code out(<связь>)} по вершинам взял бы и закрытые — «бывшая фаза» стала бы
     * текущей. У неисторичного ребра поля {@code valid_to} нет — фильтр его пропускает.
     */
    private static String hop(String dir, List<String> rels) {
        String names = edgeNames(rels);
        return switch (dir) {
            case "out" -> "outE(" + names + ")[valid_to IS NULL].inV()";
            case "in" -> "inE(" + names + ")[valid_to IS NULL].outV()";
            default -> "bothE(" + names + ")[valid_to IS NULL].bothV()";
        };
    }

    /** «Есть текущее ребро» по тем же правилам, что {@link #hop}. */
    private static String currentEdges(String dir, List<String> rels) {
        String names = edgeNames(rels);
        return switch (dir) {
            case "out" -> "outE(" + names + ")[valid_to IS NULL]";
            case "in" -> "inE(" + names + ")[valid_to IS NULL]";
            default -> "bothE(" + names + ")[valid_to IS NULL]";
        };
    }

    private static String edgeNames(List<String> rels) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < rels.size(); i++) {
            if (i > 0) sb.append(", ");
            sb.append('\'').append(rels.get(i)).append('\'');
        }
        return sb.toString();
    }

    private static List<String> rels(Object raw, String name) {
        List<String> out = new ArrayList<>();
        if (raw == null) return out;
        List<Object> list = raw instanceof String s ? new ArrayList<>(List.of((Object[]) s.split(","))) : asList(raw, name);
        for (Object o : list) {
            String r = str(o).strip().toUpperCase(Locale.ROOT);
            if (r.isEmpty()) continue;
            if (!REL.matcher(r).matches()) throw bad(name + ": «" + o + "» — не имя типа ребра");
            if (!out.contains(r)) out.add(r);
        }
        return out;
    }

    private static String dir(Object raw, String def) {
        String d = raw == null ? def : str(raw).strip().toLowerCase(Locale.ROOT);
        if (!LoreGraphBuilder.DIRS.contains(d)) throw bad("dir — in, out или both; получено «" + raw + "»");
        return d;
    }

    // ── строки ───────────────────────────────────────────────────────────────

    private static String alias(String field, int i) {
        return "f_" + field + "_" + i;
    }

    private static Map<String, Object> project(TypeDef def, Map<String, Object> r) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", LoreRecordValues.str(r.get("__id")));
        for (Map.Entry<String, Field> en : def.fields().entrySet()) {
            Field f = en.getValue();
            if (f.list()) {
                Set<Object> merged = new LinkedHashSet<>();
                for (int i = 0; i < f.sql().size(); i++) {
                    Object v = r.get(alias(en.getKey(), i));
                    if (v instanceof Collection<?> c) { for (Object x : c) if (x != null) merged.add(x); }
                    else if (v != null) merged.add(v);
                }
                List<Object> sorted = new ArrayList<>(merged);
                sorted.sort(Comparator.comparing(String::valueOf));
                row.put(en.getKey(), sorted);
            } else {
                Object v = r.get(alias(en.getKey(), 0));
                if (v instanceof Collection<?> c) v = c.isEmpty() ? null : c.iterator().next();
                row.put(en.getKey(), v);
            }
        }
        row.put("status_category", LoreStatusCategory.of(def.type(), row.get(def.statusField())));
        return row;
    }

    private static boolean visible(TypeDef def, Map<String, Object> row, Set<String> allowed) {
        if (allowed == null || !def.scoped()) return true;
        // Технология (KnowSpec SPEC-TECH-…) — общий справочник, как в графе.
        if ("spec".equals(def.type()) && String.valueOf(row.get("id")).startsWith(LoreRecordValues.TECH_SPEC_PREFIX)) return true;
        Object p = row.get("project");
        if (p instanceof Collection<?> c) for (Object x : c) if (allowed.contains(String.valueOf(x))) return true;
        return false;
    }

    // ── проект ───────────────────────────────────────────────────────────────

    /** Значение параметра проекта: строка «a,b» или список → ключи базы; {@code null} — параметра нет. */
    private static List<String> projectList(Object raw, String name, ProjectKeys pk) {
        if (raw == null) return null;
        List<String> out = new ArrayList<>();
        List<Object> items = raw instanceof String s ? new ArrayList<>(List.of((Object[]) s.split(","))) : asList(raw, name);
        for (Object o : items) {
            String v = str(o).strip();
            if (v.isEmpty()) continue;
            if (v.length() > 300) throw bad(name + ": ключ проекта длиннее 300 символов");
            String c = pk.canonical(v);
            if (!out.contains(c)) out.add(c);
        }
        if (out.isEmpty()) throw bad(name + " — хотя бы один ключ проекта (короткий код или slug)");
        return out;
    }

    /** Условие с полем project: значения → ключи базы (копия, вход не меняется). */
    @SuppressWarnings("unchecked")
    private static Object canonProject(Object c, ProjectKeys pk) {
        Map<String, Object> m = (Map<String, Object>) c;
        Map<String, Object> out = new LinkedHashMap<>(m);
        for (String k : List.of("or", "and")) {
            if (m.containsKey(k)) {
                List<Object> list = new ArrayList<>();
                for (Object x : (List<Object>) m.get(k)) list.add(canonProject(x, pk));
                out.put(k, list);
                return out;
            }
        }
        if (m.containsKey("not")) { out.put("not", canonProject(m.get("not"), pk)); return out; }
        if (!"project".equals(str(m.get("field"))) || m.get("value") == null || "set".equals(str(m.get("op")))
                || "contains".equals(str(m.get("op")))) return out;
        Object v = m.get("value");
        if (v instanceof Collection<?> col) {
            List<Object> list = new ArrayList<>();
            for (Object x : col) list.add(x == null ? null : pk.canonical(String.valueOf(x)));
            out.put("value", list);
        } else {
            out.put("value", pk.canonical(String.valueOf(v)));
        }
        return out;
    }

    // ── условия ──────────────────────────────────────────────────────────────

    private static void validate(Object c, Set<String> known) {
        Map<String, Object> m = asMap(c, "where[]");
        if (m.containsKey("or") || m.containsKey("and")) {
            String k = m.containsKey("or") ? "or" : "and";
            List<Object> list = asList(m.get(k), k);
            if (list.isEmpty()) throw bad(k + " — непустой список условий");
            for (Object x : list) validate(x, known);
            return;
        }
        if (m.containsKey("not")) { validate(m.get("not"), known); return; }
        String field = str(m.get("field"));
        if (!known.contains(field)) throw bad("where: поле «" + field + "» не из модели этого типа; допустимы " + known);
        String op = str(m.get("op"));
        if (!OPS.contains(op)) throw bad("where: оператор «" + op + "» не поддержан; допустимы " + new TreeSet<>(OPS));
        if (!"set".equals(op) && !m.containsKey("value")) throw bad("where: у оператора «" + op + "» нужен value");
    }

    @SuppressWarnings("unchecked")
    private static boolean eval(Object c, Map<String, Object> row) {
        Map<String, Object> m = (Map<String, Object>) c;
        if (m.containsKey("or")) {
            for (Object x : (List<Object>) m.get("or")) if (eval(x, row)) return true;
            return false;
        }
        if (m.containsKey("and")) {
            for (Object x : (List<Object>) m.get("and")) if (!eval(x, row)) return false;
            return true;
        }
        if (m.containsKey("not")) return !eval(m.get("not"), row);
        String op = str(m.get("op"));
        Object actual = row.get(str(m.get("field")));
        List<Object> values = actualValues(actual);
        Object v = m.get("value");
        switch (op) {
            case "set" -> {
                boolean set = !values.isEmpty();
                boolean want = v == null || Boolean.TRUE.equals(v) || "true".equals(String.valueOf(v));
                return set == want;
            }
            case "=" -> { return anyEquals(values, v); }
            case "!=" -> { return !anyEquals(values, v); }
            case "contains" -> {
                String needle = String.valueOf(v).toLowerCase(Locale.ROOT);
                for (Object a : values) if (String.valueOf(a).toLowerCase(Locale.ROOT).contains(needle)) return true;
                return false;
            }
            default -> {
                for (Object a : values) {
                    int r = compare(a, v);
                    boolean ok = switch (op) {
                        case "<" -> r < 0;
                        case ">" -> r > 0;
                        case "<=" -> r <= 0;
                        default -> r >= 0;
                    };
                    if (ok) return true;
                }
                return false;
            }
        }
    }

    private static List<Object> actualValues(Object actual) {
        List<Object> out = new ArrayList<>();
        if (actual instanceof Collection<?> c) { for (Object x : c) if (x != null && !String.valueOf(x).isEmpty()) out.add(x); }
        else if (actual != null && !String.valueOf(actual).isEmpty()) out.add(actual);
        return out;
    }

    private static boolean anyEquals(List<Object> values, Object v) {
        List<Object> wanted = v instanceof Collection<?> c ? new ArrayList<>(c) : java.util.Collections.singletonList(v);
        for (Object a : values) for (Object w : wanted) if (w != null && compare(a, w) == 0) return true;
        return false;
    }

    /** Числа — как числа, даты — как моменты времени, прочее — строкой. */
    static int compare(Object a, Object b) {
        BigDecimal na = number(a);
        BigDecimal nb = number(b);
        if (na != null && nb != null) return na.compareTo(nb);
        Instant ia = instant(a);
        Instant ib = instant(b);
        if (ia != null && ib != null) return ia.compareTo(ib);
        return String.valueOf(a).compareTo(String.valueOf(b));
    }

    private static int compareNullsLast(Object a, Object b) {
        return compareNullsLast(a, b, false);
    }

    /** Пустое — в конце при любом направлении. {@code swapped} — аргументы переставлены ради desc. */
    private static int compareNullsLast(Object a, Object b, boolean swapped) {
        Object x = a instanceof Collection<?> c ? (c.isEmpty() ? null : c.iterator().next()) : a;
        Object y = b instanceof Collection<?> c ? (c.isEmpty() ? null : c.iterator().next()) : b;
        if (x == null && y == null) return 0;
        if (x == null) return swapped ? -1 : 1;
        if (y == null) return swapped ? 1 : -1;
        return compare(x, y);
    }

    private static BigDecimal number(Object o) {
        if (o instanceof Number n) return new BigDecimal(n.toString());
        if (o instanceof String s && s.matches("-?\\d+(\\.\\d+)?")) return new BigDecimal(s);
        return null;
    }

    static Instant instant(Object o) {
        if (o == null) return null;
        if (o instanceof java.util.Date d) return d.toInstant();
        if (o instanceof Instant i) return i;
        if (o instanceof java.time.LocalDateTime l) return l.toInstant(ZoneOffset.UTC);
        if (o instanceof LocalDate l) return l.atStartOfDay(ZoneOffset.UTC).toInstant();
        String s = String.valueOf(o).strip();
        if (s.length() < 10 || !Character.isDigit(s.charAt(0))) return null;
        try { return Instant.parse(s); } catch (RuntimeException ignored) { /* дальше */ }
        try { return OffsetDateTime.parse(s).toInstant(); } catch (RuntimeException ignored) { /* дальше */ }
        try { return java.time.LocalDateTime.parse(s.replace(' ', 'T')).toInstant(ZoneOffset.UTC); } catch (RuntimeException ignored) { /* дальше */ }
        try { return LocalDate.parse(s.substring(0, 10)).atStartOfDay(ZoneOffset.UTC).toInstant(); } catch (RuntimeException ignored) { return null; }
    }

    // ── мелочи ───────────────────────────────────────────────────────────────

    private static LoreGraphBuilder.GraphException bad(String msg) {
        return new LoreGraphBuilder.GraphException(400, "BAD_PARAMS", msg);
    }

    private static String str(Object o) {
        return o == null ? "" : String.valueOf(o);
    }

    @SuppressWarnings("unchecked")
    private static List<Object> asList(Object o, String name) {
        if (o instanceof List<?> l) return (List<Object>) l;
        throw bad(name + " — ожидается список");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object o, String name) {
        if (o instanceof Map<?, ?> m) return (Map<String, Object>) m;
        throw bad(name + " — ожидается объект");
    }

    private static int intOr(Object o, int def, String name) {
        if (o == null) return def;
        if (o instanceof Number n && n.doubleValue() == Math.rint(n.doubleValue())) return n.intValue();
        if (o instanceof String s && s.strip().matches("-?\\d{1,9}")) return Integer.parseInt(s.strip());
        throw bad(name + " — целое число");
    }

    private static String sha(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(d).substring(0, 16);
        } catch (Exception e) {
            return null;
        }
    }
}
