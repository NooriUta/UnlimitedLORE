package studio.seer.heimdall.lore;

import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-04 — {@code GET /lore/graph}: граф одним запросом
 * в форме «узлы + рёбра (from, rel, to)» — вход GraphExplorer (GC-03).
 *
 * <ul>
 *   <li><b>Окрестность записи</b>: {@code ?type&id&depth=1..3[&rels][&types][&structural][&limit]} —
 *       рёбра в обе стороны, обход в ширину, каждая вершина один раз.</li>
 *   <li><b>Срез</b>: {@code ?scope=project:<slug>|component:<id>|all[&types][&rels][&structural][&limit]} —
 *       записи среза (уровень 0) и одно кольцо соседей (уровень 1).</li>
 * </ul>
 *
 * <p>Логика обхода, потолка, скоупа и висячих концов — в {@link LoreGraphBuilder};
 * здесь — разбор параметров и чтение ArcadeDB ({@link DbSource}). Узел: {@code id} —
 * бизнес-ключ (задача — {@code SPRINT/CODE}, релиз — {@code release_uid}, проект — slug),
 * {@code type} — тип паспорта ({@link LoreRecordRegistry#TYPES}), статус — с открытой
 * строки SCD2 там, где он живёт в истории, токеном той же оси, что {@code /lore/record},
 * и категорией {@link LoreStatusCategory}. У типов вне оси статусов {@code /lore/model}
 * ({@link LoreModel#STATUS_DICTS}) статус и категория — {@code null}: не выдумываем.
 *
 * <p>Скоуп — тот же резолвер, что у слайсов ({@link AidaLoreResource#allowedProjectsOrNull}),
 * и те же пути до проекта, что у {@link LoreSlices#PROJECT_SCOPED}. Не посчитался — 502,
 * а не ответ без скоупа.
 */
@Path("/lore/graph")
public class LoreGraphResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreGraphResource.class);

    static final int NEIGHBORHOOD_DEFAULT_LIMIT = 500;
    /** Граф знаний целиком (11.11.2026: 7 354 узла) должен входить в ответ по умолчанию. */
    static final int SLICE_DEFAULT_LIMIT = 10_000;
    static final int MAX_LIMIT = 20_000;
    private static final int CHUNK = 500;

    private static final Pattern REL = Pattern.compile("[A-Z][A-Z_]{1,39}");
    private static final Pattern RID = Pattern.compile("#\\d+:\\d+");

    @Inject
    AidaLoreResource sliceScope;

    // ── модель вершин графа ──────────────────────────────────────────────────

    enum Axis { PLAN, DOC, NONE }

    /**
     * Класс вершины графа. {@code projectPaths == null} — общий справочник (компонент, веха —
     * как у слайсов: components в SHARED_SLICES, milestones в SCOPE_PENDING без проектной оси).
     * Пути проекта — те же, что у PROJECT_SCOPED; пути компонента — те же, что у фасетов поиска.
     */
    record VDef(String type, String vertexClass, String idField, String titleExpr, String statusExpr, Axis axis,
                List<String> projectPaths, List<String> compPaths) {}

    private static final String PROJ = "out('BELONGS_TO_PROJECT').slug";
    private static final String COMP = "out('BELONGS_TO').component_id";
    private static final String OPEN = "out('HAS_STATE')[valid_to IS NULL]";

    static final List<VDef> VERTICES = List.of(
        new VDef("sprint", "KnowSprint", "sprint_id", "name", OPEN + ".status_raw[0]", Axis.PLAN,
            List.of(PROJ), List.of(COMP)),
        new VDef("task", "KnowTask", "task_uid", "title", OPEN + ".status_raw[0]", Axis.PLAN,
            List.of("out('PART_OF')." + PROJ), List.of("out('TAGGED_WITH').component_id", "out('PART_OF')." + COMP)),
        new VDef("adr", "KnowADR", "adr_id", "name", "status", Axis.DOC,
            List.of(PROJ), List.of(COMP)),
        // KnowSpec с ключом SPEC-TECH-… — тип tech (общий реестр технологий, без скоупа).
        new VDef("spec", "KnowSpec", "spec_id", "title", OPEN + ".status[0]", Axis.DOC,
            List.of(PROJ), List.of(COMP, "in('DOCUMENTED_IN').component_id")),
        new VDef("decision", "KnowDecision", "decision_id", "title", "status_raw", Axis.DOC,
            List.of(PROJ, "out('DECIDED_IN')." + PROJ), List.of(COMP, "out('DECIDED_IN')." + COMP)),
        new VDef("question", "KnowQuestion", "question_id", "title", null, Axis.NONE,
            List.of(LoreSlices.QUESTION_SCOPE.split("\\|")), List.of(COMP)),
        new VDef("milestone", "KnowMilestone", "milestone_id", "label", null, Axis.NONE,
            null, List.of()),
        new VDef("release", "KnowRelease", "release_uid", "git_tag", null, Axis.NONE,
            List.of(PROJ), List.of()),
        new VDef("component", "LoreComponent", "component_id", "full_name", null, Axis.NONE,
            null, List.of()),
        new VDef("feature", "KnowUseCase", "uc_id", "title", null, Axis.NONE,
            List.of(LoreSlices.UC_INHERITED_SCOPE.split("\\|")), List.of(COMP)),
        // Проект — сам себе проект ("=slug" у PROJECT_SCOPED).
        new VDef("project", "KnowGitProject", "slug", "name", null, Axis.NONE,
            List.of("slug"), List.of()));

    static final Map<String, VDef> BY_CLASS = new HashMap<>();
    static {
        for (VDef v : VERTICES) BY_CLASS.put(v.vertexClass(), v);
    }

    /** Тип паспорта → вершина. {@code tech} — та же KnowSpec. */
    static VDef byType(String type) {
        if ("tech".equals(type)) return BY_CLASS.get("KnowSpec");
        for (VDef v : VERTICES) if (v.type().equals(type)) return v;
        return null;
    }

    // ── эндпоинт ─────────────────────────────────────────────────────────────

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    @io.smallrye.common.annotation.Blocking
    public Response graph(@QueryParam("type") String type,
                          @QueryParam("id") String id,
                          @QueryParam("depth") String depthParam,
                          @QueryParam("scope") String scopeParam,
                          @QueryParam("rels") String relsParam,
                          @QueryParam("types") String typesParam,
                          @QueryParam("structural") String structuralParam,
                          @QueryParam("limit") String limitParam,
                          @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        long t0 = System.nanoTime();

        boolean hasScope = scopeParam != null && !scopeParam.isBlank();
        boolean hasRecord = (type != null && !type.isBlank()) || (id != null && !id.isBlank());
        if (hasScope == hasRecord) {
            return badParams("задайте либо scope=all|project:<slug>|component:<id> (срез), "
                + "либо type и id (окрестность записи) — ровно одно из двух");
        }

        Set<String> rels = new LinkedHashSet<>();
        for (String r : csv(relsParam)) {
            String u = r.toUpperCase(Locale.ROOT);
            if (!REL.matcher(u).matches()) return badParams("rels: «" + r + "» — не имя типа ребра");
            rels.add(u);
        }
        Set<String> types = new LinkedHashSet<>();
        for (String t : csv(typesParam)) {
            if (!LoreRecordRegistry.TYPES.contains(t))
                return badParams("types: «" + t + "» — неизвестный тип; допустимы " + LoreRecordRegistry.TYPES);
            types.add(t);
        }
        Boolean structural = parseBool(structuralParam);
        if (structural == null) return badParams("structural — true или false");
        Integer limit = parseInt(limitParam, hasScope ? SLICE_DEFAULT_LIMIT : NEIGHBORHOOD_DEFAULT_LIMIT);
        if (limit == null || limit < 1 || limit > MAX_LIMIT) return badParams("limit — от 1 до " + MAX_LIMIT);

        LoreGraphBuilder.Scope scope = null;
        VDef rootDef = null;
        int depth = 1;
        try {
            if (hasScope) {
                scope = LoreGraphBuilder.parseScope(scopeParam);
            } else {
                if (type == null || type.isBlank() || !LoreRecordRegistry.TYPES.contains(type.strip()))
                    return badParams("type — один из " + LoreRecordRegistry.TYPES);
                rootDef = byType(type.strip());
                if (rootDef == null) return badParams("type «" + type + "» в граф не входит");
                if (id == null || id.isBlank()) return badParams("id обязателен");
                if (id.length() > 200) return badParams("id длиннее 200 символов");
                Integer d = parseInt(depthParam, 1);
                if (d == null || d < 1 || d > LoreGraphBuilder.MAX_DEPTH)
                    return badParams("depth — от 1 до " + LoreGraphBuilder.MAX_DEPTH);
                depth = d;
            }
        } catch (LoreGraphBuilder.GraphException e) {
            return refusal(e);
        }

        Set<String> allowed;
        try {
            allowed = sliceScope.allowedProjectsOrNull(role);
        } catch (RuntimeException e) {
            // Скоуп не посчитан — отвечать «без скоупа» нельзя: это был бы обход.
            LOG.warnf("[LORE GRAPH] скоуп не посчитан: %s", e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(LoreUpstream.error(e, "проектный скоуп не посчитан: " + LoreUpstream.detail(e))));
        }

        DbSource src = new DbSource(ingestService);
        LoreGraphBuilder.Result result;
        try {
            LoreGraphBuilder.Query q;
            if (scope != null) {
                LoreGraphBuilder.checkSliceScope(scope, allowed);
                q = LoreGraphBuilder.Query.slice(src.seeds(scope), rels, types, structural, limit, allowed);
            } else {
                LoreGraphBuilder.requireNonEmpty(allowed); // 403 SCOPE_EMPTY раньше 404: пустой скоуп не узнаёт, есть ли запись
                String rid = src.resolve(rootDef, id.strip());
                q = LoreGraphBuilder.Query.neighborhood(rid, depth, rels, types, structural, limit, allowed);
            }
            result = LoreGraphBuilder.build(q, src);
        } catch (LoreGraphBuilder.GraphException e) {
            return refusal(e);
        } catch (Exception e) {
            LOG.warnf("[LORE GRAPH] %s: %s", hasScope ? scopeParam : type + "/" + id, e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(LoreUpstream.error(e, LoreUpstream.detail(e))));
        }

        Map<String, Object> out = result.toJson();
        @SuppressWarnings("unchecked")
        Map<String, Object> meta = (Map<String, Object>) out.get("meta");
        if (scope != null) meta.put("scope", scope.value() == null ? scope.kind() : scope.kind() + ":" + scope.value());
        if (allowed != null) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("applied", true);
            m.put("projects", allowed.size());
            m.put("note", "выдача сужена проектным скоупом — узлы вне разрешённых проектов не показаны");
            meta.put("caller_scope", m);
        }
        meta.put("took_ms", (System.nanoTime() - t0) / 1_000_000);
        return noStore(Response.ok(out));
    }

    private Response refusal(LoreGraphBuilder.GraphException e) {
        return noStore(Response.status(e.status()).entity(new LoreError(e.code(), e.getMessage())));
    }

    private static List<String> csv(String s) {
        List<String> out = new ArrayList<>();
        if (s == null || s.isBlank()) return out;
        for (String p : s.split(",")) if (!p.isBlank()) out.add(p.strip());
        return out;
    }

    /** null — значение не распознано (а не «false»). */
    static Boolean parseBool(String s) {
        if (s == null || s.isBlank()) return Boolean.FALSE;
        return switch (s.strip().toLowerCase(Locale.ROOT)) {
            case "true", "1" -> Boolean.TRUE;
            case "false", "0" -> Boolean.FALSE;
            default -> null;
        };
    }

    static Integer parseInt(String s, int def) {
        if (s == null || s.isBlank()) return def;
        try {
            return Integer.parseInt(s.strip());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    // ── источник ArcadeDB ────────────────────────────────────────────────────

    /**
     * Источник графа поверх ArcadeDB. Ключ узла — @rid; класс вершины запоминается из
     * ответа на рёбра ({@code @out.@type}/{@code @in.@type}). Рёбра — только открытые
     * (SCD2: у ребра нет {@code valid_to}, концы не закрытые строки истории) и только между
     * классами графа ({@link #VERTICES}): ребро к строке истории, тегу, ассету — не связь
     * двух записей паспорта. Сбой чтения летит наверх (502): «не смогли прочитать» ≠ «нет».
     */
    static final class DbSource implements LoreGraphBuilder.Source {

        private final LoreIngestService ingest;
        private final Map<String, String> classOf = new HashMap<>();

        DbSource(LoreIngestService ingest) {
            this.ingest = ingest;
        }

        /** Корень: rid по ключу. Нет — 404; ключ у нескольких вершин — 409. */
        String resolve(VDef def, String id) {
            List<Map<String, Object>> rows = ingest.queryPublic(
                "SELECT @rid AS rid FROM " + def.vertexClass() + " WHERE " + def.idField() + " = :id LIMIT 2",
                Map.of("id", id));
            if (rows.isEmpty())
                throw new LoreGraphBuilder.GraphException(404, "NOT_FOUND", def.type() + " «" + id + "» не найден");
            if (rows.size() > 1)
                throw new LoreGraphBuilder.GraphException(409, "AMBIGUOUS_TARGET",
                    "ключ «" + id + "» принадлежит нескольким записям " + def.vertexClass());
            String rid = String.valueOf(rows.get(0).get("rid"));
            if (!RID.matcher(rid).matches()) throw new IllegalStateException("база вернула не rid: " + rid);
            classOf.put(rid, def.vertexClass());
            return rid;
        }

        /** Семена среза. Проект/компонент должен существовать — иначе 404, а не пустой граф. */
        List<LoreGraphBuilder.Node> seeds(LoreGraphBuilder.Scope scope) {
            String kind = scope.kind();
            String v = scope.value();
            if ("project".equals(kind) && ingest.queryPublic(
                    "SELECT slug FROM KnowGitProject WHERE slug = :v LIMIT 1", Map.of("v", v)).isEmpty())
                throw new LoreGraphBuilder.GraphException(404, "NOT_FOUND", "проект «" + v + "» не найден");
            if ("component".equals(kind) && ingest.queryPublic(
                    "SELECT component_id FROM LoreComponent WHERE component_id = :v LIMIT 1", Map.of("v", v)).isEmpty())
                throw new LoreGraphBuilder.GraphException(404, "NOT_FOUND", "компонент «" + v + "» не найден");

            List<LoreGraphBuilder.Node> out = new ArrayList<>();
            for (VDef def : VERTICES) {
                String where;
                if ("all".equals(kind)) {
                    where = "";
                } else if ("project".equals(kind)) {
                    if (def.projectPaths() == null) continue; // общий справочник — придёт кольцом
                    where = " WHERE " + anyContains(def.projectPaths());
                } else {
                    if ("LoreComponent".equals(def.vertexClass())) where = " WHERE component_id = :v";
                    else if (def.compPaths().isEmpty()) continue;
                    else where = " WHERE " + anyContains(def.compPaths());
                }
                for (Map<String, Object> r : ingest.queryPublic(select(def) + where,
                        "all".equals(kind) ? Map.of() : Map.of("v", v))) {
                    LoreGraphBuilder.Node n = toNode(def, r);
                    if (n == null) continue;
                    // Проектный срез: технология (KnowSpec SPEC-TECH-…) — общий справочник, не семя.
                    if ("project".equals(kind) && (!n.scoped() || !n.projects().contains(v))) continue;
                    out.add(n);
                }
            }
            return out;
        }

        private static String anyContains(List<String> paths) {
            List<String> parts = new ArrayList<>();
            for (String p : paths) parts.add("slug".equals(p) ? "slug = :v" : p + " CONTAINS :v");
            return "(" + String.join(" OR ", parts) + ")";
        }

        @Override
        public Map<String, LoreGraphBuilder.Node> nodes(Collection<String> keys) {
            Map<String, List<String>> byClass = new LinkedHashMap<>();
            for (String k : keys) {
                String cls = classOf.get(k);
                if (cls == null || !RID.matcher(k).matches()) continue; // класс неизвестен — узла нет
                byClass.computeIfAbsent(cls, c -> new ArrayList<>()).add(k);
            }
            Map<String, LoreGraphBuilder.Node> out = new HashMap<>();
            for (Map.Entry<String, List<String>> en : byClass.entrySet()) {
                VDef def = BY_CLASS.get(en.getKey());
                if (def == null) continue;
                List<String> rids = en.getValue();
                for (int i = 0; i < rids.size(); i += CHUNK) {
                    List<String> chunk = rids.subList(i, Math.min(rids.size(), i + CHUNK));
                    for (Map<String, Object> r : ingest.queryPublic(
                            select(def) + " WHERE @rid IN [" + String.join(", ", chunk) + "]", Map.of())) {
                        LoreGraphBuilder.Node n = toNode(def, r);
                        if (n != null) out.put(n.key(), n);
                    }
                }
            }
            return out;
        }

        @Override
        public List<LoreGraphBuilder.Edge> edges(Collection<String> keys, Set<String> excludeRels) {
            Map<String, List<String>> byClass = new LinkedHashMap<>();
            for (String k : keys) {
                String cls = classOf.get(k);
                if (cls != null && RID.matcher(k).matches()) byClass.computeIfAbsent(cls, c -> new ArrayList<>()).add(k);
            }
            // Имена рёбер — из константы кода (STRUCTURAL_RELS), не из запроса.
            String exclude = excludeRels.isEmpty() ? "" : " AND @type NOT IN ["
                + String.join(", ", excludeRels.stream().sorted().map(r -> "'" + r + "'").toList()) + "]";
            List<LoreGraphBuilder.Edge> out = new ArrayList<>();
            for (Map.Entry<String, List<String>> en : byClass.entrySet()) {
                List<String> rids = en.getValue();
                for (int i = 0; i < rids.size(); i += CHUNK) {
                    List<String> chunk = rids.subList(i, Math.min(rids.size(), i + CHUNK));
                    // rid — литералы из ответов БД (форма проверена).
                    for (Map<String, Object> r : ingest.queryPublic(
                            "SELECT @type AS rel, @out AS o, @in AS i, @out.@type AS oc, @in.@type AS ic, kind FROM "
                            + "(SELECT expand(bothE()) FROM " + en.getKey() + " WHERE @rid IN [" + String.join(", ", chunk) + "]) "
                            + "WHERE valid_to IS NULL AND @out.valid_to IS NULL AND @in.valid_to IS NULL" + exclude,
                            Map.of())) {
                        String o = String.valueOf(r.get("o"));
                        String in = String.valueOf(r.get("i"));
                        String oc = String.valueOf(r.get("oc"));
                        String ic = String.valueOf(r.get("ic"));
                        if (!RID.matcher(o).matches() || !RID.matcher(in).matches()) continue;
                        if (!BY_CLASS.containsKey(oc) || !BY_CLASS.containsKey(ic)) continue; // не запись паспорта
                        classOf.put(o, oc);
                        classOf.put(in, ic);
                        Object kind = r.get("kind");
                        out.add(new LoreGraphBuilder.Edge(o, String.valueOf(r.get("rel")), in,
                            kind == null || String.valueOf(kind).isBlank() ? null : String.valueOf(kind)));
                    }
                }
            }
            return out;
        }

        private static String select(VDef def) {
            StringBuilder sb = new StringBuilder("SELECT @rid AS rid, ").append(def.idField()).append(" AS gid, ")
                .append(def.titleExpr()).append(" AS title");
            if (def.statusExpr() != null) sb.append(", ").append(def.statusExpr()).append(" AS status");
            List<String> paths = def.projectPaths() == null ? List.of() : def.projectPaths();
            for (int i = 0; i < paths.size(); i++) sb.append(", ").append(paths.get(i)).append(" AS p").append(i);
            return sb.append(" FROM ").append(def.vertexClass()).toString();
        }

        private LoreGraphBuilder.Node toNode(VDef def, Map<String, Object> r) {
            String rid = String.valueOf(r.get("rid"));
            String id = LoreRecordValues.str(r.get("gid"));
            if (!RID.matcher(rid).matches() || id == null) return null; // без ключа узел не назвать
            classOf.put(rid, def.vertexClass());
            boolean tech = "KnowSpec".equals(def.vertexClass()) && id.startsWith(LoreRecordValues.TECH_SPEC_PREFIX);
            String type = tech ? "tech" : def.type();
            Object title = r.get("title");
            String raw = tech ? null : LoreRecordValues.str(r.get("status"));
            String status = null;
            String category = null;
            if (raw != null && def.axis() != Axis.NONE) {
                status = def.axis() == Axis.PLAN ? LoreRecordValues.planToken(raw) : LoreRecordValues.docToken(raw);
                category = LoreStatusCategory.of(def.type(), raw);
            }
            Set<String> projects = def.projectPaths() == null ? Set.of()
                : LoreSearchResource.projectsOf(r, def.projectPaths().size());
            boolean scoped = def.projectPaths() != null && !tech;
            return new LoreGraphBuilder.Node(rid, id, type, title == null ? null : String.valueOf(title),
                status, category, projects, scoped);
        }
    }
}
