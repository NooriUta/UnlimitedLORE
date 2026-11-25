package studio.seer.heimdall.lore;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/**
 * SPRINT_LORE_KNOW_REGISTRY/SKILL-01 + SKILL-02 + SKILL-04 · вид skill:* (SPEC-SKILLS-TAGS-062 §5–§9).
 *
 * <ul>
 *   <li>{@code POST /lore/skill} — завести или поправить скилл (upsert по {@code skill_id}). Создание — только с
 *       обоими обязательными рёбрами ({@code projects} ≥1 → BELONGS_TO_PROJECT, {@code roles} ≥1 → APPLIES_TO_ROLE),
 *       иначе 422 REFUSED со списком недостающих; новый скилл рождается {@code draft}. Смена статуса — по
 *       жизненному циклу §5: deprecated → active только владельцу (OWNED_BY), иначе 409 NOOP с подсказкой;</li>
 *   <li>{@code POST /lore/skill/link} — рёбра скилла: {@code role}, {@code project}, {@code extends} (ацикличность:
 *       цикл → 422 REFUSED с цепочкой), {@code owner} (один владелец — замена). Снятие последнего проекта/роли —
 *       422 REFUSED: висяка не оставляем;</li>
 *   <li>{@code GET /lore/skill/describe?kind=skill:*|tag:*} — карточка вида по форме SPEC-AGENT-SURFACE-061 §8
 *       ({@link SkillDescribeCards}).</li>
 * </ul>
 * Запись skill:* — только профилям full и architect (§5): матрица {@link AgentScopeFilter} (семейство
 * {@code skill}) и второй эшелон здесь же — 403 FORBIDDEN_FOR_ROLE с {@code allowed}.
 * Обратный путь MCP: {@code entity_upsert type=skill}, {@code entity_link type=skill}, {@code skill_new/skill_set/skill_link}.
 */
