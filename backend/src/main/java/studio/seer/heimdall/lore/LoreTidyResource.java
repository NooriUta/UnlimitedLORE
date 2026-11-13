package studio.seer.heimdall.lore;

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
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * SPRINT_UXR_POLISH_UAT_1113/PU-20 — раздел админки «Привести в порядок», проверка (только чтение).
 *
 * <ul>
 *   <li>{@code GET  /lore/admin/tidy} — последний результат проверки (при первом вызове — считает);</li>
 *   <li>{@code POST /lore/admin/tidy/recheck} — «Перепроверить всё»: перечитать корпус и пересчитать;</li>
 *   <li>{@code GET  /lore/admin/tidy/record?type=&id=} — «Перепроверить» одну запись: перечитать её поля,
 *       пересчитать счётчики.</li>
 * </ul>
 * Текущий текст поля — открытая SCD2-версия (*Hist, valid_to IS NULL), если она есть, иначе вершина;
 * расхождение вершины с версией помечается и автоматом не правится. Правила — {@link MdRefRules},
 * свёртка — {@link MdRefCheck}. Применение пачки и «не ссылка» — следующим шагом задачи.
 */
@Path("/lore/admin/tidy")
public class LoreTidyResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreTidyResource.class);

    /** Что читаем: вершина, поле ID, поля с вершины (сверяются с открытой версией), поля только из версии. */
    record Target(String type, String idField, List<String> fields, List<String> histFields, List<String> histOnly, boolean writable) {}

    static final List<Target> TARGETS = List.of(
        new Target("KnowTask", "task_uid", List.of("note_md"), List.of("note_md"), List.of(), true),
        new Target("KnowSprint", "sprint_id", List.of("context_md"), List.of(), List.of("outcome_md"), true),
        new Target("KnowADR", "adr_id", List.of("context_md", "decision_md", "consequences_md"),
            List.of("context_md", "decision_md", "consequences_md"), List.of(), true),
        new Target("KnowDecision", "decision_id", List.of("body_md"), List.of(), List.of(), true),
        new Target("KnowSpec", "spec_id", List.of("content_md", "summary"), List.of("content_md", "summary"), List.of(), true),
        new Target("KnowDoc", "doc_id", List.of("content_md_ru", "content_md_en"), List.of(), List.of(), true),
        new Target("KnowRelease", "release_uid", List.of("description_md"), List.of(), List.of(), true),
        new Target("KnowQuestion", "question_id", List.of("body_md"), List.of(), List.of(), true),
        new Target("KnowUseCase", "uc_id", List.of("body_md", "context_md", "scenario_md", "acceptance_md"), List.of(), List.of(), false),
        new Target("KnowMilestone", "milestone_id", List.of(), List.of(), List.of("goal_md"), false),
        new Target("KnowRunbook", "runbook_id", List.of(), List.of(), List.of("content_md"), false),
        new Target("KnowPain", "pain_id", List.of("body_md"), List.of(), List.of(), false),
        new Target("KnowGain", "gain_id", List.of("body_md", "metric_md"), List.of(), List.of(), false),
        new Target("KnowJob", "job_id", List.of("body_md"), List.of(), List.of(), false),
        new Target("KnowProjectActor", "actor_id", List.of("body_md"), List.of(), List.of(), false),
        new Target("KnowFinding", "finding_id", List.of("summary"), List.of(), List.of(), false),
        new Target("BragiInsight", "insight_id", List.of("statement_md"), List.of(), List.of(), false),
        new Target("BragiPublication", "publication_id", List.of("main_text_md"), List.of(), List.of(), false),
        new Target("BragiVariant", "variant_id", List.of("text_md"), List.of(), List.of(), false),
        new Target("QGJobTask", "job_id", List.of("note_md"), List.of(), List.of(), false),
        new Target("QGRecommendation", "rec_id", List.of("body_md"), List.of(), List.of(), false),
        new Target("PlanVersion", "version_id", List.of("changelog_md"), List.of(), List.of(), false));

    /** Тип ссылки → вершина и поля, по которым запись находится. */
    static final Map<String, List<String>> REF_IDS = Map.ofEntries(
        Map.entry("task", List.of("KnowTask", "task_uid")), Map.entry("sprint", List.of("KnowSprint", "sprint_id")),
        Map.entry("adr", List.of("KnowADR", "adr_id")), Map.entry("decision", List.of("KnowDecision", "decision_id")),
        Map.entry("spec", List.of("KnowSpec", "spec_id")), Map.entry("doc", List.of("KnowDoc", "doc_id")),
        Map.entry("runbook", List.of("KnowRunbook", "runbook_id")), Map.entry("component", List.of("LoreComponent", "component_id")),
        Map.entry("release", List.of("KnowRelease", "release_id", "release_uid", "git_tag")),
        Map.entry("uc", List.of("KnowUseCase", "uc_id")), Map.entry("feature", List.of("KnowUseCase", "uc_id")),
        Map.entry("question", List.of("KnowQuestion", "question_id")), Map.entry("pain", List.of("KnowPain", "pain_id")),
        Map.entry("gain", List.of("KnowGain", "gain_id")), Map.entry("job", List.of("KnowJob", "job_id")),
        Map.entry("actor", List.of("KnowProjectActor", "actor_id")), Map.entry("agent_actor", List.of("KnowActor", "actor_id")));

    /** Прочие ID — чтобы [[ID]] без типа узнавался как существующая запись, а не «неизвестное». */
    static final List<String[]> OTHER_IDS = List.of(new String[]{"BragiInsight", "insight_id"},
        new String[]{"BragiPublication", "publication_id"}, new String[]{"QualityGate", "qg_id"}, new String[]{"QGJobTask", "qg_id"},
        new String[]{"KnowFinding", "finding_id"}, new String[]{"KnowMilestone", "milestone_id"}, new String[]{"KnowPhase", "phase_uid"},
        new String[]{"KnowGitProject", "slug"});

    /** Последний результат: поля, контекст и ответ. Один на процесс — проверку запускает админ. */
    record Snapshot(List<MdRefCheck.Field> fields, MdRefRules.Ctx ctx, Map<MdRefCheck.RecordKey, MdRefRules.Scope> scopes,
                    Map<String, Object> answer) {}

    private static volatile Snapshot last;

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Response get(@HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        Snapshot s = last;
        if (s == null) return recheck(role);
        return noStore(Response.ok(s.answer()));
    }

    @POST
    @Path("recheck")
    @Produces(MediaType.APPLICATION_JSON)
    public synchronized Response recheck(@HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        long t0 = System.currentTimeMillis();
        try {
            MdRefRules.Ctx ctx = loadCtx();
            Map<MdRefCheck.RecordKey, MdRefRules.Scope> scopes = loadScopes();
            List<MdRefCheck.Field> fields = new ArrayList<>();
            for (Target t : TARGETS) fields.addAll(loadFields(t, null));
            Snapshot s = build(fields, ctx, scopes, t0);
            last = s;
            return noStore(Response.ok(s.answer()));
        } catch (Exception e) {
            LOG.warnf("[LORE TIDY] recheck failed: %s", e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }

    @GET
    @Path("record")
    @Produces(MediaType.APPLICATION_JSON)
    public synchronized Response recheckRecord(@QueryParam("type") String type, @QueryParam("id") String id,
                                               @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        Target t = TARGETS.stream().filter(x -> x.type().equals(type)).findFirst().orElse(null);
        if (t == null) return badParams("type: one of " + TARGETS.stream().map(Target::type).toList());
        if (id == null || id.isBlank()) return badParams("id required");
        long t0 = System.currentTimeMillis();
        try {
            Snapshot s = last;
            if (s == null) return recheck(role);
            List<MdRefCheck.Field> fields = new ArrayList<>();
            for (MdRefCheck.Field f : s.fields()) if (!(f.type().equals(type) && f.id().equals(id))) fields.add(f);
            List<MdRefCheck.Field> mine = loadFields(t, id);
            fields.addAll(mine);
            Snapshot n = build(fields, s.ctx(), s.scopes(), t0);
            last = n;
            Map<String, Object> out = new LinkedHashMap<>(n.answer());
            Map<String, Object> rec = new LinkedHashMap<>();
            rec.put("type", type);
            rec.put("id", id);
            rec.put("found", !mine.isEmpty());
            rec.put("row", rowOf(n.answer(), type, id));
            out.put("record", rec);
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE TIDY] record %s %s: %s", type, id, e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }

    @SuppressWarnings("unchecked")
    static Object rowOf(Map<String, Object> answer, String type, String id) {
        List<Map<String, Object>> rows = (List<Map<String, Object>>) ((Map<String, Object>) answer.get("manual")).get("rows");
        return rows.stream().filter(r -> type.equals(r.get("type")) && id.equals(r.get("id"))).findFirst().orElse(null);
    }

    private static Snapshot build(List<MdRefCheck.Field> fields, MdRefRules.Ctx ctx,
                                  Map<MdRefCheck.RecordKey, MdRefRules.Scope> scopes, long t0) {
        Map<String, Object> body = MdRefCheck.compute(fields, ctx, scopes, MdRefRules.defaults());
        Map<String, Object> answer = new LinkedHashMap<>();
        answer.put("ok", true);
        answer.put("checked_at", Instant.now().toString());
        answer.put("took_ms", System.currentTimeMillis() - t0);
        answer.putAll(body);
        return new Snapshot(List.copyOf(fields), ctx, scopes, answer);
    }

    // ───────────────────────────── чтение ─────────────────────────────

    private List<MdRefCheck.Field> loadFields(Target t, String onlyId) {
        StringBuilder sql = new StringBuilder("SELECT ").append(t.idField()).append(" AS id");
        if ("KnowRelease".equals(t.type())) sql.append(", release_id AS rid");
        for (String f : t.fields()) sql.append(", ").append(f).append(" AS v_").append(f);
        Set<String> hist = new HashSet<>(t.histFields());
        hist.addAll(t.histOnly());
        for (String f : hist) sql.append(", out('HAS_STATE')[valid_to IS NULL].").append(f).append("[0] AS h_").append(f);
        // Задача без открытой версии: task/edit отказывает NO_OPEN_STATE (на препроде 13.11) — не пишем автоматом.
        boolean needsOpen = "KnowTask".equals(t.type());
        if (needsOpen) sql.append(", out('HAS_STATE')[valid_to IS NULL].size() AS open_n");
        sql.append(" FROM ").append(t.type());
        Map<String, Object> params = new HashMap<>();
        if (onlyId != null) {
            sql.append(" WHERE ").append(t.idField()).append(" = :id");
            params.put("id", onlyId);
        }
        List<MdRefCheck.Field> out = new ArrayList<>();
        for (Map<String, Object> r : ingestService.queryPublic(sql.toString(), params)) {
            Object rawId = r.get("id");
            if (rawId == null && "KnowRelease".equals(t.type())) rawId = r.get("rid");
            if (rawId == null) continue;
            String id = String.valueOf(rawId);
            boolean writable = t.writable() && !(needsOpen && r.get("open_n") instanceof Number n && n.intValue() == 0);
            for (String f : t.fields()) {
                String v = textOf(r.get("v_" + f));
                String h = t.histFields().contains(f) ? textOf(r.get("h_" + f)) : null;
                String cur = h != null ? h : v;
                if (cur == null || cur.isBlank()) continue;
                boolean diverged = h != null && v != null && !h.equals(v);
                out.add(new MdRefCheck.Field(t.type(), id, f, cur, diverged, writable));
            }
            for (String f : t.histOnly()) {
                String h = textOf(r.get("h_" + f));
                if (h != null && !h.isBlank()) out.add(new MdRefCheck.Field(t.type(), id, f, h, false, writable));
            }
        }
        return out;
    }

    private static String textOf(Object o) { return o instanceof String s ? s : null; }

    private MdRefRules.Ctx loadCtx() {
        Map<String, Set<String>> ids = new HashMap<>();
        for (Map.Entry<String, List<String>> e : REF_IDS.entrySet()) {
            Set<String> s = new HashSet<>();
            String vt = e.getValue().get(0);
            for (String f : e.getValue().subList(1, e.getValue().size()))
                for (Map<String, Object> r : ingestService.queryPublic("SELECT " + f + " AS v FROM " + vt + " WHERE " + f + " IS NOT NULL", Map.of()))
                    s.add(String.valueOf(r.get("v")));
            ids.put(e.getKey(), s);
        }
        Set<String> other = new HashSet<>();
        for (String[] o : OTHER_IDS)
            for (Map<String, Object> r : ingestService.queryPublic("SELECT " + o[1] + " AS v FROM " + o[0] + " WHERE " + o[1] + " IS NOT NULL", Map.of()))
                other.add(String.valueOf(r.get("v")));
        Map<String, MdRefRules.Scope> sprints = new HashMap<>();
        Map<MdRefCheck.RecordKey, MdRefRules.Scope> sprintScopes = scopesOf("KnowSprint", "sprint_id");
        sprintScopes.forEach((k, v) -> sprints.put(k.id(), v));
        Map<String, Set<String>> taskComps = new HashMap<>();
        for (Map<String, Object> r : ingestService.queryPublic(
                "SELECT @out.task_uid AS id, @in.component_id AS c FROM TAGGED_WITH WHERE @out.@type = 'KnowTask' AND @in.@type = 'LoreComponent'", Map.of()))
            if (r.get("id") != null && r.get("c") != null) taskComps.computeIfAbsent(String.valueOf(r.get("id")), k -> new HashSet<>()).add(String.valueOf(r.get("c")));
        return new MdRefRules.Ctx(ids, other, sprints, taskComps);
    }

    /** Привязки записей: проект (BELONGS_TO_PROJECT) и компоненты (BELONGS_TO, TAGGED_WITH, DOCUMENTED_IN). */
    private Map<MdRefCheck.RecordKey, MdRefRules.Scope> loadScopes() {
        Map<MdRefCheck.RecordKey, MdRefRules.Scope> out = new HashMap<>();
        for (Target t : TARGETS) out.putAll(scopesOf(t.type(), t.idField()));
        // задача наследует привязки своего спринта
        Map<MdRefCheck.RecordKey, MdRefRules.Scope> sprints = scopesOf("KnowSprint", "sprint_id");
        for (Map<String, Object> r : ingestService.queryPublic("SELECT task_uid AS id FROM KnowTask WHERE task_uid IS NOT NULL", Map.of())) {
            String uid = String.valueOf(r.get("id"));
            int i = uid.indexOf('/');
            if (i <= 0) continue;
            MdRefRules.Scope sp = sprints.get(new MdRefCheck.RecordKey("KnowSprint", uid.substring(0, i)));
            if (sp == null) continue;
            MdRefCheck.RecordKey key = new MdRefCheck.RecordKey("KnowTask", uid);
            MdRefRules.Scope own = out.getOrDefault(key, MdRefRules.Scope.NONE);
            Set<String> p = new HashSet<>(own.projects()); p.addAll(sp.projects());
            Set<String> c = new HashSet<>(own.components()); c.addAll(sp.components());
            out.put(key, new MdRefRules.Scope(p, c));
        }
        return out;
    }

    private Map<MdRefCheck.RecordKey, MdRefRules.Scope> scopesOf(String type, String idField) {
        Map<String, Set<String>> proj = new HashMap<>(), comp = new HashMap<>();
        for (Map<String, Object> r : ingestService.queryPublic("SELECT @out." + idField + " AS id, @in.slug AS p FROM BELONGS_TO_PROJECT WHERE @out.@type = :t", Map.of("t", type)))
            if (r.get("id") != null && r.get("p") != null) proj.computeIfAbsent(String.valueOf(r.get("id")), k -> new HashSet<>()).add(String.valueOf(r.get("p")));
        for (String et : List.of("BELONGS_TO", "TAGGED_WITH"))
            for (Map<String, Object> r : ingestService.queryPublic("SELECT @out." + idField + " AS id, @in.component_id AS c FROM " + et
                    + " WHERE @out.@type = :t AND @in.@type = 'LoreComponent'", Map.of("t", type)))
                if (r.get("id") != null && r.get("c") != null) comp.computeIfAbsent(String.valueOf(r.get("id")), k -> new HashSet<>()).add(String.valueOf(r.get("c")));
        if ("KnowSpec".equals(type))
            for (Map<String, Object> r : ingestService.queryPublic("SELECT @in.spec_id AS id, @out.component_id AS c FROM DOCUMENTED_IN", Map.of()))
                if (r.get("id") != null && r.get("c") != null) comp.computeIfAbsent(String.valueOf(r.get("id")), k -> new HashSet<>()).add(String.valueOf(r.get("c")));
        Set<String> ids = new HashSet<>(proj.keySet());
        ids.addAll(comp.keySet());
        Map<MdRefCheck.RecordKey, MdRefRules.Scope> out = new HashMap<>();
        for (String id : ids)
            out.put(new MdRefCheck.RecordKey(type, id), new MdRefRules.Scope(proj.getOrDefault(id, Set.of()), comp.getOrDefault(id, Set.of())));
        return out;
    }
}
