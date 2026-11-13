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
            Snapshot s = build(fields, ctx, scopes, t0, loadDismissed());
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
            Snapshot n = build(fields, s.ctx(), s.scopes(), t0, loadDismissed());
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
                                  Map<MdRefCheck.RecordKey, MdRefRules.Scope> scopes, long t0, Set<String> dismissed) {
        Map<String, Object> body = MdRefCheck.compute(fields, ctx, scopes, MdRefRules.defaults(), dismissed);
        Map<String, Object> answer = new LinkedHashMap<>();
        answer.put("ok", true);
        answer.put("checked_at", Instant.now().toString());
        answer.put("took_ms", System.currentTimeMillis() - t0);
        answer.putAll(body);
        return new Snapshot(List.copyOf(fields), ctx, scopes, answer);
    }

    // ───────────────────────────── применение ─────────────────────────────

    /** Тело применения: правила (пусто — умолчания), пробный прогон, логин для подтверждения, отмена пачки. */
    public record ApplyRequest(List<String> rules, Boolean dry_run, String confirm_login, String undo_of) {}

    @jakarta.inject.Inject LoreSprintTaskResource tasks;
    @jakarta.inject.Inject LoreReleaseResource releases;
    @jakarta.inject.Inject LoreQuestionResource questions;
    @jakarta.inject.Inject LoreDecisionResource decisions;
    @jakarta.inject.Inject LoreSpecResource specs;
    @jakarta.inject.Inject LoreDocResource docs;
    @jakarta.inject.Inject LoreAdrResource adrs;

    private static final com.fasterxml.jackson.databind.ObjectMapper JSON = new com.fasterxml.jackson.databind.ObjectMapper()
        .configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    /**
     * Применить автопочинку пачкой. Решения владелицы 13.11.2026: прод правит только бэкенд с подтверждением
     * в UI логином человека; применяет суперадмин-человек (агент — никогда); отмена — 15 минут.
     * {@code dry_run} — план без записи (для диффа). Иначе: сервер перечитывает тексты, пишет каждое поле
     * штатным методом ресурса (новая SCD2-версия, автор — вызывающий), и отвечает итогом по каждому полю —
     * пачка не атомарна. В ответе {@code batch_id} — первым полем: журнал действий пишет его сущностью вызова.
     */
    @POST
    @Path("apply")
    @jakarta.ws.rs.Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public synchronized Response apply(ApplyRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireSuperAdmin(role);
        if (req == null) return badParams("body required");
        String unknown = MdRefApply.unknownRule(req.rules());
        if (unknown != null) return badParams("unknown rule '" + unknown + "' — one of " + MdRefRules.RULES);
        boolean dry = Boolean.TRUE.equals(req.dry_run());
        String human = humanLogin();
        if (!dry) {
            if (human == null) return forbiddenHuman();
            if (req.confirm_login() == null || !req.confirm_login().strip().equals(human))
                return badParams("confirm_login: введите свой логин (" + human + "), чтобы подтвердить пачку");
        }
        Instant now = Instant.now();
        try {
            if (req.undo_of() != null) return undo(req.undo_of(), dry, now, role);
            MdRefRules.Ctx ctx = loadCtx();
            Map<MdRefCheck.RecordKey, MdRefRules.Scope> scopes = loadScopes();
            List<MdRefCheck.Field> fields = new ArrayList<>();
            for (Target t : TARGETS) if (t.writable()) fields.addAll(loadFields(t, null));
            Set<String> rules = MdRefApply.rulesOf(req.rules());
            List<MdRefApply.Edit> plan = MdRefApply.plan(fields, ctx, scopes, rules);
            Map<String, Object> out = new LinkedHashMap<>();
            if (!dry) out.put("batch_id", MdRefApply.batchId(now));
            out.put("ok", true);
            out.put("dry_run", dry);
            // Слово подтверждения — логин из токена: окно спрашивает ровно то, что сервер сверит.
            // null — вызывающий не человек (агент) или входа нет: применить нельзя, окно говорит это словами.
            out.put("login", human);
            out.put("rules", rules);
            out.put("records", plan.stream().map(e -> e.type() + "|" + e.id()).distinct().count());
            out.put("fields", plan.size());
            out.put("edits", plan.stream().mapToInt(MdRefApply.Edit::places).sum());
            out.put("diff", diffRows(plan, 40));
            if (dry) return noStore(Response.ok(out));
            List<Map<String, Object>> items = new ArrayList<>();
            List<MdRefApply.Edit> done = new ArrayList<>();
            int applied = 0, failed = 0;
            for (MdRefApply.Edit e : plan) {
                Response r = write(e, e.before(), e.after(), role);
                if (r.getStatus() < 300) { applied++; done.add(e); } else failed++;
                items.add(item(e, r));
            }
            String batchId = String.valueOf(out.get("batch_id"));
            MdRefApply.remember(batchId, done, now);
            out.put("applied", applied);
            out.put("failed", failed);
            out.put("atomic", false);
            out.put("items", items);
            out.put("undo_until", now.plus(MdRefApply.UNDO_WINDOW).toString());
            out.put("by", human);
            last = null;   // результат проверки устарел — следующий GET перечитает
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE TIDY] apply failed: %s", e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }

    private Response undo(String batchId, boolean dry, Instant now, String role) {
        List<MdRefApply.Edit> edits = MdRefApply.batch(batchId);
        String err = MdRefApply.undoError(batchId, now, edits != null);
        if (err != null) return badParams(err);
        Map<String, Object> out = new LinkedHashMap<>();
        if (!dry) out.put("batch_id", MdRefApply.batchId(now));
        out.put("ok", true);
        out.put("undo_of", batchId);
        out.put("dry_run", dry);
        List<Map<String, Object>> items = new ArrayList<>();
        int restored = 0, skipped = 0, failed = 0;
        for (MdRefApply.Edit e : edits) {
            Map<String, Object> it = new LinkedHashMap<>();
            it.put("type", e.type()); it.put("id", e.id()); it.put("field", e.field());
            if (!MdRefApply.undoable(e, currentText(e))) { it.put("result", "changed_after"); skipped++; items.add(it); continue; }
            if (dry) { it.put("result", "would_restore"); items.add(it); continue; }
            Response r = write(e, e.after(), e.before(), role);
            it.put("status", r.getStatus());
            if (r.getStatus() < 300) { it.put("result", "restored"); restored++; }
            else { it.put("result", "failed"); it.put("error", r.getEntity()); failed++; }
            items.add(it);
        }
        if (!dry) MdRefApply.forget(batchId);
        out.put("restored", restored);
        out.put("changed_after", skipped);
        out.put("failed", failed);
        out.put("items", items);
        last = null;
        return noStore(Response.ok(out));
    }

    private static List<Map<String, Object>> diffRows(List<MdRefApply.Edit> plan, int max) {
        List<Map<String, Object>> rows = new ArrayList<>();
        for (MdRefApply.Edit e : plan.subList(0, Math.min(max, plan.size()))) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("type", e.type()); m.put("id", e.id()); m.put("field", e.field());
            m.put("rules", e.rules()); m.put("places", e.places());
            m.put("before", e.before()); m.put("after", e.after());
            rows.add(m);
        }
        return rows;
    }

    private static Map<String, Object> item(MdRefApply.Edit e, Response r) {
        Map<String, Object> it = new LinkedHashMap<>();
        it.put("type", e.type()); it.put("id", e.id()); it.put("field", e.field());
        it.put("status", r.getStatus());
        it.put("result", r.getStatus() < 300 ? "applied" : "failed");
        if (r.getStatus() >= 300) it.put("error", r.getEntity());
        return it;
    }

    private String currentText(MdRefApply.Edit e) {
        Target t = TARGETS.stream().filter(x -> x.type().equals(e.type())).findFirst().orElseThrow();
        return loadFields(t, e.id()).stream().filter(f -> f.field().equals(e.field())).map(MdRefCheck.Field::text).findFirst().orElse(null);
    }

    /**
     * Запись поля штатным методом ресурса — те же проверки, SCD2 и автор, что у правки руками.
     * {@code expected} — текст, который должен лежать сейчас: у задачи сервер сверяет его сам
     * (expected.note_md, S2-09), у остальных — перечитываем перед записью.
     */
    Response write(MdRefApply.Edit e, String expected, String text, String role) {
        if (!"KnowTask".equals(e.type())) {
            String cur = currentText(e);
            if (cur == null || !cur.equals(expected))
                return Response.status(Response.Status.CONFLICT).entity(new LoreError("CONFLICT", "текст менялся после проверки")).build();
        }
        Map<String, Object> body = new LinkedHashMap<>();
        switch (e.type()) {
            case "KnowTask" -> {
                body.put("task_uid", e.id());
                body.put("title", currentValue("KnowTask", "task_uid", e.id(), "title"));
                body.put("note_md", text);
                body.put("expected", Map.of("note_md", expected));
                return tasks.editTask(JSON.convertValue(body, LoreSprintTaskResource.TaskEditRequest.class), role).await().indefinitely();
            }
            case "KnowSprint" -> {
                body.put("sprint_id", e.id());
                body.put(e.field(), text);
                return tasks.updateSprint(JSON.convertValue(body, LoreSprintTaskResource.SprintUpdateRequest.class), role);
            }
            case "KnowRelease" -> {
                int i = e.id().indexOf('#');
                if (i <= 0) return Response.status(Response.Status.BAD_REQUEST).entity(new LoreError("BAD_PARAMS", "у релиза нет проекта в release_uid")).build();
                body.put("release_id", e.id().substring(i + 1));
                body.put("git_project", e.id().substring(0, i));
                body.put("description_md", text);
                return releases.updateRelease(JSON.convertValue(body, LoreReleaseResource.ReleaseUpdateRequest.class), role);
            }
            case "KnowQuestion" -> {
                body.put("question_id", e.id());
                body.put("body_md", text);
                return questions.createQuestion(JSON.convertValue(body, LoreQuestionResource.QuestionCreateRequest.class), role);
            }
            case "KnowDecision" -> {
                body.put("decision_id", e.id());
                body.put("title", currentValue("KnowDecision", "decision_id", e.id(), "title"));   // обязателен у метода
                body.put("body_md", text);
                return decisions.createDecision(JSON.convertValue(body, LoreDecisionResource.DecisionCreateRequest.class), role);
            }
            case "KnowSpec" -> {
                body.put("spec_id", e.id());
                body.put(e.field(), text);
                return specs.upsertSpec(JSON.convertValue(body, LoreSpecResource.SpecUpsertRequest.class), role);
            }
            case "KnowDoc" -> {
                body.put("doc_id", e.id());
                body.put(e.field(), text);
                return docs.upsertDoc(JSON.convertValue(body, LoreDocResource.DocUpsertRequest.class), role);
            }
            case "KnowADR" -> {
                body.put("adr_id", e.id());
                // createAdr пишет name всегда (SET name=:name) — без текущего имени обнулил бы его.
                body.put("name", currentValue("KnowADR", "adr_id", e.id(), "name"));
                body.put(e.field(), text);
                return adrs.createAdr(JSON.convertValue(body, LoreAdrResource.AdrCreateRequest.class), role);
            }
            default -> {
                return Response.status(Response.Status.BAD_REQUEST).entity(new LoreError("BAD_PARAMS", "тип " + e.type() + " автоматически не пишется")).build();
            }
        }
    }

    private Object currentValue(String type, String idField, String id, String field) {
        List<Map<String, Object>> r = ingestService.queryPublic(
            "SELECT " + field + " AS v FROM " + type + " WHERE " + idField + " = :id LIMIT 1", Map.of("id", id));
        return r.isEmpty() ? null : r.get(0).get("v");
    }

    /** Логин человека из проверенного токена; null — не человек (агент) или токена нет. */
    String humanLogin() {
        if (callerClientId() != null || callerKcSub() == null) return null;
        if (identity == null || !(identity.getPrincipal() instanceof org.eclipse.microprofile.jwt.JsonWebToken jwt)) return null;
        Object u = jwt.getClaim("preferred_username");
        return u == null || String.valueOf(u).isBlank() ? null : String.valueOf(u);
    }

    private Response forbiddenHuman() {
        return noStore(Response.status(Response.Status.FORBIDDEN).entity(new LoreError("HUMAN_ONLY",
            "Пачку применяет только человек под своим логином (решение владелицы 13.11.2026); агенту и запросу без входа — нельзя.")));
    }

    // ───────────────────────────── «не ссылка» ─────────────────────────────

    public record DismissRequest(String type, String id, String kind, String action) {}

    /** Отметить вид мест записи «не ссылка» (или снять отметку). Текст не меняется. */
    @POST
    @Path("dismiss")
    @jakarta.ws.rs.Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public synchronized Response dismiss(DismissRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.type() == null || req.id() == null || req.kind() == null) return badParams("type, id, kind required");
        if (TARGETS.stream().noneMatch(t -> t.type().equals(req.type()))) return badParams("unknown type " + req.type());
        if (!MdRefDismissals.KINDS.contains(req.kind())) return badParams("kind: one of " + MdRefDismissals.KINDS);
        boolean remove = "remove".equals(req.action());
        String key = MdRefDismissals.key(req.type(), req.id(), req.kind());
        try {
            if (remove) {
                command("DELETE FROM " + MdRefDismissals.TYPE + " WHERE dismissal_key = :k", Map.of("k", key));
            } else {
                command("UPDATE " + MdRefDismissals.TYPE + " SET dismissal_key = :k, record_type = :t, record_id = :i, kind = :kind,"
                    + " created_by = :by, created_at = :at UPSERT WHERE dismissal_key = :k",
                    Map.of("k", key, "t", req.type(), "i", req.id(), "kind", req.kind(), "by", callerLabel(), "at", Instant.now().toString()));
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("dismissal_key", key);
            out.put("action", remove ? "remove" : "add");
            Snapshot s = last;
            if (s != null) {
                Snapshot n = build(s.fields(), s.ctx(), s.scopes(), System.currentTimeMillis(), loadDismissed());
                last = n;
                out.putAll(n.answer());
            }
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE TIDY] dismiss %s: %s", key, e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }

    /** Запись в базу — тем же клиентом команд, что у других хранилищ (LoreNewsReadMarkStore): /query пишет не всё. */
    private void command(String sql, Map<String, Object> params) {
        writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql, params)).await().indefinitely();
    }

    private Set<String> loadDismissed() {
        Set<String> out = new HashSet<>();
        try {
            for (Map<String, Object> r : ingestService.queryPublic("SELECT dismissal_key AS k FROM " + MdRefDismissals.TYPE, Map.of()))
                if (r.get("k") != null) out.add(String.valueOf(r.get("k")));
        } catch (Exception e) {
            // До накатки V83 типа нет — отметок нет; это не «не смогли проверить» весь корпус.
            LOG.debugf("[LORE TIDY] dismissals unavailable: %s", e.getMessage());
        }
        return out;
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
                // Только в версии (outcome_md спринта, цель вехи, тело runbook): путь записи пишет вершину,
                // а версия остаётся прежней (препрод 13.11) — автоматом не пишем, человеку показываем.
                if (h != null && !h.isBlank()) out.add(new MdRefCheck.Field(t.type(), id, f, h, false, false));
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