@Path("/lore")
public class LoreSkillResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreSkillResource.class);

    public record SkillRequest(String skill_id, String name, String title, String body_md, String version,
                               String status, String source, List<String> projects, List<String> roles,
                               String owner, List<String> extends_ids) {}

    public record SkillLinkRequest(String skill_id, String rel, String target_id, String action) {}

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> sql(String sql, Map<String, Object> params) {
        Object r = writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql, params))
            .await().indefinitely().result();
        return r instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
    }

    private static Response refuse(Response.Status status, Map<String, Object> body) {
        return noStore(Response.status(status).entity(body));
    }

    /** Второй эшелон RBAC §5 (фильтр уже отсекает на проде; здесь — dev/тесты без OIDC и прямой код ответа 061). */
    private Response forbiddenUnlessWriter() {
        String scope = callerAgentScope();
        if (scope != null && !SkillRules.WRITERS.contains(scope))
            return refuse(Response.Status.FORBIDDEN, SkillRules.forbiddenForRole(scope));
        return null;
    }

    private static List<String> clean(List<String> v) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        if (v != null) for (String s : v) if (s != null && !s.isBlank()) out.add(s.strip());
        return new ArrayList<>(out);
    }

    // ── концы рёбер: тип вершины и условие по ключу ──────────────────────────

    private static String targetSelect(String rel) {
        return switch (rel) {
            case "role" -> "SELECT FROM KnowDictEntry WHERE dict_type = 'agent_profile' AND code = :t";
            case "project" -> "SELECT FROM KnowGitProject WHERE slug = :t";
            case "extends" -> "SELECT FROM KnowSkill WHERE skill_id = :t";
            case "owner" -> "SELECT FROM KnowUser WHERE kc_sub = :t OR login = :t";
            default -> throw new IllegalArgumentException(rel);
        };
    }

    private boolean targetExists(String rel, String t) {
        return !sql(targetSelect(rel).replace("SELECT FROM", "SELECT @rid AS r FROM") + " LIMIT 1", Map.of("t", t)).isEmpty();
    }

    /** Какое значение ключа у концов рёбер rel этого скилла (для «уже есть» и подсчёта). */
    private List<String> edgeTargets(String skillId, String rel) {
        String edge = SkillRules.edgeOf(rel);
        String key = switch (rel) {
            case "role" -> "code";
            case "project" -> "slug";
            case "extends" -> "skill_id";
            default -> "kc_sub";
        };
        List<Map<String, Object>> rows = sql("SELECT out('" + edge + "')." + key + " AS v FROM KnowSkill WHERE skill_id = :id",
            Map.of("id", skillId));
        List<String> out = new ArrayList<>();
        if (!rows.isEmpty() && rows.get(0).get("v") instanceof List<?> l) for (Object o : l) if (o != null) out.add(String.valueOf(o));
        return out;
    }

    /** Конец ребра rel в форме условия по ребру ({@code @in.поле}) — для снятия через {@link #deleteEdges}. */
    private static String inCondition(String rel) {
        return switch (rel) {
            case "role" -> "@in.dict_type = 'agent_profile' AND @in.code = :t";
            case "project" -> "@in.slug = :t";
            case "extends" -> "@in.skill_id = :t";
            case "owner" -> "(@in.kc_sub = :t OR @in.login = :t)";
            default -> throw new IllegalArgumentException(rel);
        };
    }

    /** CONTENT-параметром, как LoreTagResource: именованные параметры в SET у CREATE EDGE эта сборка не принимает. */
    private void addEdge(String skillId, String rel, String t) {
        Map<String, Object> c = new LinkedHashMap<>();
        c.put("linked_at", Instant.now().toString());
        c.put("linked_by", callerLabel());
        sql("CREATE EDGE " + SkillRules.edgeOf(rel) + " FROM (SELECT FROM KnowSkill WHERE skill_id = :id) TO ("
            + targetSelect(rel) + ") CONTENT :c", Map.of("id", skillId, "t", t, "c", c));
    }

    /** Снять единственного владельца (OWNED_BY один) — по @rid, DELETE EDGE в грамматике ArcadeDB нет. */
    private void dropOwner(String skillId) {
        deleteEdges("OWNED_BY", "@out.skill_id = :id", Map.of("id", skillId));
    }

    /** Граф наследования целиком: skill_id → кого расширяет. */
    private Map<String, List<String>> extendsGraph() {
        Map<String, List<String>> g = new HashMap<>();
        for (Map<String, Object> r : sql("SELECT @out.skill_id AS f, @in.skill_id AS t FROM SKILL_EXTENDS", null))
            if (r.get("f") != null && r.get("t") != null)
                g.computeIfAbsent(String.valueOf(r.get("f")), k -> new ArrayList<>()).add(String.valueOf(r.get("t")));
        return g;
    }

    /** Первый несуществующий конец среди запрошенных рёбер — отказ ДО записи (без полузаписи и сирот). */
    private String firstMissing(Map<String, List<String>> byRel) {
        for (Map.Entry<String, List<String>> e : byRel.entrySet())
            for (String t : e.getValue())
                if (!targetExists(e.getKey(), t)) return e.getKey() + " «" + t + "»";
        return null;
    }

    @POST
    @Path("skill")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsert(SkillRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        Response rbac = forbiddenUnlessWriter();
        if (rbac != null) return rbac;
        if (req == null) return badParams("тело запроса обязательно");
        String id = SkillRules.geoid(req.skill_id());
        if (id == null) return badParams("skill_id: skill:<slug>, slug — латиница kebab-case до 63 символов");
        if (req.source() != null && !SkillRules.SOURCES.contains(req.source()))
            return badParams("source: " + SkillRules.SOURCES);
        List<String> projects = clean(req.projects()), roles = clean(req.roles()), ext = clean(req.extends_ids());
        List<String> extIds = new ArrayList<>();
        for (String e : ext) {
            String g = SkillRules.geoid(e);
            if (g == null) return badParams("extends_ids: skill:<slug> — «" + e + "»");
            extIds.add(g);
        }
        String owner = req.owner() == null || req.owner().isBlank() ? null : req.owner().strip();
        Map<String, List<String>> edges = new LinkedHashMap<>();
        edges.put("project", projects);
        edges.put("role", roles);
        edges.put("extends", extIds);
        edges.put("owner", owner == null ? List.of() : List.of(owner));
        String now = Instant.now().toString();
        try {
            List<Map<String, Object>> have = sql("SELECT status, out('OWNED_BY').kc_sub AS owner FROM KnowSkill WHERE skill_id = :id",
                Map.of("id", id));
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("skill_id", id);
            if (have.isEmpty()) {
                List<String> missing = SkillRules.missingRequiredEdges(projects, roles);
                if (!missing.isEmpty()) return refuse(Response.Status.fromStatusCode(422), SkillRules.refusedMissingEdges(missing));
                if (req.title() == null || req.title().isBlank() || req.body_md() == null || req.body_md().isBlank())
                    return badParams("title и body_md обязательны при создании скилла");
                if (req.status() != null && !"draft".equals(req.status()))
                    return refuse(Response.Status.CONFLICT, transitionError(null, req.status(),
                        "создание → draft (§5); публикация — следующим вызовом со status=active"));
                if (extIds.contains(id)) return refuse(Response.Status.fromStatusCode(422), SkillRules.refusedCycle(List.of(id, id)));
                String miss = firstMissing(edges);
                if (miss != null) return targetNotFound(miss + " не найден");
                String source = req.source() != null ? req.source() : callerAgentScope() != null ? "agent" : "human";
                sql("INSERT INTO KnowSkill SET skill_id = :id, name = :name, title = :title, body_md = :body, "
                    + "version = :ver, status = 'draft', source = :src, created_at = :now, updated_at = :now",
                    mapOfNullable("id", id, "name", req.name() != null && !req.name().isBlank() ? req.name().strip() : SkillRules.slug(id),
                        "title", req.title().strip(), "body", req.body_md(), "ver", req.version(), "src", source, "now", now));
                edges.forEach((rel, ts) -> ts.forEach(t -> addEdge(id, rel, t)));
                out.put("action", "created");
                out.put("status", "draft");
                out.put("edges", edges);
                return noStore(Response.status(Response.Status.CREATED).entity(out));
            }
            // правка существующего: поля — патчем, статус — по жизненному циклу, рёбра — добавлением
            String cur = String.valueOf(have.get(0).get("status"));
            String ownerSub = have.get(0).get("owner") instanceof List<?> l && !l.isEmpty() ? String.valueOf(l.get(0)) : null;
            String next = null;
            if (req.status() != null) {
                boolean isOwner = ownerSub != null && ownerSub.equals(callerKcSub());
                switch (SkillRules.move(cur, req.status(), isOwner)) {
                    case OK -> next = req.status();
                    case SAME -> { }
                    case NOOP_OWNER_ONLY -> { return refuse(Response.Status.CONFLICT, SkillRules.noopOwnerOnly(id, ownerSub)); }
                    case BAD_STATUS -> { return badParams("status: " + SkillRules.STATUSES); }
                    case BAD_TRANSITION -> { return refuse(Response.Status.CONFLICT, transitionError(cur, req.status(),
                        "допустимо: draft→active, draft→deprecated, active→deprecated, deprecated→active (владелец)")); }
                }
            }
            String miss = firstMissing(edges);
            if (miss != null) return targetNotFound(miss + " не найден");
            if (!extIds.isEmpty()) {
                Map<String, List<String>> g = extendsGraph();
                for (String t : extIds) {
                    List<String> cyc = SkillRules.extendsCycle(g, id, t);
                    if (cyc != null) return refuse(Response.Status.fromStatusCode(422), SkillRules.refusedCycle(cyc));
                }
            }
            List<String> sets = new ArrayList<>();
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("id", id);
            if (req.name() != null && !req.name().isBlank()) { sets.add("name = :name"); p.put("name", req.name().strip()); }
            if (req.title() != null && !req.title().isBlank()) { sets.add("title = :title"); p.put("title", req.title().strip()); }
            if (req.body_md() != null && !req.body_md().isBlank()) { sets.add("body_md = :body"); p.put("body", req.body_md()); }
            if (req.version() != null) { sets.add("version = :ver"); p.put("ver", req.version()); }
            if (req.source() != null) { sets.add("source = :src"); p.put("src", req.source()); }
            if (next != null) { sets.add("status = :st"); p.put("st", next); }
            int added = 0;
            for (Map.Entry<String, List<String>> e : edges.entrySet()) {
                if (e.getValue().isEmpty()) continue;
                if ("owner".equals(e.getKey())) {
                    dropOwner(id);
                    addEdge(id, "owner", e.getValue().get(0));
                    added++;
                    continue;
                }
                List<String> already = edgeTargets(id, e.getKey());
                for (String t : e.getValue()) if (!already.contains(t)) { addEdge(id, e.getKey(), t); added++; }
            }
            if (!sets.isEmpty() || added > 0) {
                sets.add("updated_at = :now");
                p.put("now", now);
                // промах UPDATE по ключу (скилл снесли между чтением и записью) — 404, а не ok:true
                if (WriteCount.missed(sql("UPDATE KnowSkill SET " + String.join(", ", sets) + " WHERE skill_id = :id", p)))
                    return WriteCount.notFound("skill", id, "правка скилла");
            }
            out.put("action", sets.isEmpty() && added == 0 ? "unchanged" : "updated");
            out.put("status", next != null ? next : cur);
            out.put("edges_added", added);
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE SKILL] %s: %s", id, e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }

    private static Map<String, Object> transitionError(String from, String to, String hint) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("error", "BAD_TRANSITION");
        m.put("detail", (from == null ? "создание" : from) + " → " + to + " не по жизненному циклу скилла");
        m.put("allowed", SkillRules.STATUSES);
        m.put("hint", hint);
        return m;
    }

    @POST
    @Path("skill/link")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response link(SkillLinkRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        Response rbac = forbiddenUnlessWriter();
        if (rbac != null) return rbac;
        if (req == null || req.rel() == null || req.target_id() == null || req.target_id().isBlank())
            return badParams("skill_id, rel и target_id обязательны");
        String id = SkillRules.geoid(req.skill_id());
        if (id == null) return badParams("skill_id: skill:<slug>");
        String rel = req.rel();
        if (SkillRules.edgeOf(rel) == null) return badParams("rel: role | project | extends | owner");
        String action = req.action() == null ? "add" : req.action().toLowerCase(java.util.Locale.ROOT);
        if (!action.equals("add") && !action.equals("remove")) return badParams("action: add | remove");
        String t = req.target_id().strip();
        if ("extends".equals(rel)) {
            t = SkillRules.geoid(t);
            if (t == null) return badParams("target_id для rel=extends: skill:<slug>");
        }
        try {
            if (!exists("KnowSkill", "skill_id", id)) return targetNotFound("скилл " + id + " не найден");
            Map<String, Object> base = new LinkedHashMap<>();
            base.put("ok", true);
            base.put("skill_id", id);
            base.put("rel", rel);
            base.put("target_id", t);
            String edge = SkillRules.edgeOf(rel);
            List<String> have = edgeTargets(id, rel);
            if (action.equals("remove")) {
                if (!have.contains(t) && !"owner".equals(rel)) return unlinkOutcome(base, false);
                if (SkillRules.removalLeavesDangling(rel, have.size()))
                    return refuse(Response.Status.fromStatusCode(422), SkillRules.refusedDangling(id, rel));
                int n = deleteEdges(edge, "@out.skill_id = :id AND " + inCondition(rel), Map.of("id", id, "t", t));
                if (n > 0) touchUpdatedAt("KnowSkill", "skill_id", id);
                return unlinkOutcome(base, n > 0);
            }
            if (!targetExists(rel, t)) return targetNotFound(rel + " «" + t + "» не найден");
            if ("extends".equals(rel)) {
                List<String> cyc = SkillRules.extendsCycle(extendsGraph(), id, t);
                if (cyc != null) return refuse(Response.Status.fromStatusCode(422), SkillRules.refusedCycle(cyc));
            }
            if ("owner".equals(rel)) {
                // владелец один: прежнее ребро снимается
                dropOwner(id);
            } else if (have.contains(t)) {
                base.put("action", "unchanged");
                return noStore(Response.ok(base));
            }
            addEdge(id, rel, t);
            touchUpdatedAt("KnowSkill", "skill_id", id);
            base.put("action", "added");
            return noStore(Response.ok(base));
        } catch (Exception e) {
            LOG.warnf("[LORE SKILL LINK] %s %s %s: %s", id, rel, t, e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }

    @GET
    @Path("skill/describe")
    @Produces(MediaType.APPLICATION_JSON)
    public Response describe(@QueryParam("kind") String kind) {
        if (!enabled) return disabled();
        Map<String, Object> card = SkillDescribeCards.card(kind);
        if (card == null) return badParams("kind: " + SkillDescribeCards.KINDS);
        return noStore(Response.ok(card));
    }
}
