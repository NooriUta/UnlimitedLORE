package studio.seer.heimdall.lore;

import io.smallrye.mutiny.Uni;
import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;
import studio.seer.heimdall.bench.MartClient;
import studio.seer.heimdall.bench.MartQuery;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Read-only viewer API over the system_aida_lore engineering knowledge base.
 *
 * GET /lore/slices          → available named slices with their params
 * GET /lore/slice/{id}      → {"rows": [...]} for a named slice (+query params)
 *
 * Disabled by default (lore.enabled=false) → 404 LORE_DISABLED.
 * Pattern: BenchMartResource.
 */
@Path("/lore")
public class AidaLoreResource {

    private static final Logger LOG = Logger.getLogger(AidaLoreResource.class);

    public record LoreError(String error, String detail) {}
    public record SliceInfo(String id, List<String> required, List<String> optional) {}

    // ── write-path records ────────────────────────────────────────────────────
    public record StatusUpdateRequest(String entity_type, String id, String status) {}
    record StatusRevision(String valid_from, String plan_version) {}
    public record StatusUpdateResponse(
        boolean ok, String entity_type, String id,
        String old_status, String new_status, StatusRevision revision) {}
    public record SprintRefsRequest(String sprint_id, List<Integer> pr_numbers,
        String git_project, String repo_url) {}
    public record SprintUpdateRequest(String sprint_id, String name, String outcome_md,
        String context_md, String priority, String plan_id, Integer effort_days) {}
    public record BatchStatusRequest(String entity_type, List<String> ids, String status) {}
    public record AdrCreateRequest(String adr_id, String name, String status, String date_created,
        String component_id, String context_md, String decision_md, String consequences_md,
        List<String> depends_on_ids, List<String> supersedes_ids,
        List<String> component_ids, List<String> tags) {}
    public record DecisionCreateRequest(String decision_id, String title, String body_md,
        String date_created, String refs_raw) {}
    public record TaskCreateRequest(String sprint_id, String task_id, String title, String note_md) {}
    public record TaskEditRequest(String task_uid, String title, String note_md) {}
    public record TaskWriteResponse(boolean ok, String task_uid, String task_id, Integer order_index) {}

    // task_uid carries a '/' (e.g. SPRINT_X/SH-1); all values are bound as SQL params, never concatenated.
    private static final Pattern SAFE_ID = Pattern.compile("[A-Za-z0-9_./\\-]{1,100}");
    private static final Set<String> ENTITY_TYPES =
        Set.of("plan_item", "sprint", "task", "checkpoint", "adr");
    private static final Set<String> PLAN_STATUSES =
        Set.of("todo", "active", "partial", "done", "blocked", "high", "cancelled",
               "planned", "backlog", "design", "ready_for_deploy");
    private static final Set<String> ADR_STATUSES =
        Set.of("proposed", "accepted", "draft", "deferred", "superseded");

    // Canonical status token → status_raw string written on KnowSprintHist / KnowTaskHist.
    // Mirrors the leading-marker convention the frontend normalizer (LoreSprintDetail) reads back.
    // 🟡 PARTIAL is a distinct status from 🔄 IN PROGRESS — see lore-status.ts taskTick.
    private static final Map<String, String> SCD2_STATUS_RAW = Map.ofEntries(
        Map.entry("done",             "✅ DONE"),
        Map.entry("active",           "🔄 IN PROGRESS"),
        Map.entry("partial",          "🟡 PARTIAL"),
        Map.entry("todo",             "⬜ TODO"),
        Map.entry("planned",          "📋 PLANNED"),
        Map.entry("blocked",          "🔴 BLOCKED"),
        Map.entry("high",             "🔴 P0"),
        Map.entry("cancelled",        "🚫 CANCELLED"),
        Map.entry("ready_for_deploy", "🚀 READY FOR DEPLOY"),
        Map.entry("backlog",          "🟣 BACKLOG"),
        Map.entry("design",           "🔬 DESIGN"));

    @ConfigProperty(name = "lore.enabled", defaultValue = "false")
    boolean enabled;

    @ConfigProperty(name = "lore.db", defaultValue = "system_aida_lore")
    String db;

    @ConfigProperty(name = "bench.mart.user", defaultValue = "root")
    String user;

    @ConfigProperty(name = "bench.mart.password", defaultValue = "")
    String password;

    @Inject
    @RestClient
    MartClient client;

    @Inject
    @RestClient
    LoreCommandClient writeClient;

    @Inject
    LoreIngestService ingestService;

    @GET
    @Path("slices")
    @Produces(MediaType.APPLICATION_JSON)
    public Response slices() {
        if (!enabled) return disabled();
        List<SliceInfo> infos = LoreSlices.ids().stream()
            .map(id -> {
                LoreSlices.SliceDef def = LoreSlices.get(id);
                return new SliceInfo(id, def.required(), List.copyOf(def.optionalFilters().keySet()));
            })
            .toList();
        return noStore(Response.ok(Map.of("slices", infos)));
    }

    @GET
    @Path("slice/{id}")
    @Produces(MediaType.APPLICATION_JSON)
    public Uni<Response> slice(@PathParam("id") String id, @Context UriInfo uriInfo) {
        if (!enabled) return Uni.createFrom().item(disabled());
        if (LoreSlices.get(id) == null) {
            return Uni.createFrom().item(noStore(Response.status(Response.Status.NOT_FOUND)
                .entity(new LoreError("UNKNOWN_SLICE", id))));
        }

        Map<String, String> given = new LinkedHashMap<>();
        uriInfo.getQueryParameters().forEach((k, v) -> {
            if (v != null && !v.isEmpty()) given.put(k, v.get(0));
        });

        LoreSlices.Composed composed;
        try {
            composed = LoreSlices.compose(id, given);
        } catch (IllegalArgumentException e) {
            return Uni.createFrom().item(noStore(Response.status(Response.Status.BAD_REQUEST)
                .entity(new LoreError("BAD_PARAMS", e.getMessage()))));
        }

        MartQuery body = new MartQuery("sql", composed.sql(),
            composed.params().isEmpty() ? null : composed.params(), -1);
        LOG.debugf("[LORE:%s] %s %s", db, id, composed.params());

        return client.query(db, basicAuth(), body)
            .map(res -> noStore(Response.ok(Map.of("rows",
                res.result() == null ? List.of() : res.result()))))
            .onFailure().recoverWithItem(ex -> {
                LOG.warnf("[LORE FAILED] slice=%s: %s", id, ex.getMessage());
                return noStore(Response.status(Response.Status.BAD_GATEWAY)
                    .entity(new LoreError("LORE_UPSTREAM", String.valueOf(ex.getMessage()))));
            });
    }

    // ── Write-path: status update (SCD2) ────────────────────────────────────

    @POST
    @Path("status")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Uni<Response> updateStatus(StatusUpdateRequest req,
                                      @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return Uni.createFrom().item(disabled());
        if (!"admin".equals(role) && !"superadmin".equals(role)) {
            return Uni.createFrom().item(noStore(Response.status(Response.Status.FORBIDDEN)
                .entity(new LoreError("FORBIDDEN", "admin role required"))));
        }
        if (req == null || req.entity_type() == null || req.id() == null || req.status() == null) {
            return Uni.createFrom().item(noStore(Response.status(Response.Status.BAD_REQUEST)
                .entity(new LoreError("BAD_PARAMS", "entity_type, id, status required"))));
        }
        if (!ENTITY_TYPES.contains(req.entity_type())) {
            return Uni.createFrom().item(noStore(Response.status(Response.Status.BAD_REQUEST)
                .entity(new LoreError("BAD_PARAMS", "entity_type must be one of: " + ENTITY_TYPES))));
        }
        if (!SAFE_ID.matcher(req.id()).matches()) {
            return Uni.createFrom().item(noStore(Response.status(Response.Status.BAD_REQUEST)
                .entity(new LoreError("BAD_PARAMS", "id contains illegal characters"))));
        }
        if ("adr".equals(req.entity_type())) {
            if (!ADR_STATUSES.contains(req.status().toLowerCase())) {
                return Uni.createFrom().item(noStore(Response.status(Response.Status.BAD_REQUEST)
                    .entity(new LoreError("BAD_PARAMS", "adr status must be one of: " + ADR_STATUSES))));
            }
        } else if (!PLAN_STATUSES.contains(req.status())) {
            return Uni.createFrom().item(noStore(Response.status(Response.Status.BAD_REQUEST)
                .entity(new LoreError("BAD_PARAMS", "unknown status: " + req.status()))));
        }
        String now  = Instant.now().toString();
        String nsid = UUID.randomUUID().toString();
        return switch (req.entity_type()) {
            case "plan_item" -> updatePlanItemStatus(req.id(), req.status(), now, nsid);
            case "sprint"    -> updateScd2Status("sprint", "KnowSprint", "KnowSprintHist",
                                    "sprint_id", req.id(), req.status(), now, nsid);
            case "task"      -> updateScd2Status("task", "KnowTask", "KnowTaskHist",
                                    "task_uid", req.id(), req.status(), now, nsid);
            case "adr"       -> updateAdrStatusDirect(req.id(), req.status().toUpperCase(), now);
            default          -> Uni.createFrom().item(noStore(Response.status(501)
                                    .entity(new LoreError("NOT_IMPLEMENTED",
                                        req.entity_type() + " not supported yet"))));
        };
    }

    /**
     * SCD2 status flip for KnowSprint / KnowTask:
     *   1. close the current open state row (valid_to = now)
     *   2. insert a new {@code <histType>} state row (valid_from = now, status_raw = mapped)
     *   3. link it: CREATE EDGE HAS_STATE entity → new state
     *   4. denormalise the current status_raw onto the entity vertex
     * Entities with no open state row (some backfilled tasks) skip step 1.
     */
    private Uni<Response> updateScd2Status(String entityType, String vertexType, String histType,
                                           String keyField, String id, String token,
                                           String now, String nsid) {
        final String newRaw = SCD2_STATUS_RAW.getOrDefault(token, token);
        MartQuery readQ = new MartQuery("sql",
            "SELECT @rid AS rid, status_raw FROM " + histType +
            " WHERE in('HAS_STATE')." + keyField + " CONTAINS :id AND valid_to IS NULL LIMIT 1",
            Map.of("id", id), -1);

        return client.query(db, basicAuth(), readQ)
            .chain(res -> {
                List<Map<String, Object>> rows =
                    res.result() != null ? res.result() : List.of();
                final String oldRid    = rows.isEmpty() ? null
                    : String.valueOf(rows.get(0).getOrDefault("rid", ""));
                final String oldStatus = rows.isEmpty() ? null
                    : (String) rows.get(0).get("status_raw");

                Uni<LoreCommandClient.LoreCommandResult> closeOld =
                    (oldRid != null && oldRid.startsWith("#"))
                        ? writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                            "UPDATE " + histType + " SET valid_to = :now WHERE @rid = :rid",
                            Map.of("now", now, "rid", oldRid)))
                        : Uni.createFrom().item(new LoreCommandClient.LoreCommandResult(null));

                return closeOld
                    .chain(__ -> writeClient.command(db, basicAuth(),
                        new LoreCommandClient.LoreCommand("sql",
                            "INSERT INTO " + histType +
                            " SET state_uid = :nsid, status_raw = :ns, valid_from = :now",
                            Map.of("nsid", nsid, "ns", newRaw, "now", now))))
                    .chain(__ -> writeClient.command(db, basicAuth(),
                        new LoreCommandClient.LoreCommand("sql",
                            "CREATE EDGE HAS_STATE " +
                            "FROM (SELECT FROM " + vertexType + " WHERE " + keyField + " = :id) " +
                            "TO (SELECT FROM " + histType + " WHERE state_uid = :nsid)",
                            Map.of("id", id, "nsid", nsid))))
                    .chain(__ -> writeClient.command(db, basicAuth(),
                        new LoreCommandClient.LoreCommand("sql",
                            "UPDATE " + vertexType + " SET status_raw = :ns WHERE " + keyField + " = :id",
                            Map.of("ns", newRaw, "id", id))))
                    .map(__ -> noStore(Response.ok(new StatusUpdateResponse(
                        true, entityType, id, oldStatus, newRaw,
                        new StatusRevision(now, null)))));
            })
            .onFailure().recoverWithItem(ex -> {
                LOG.warnf("[LORE STATUS] %s=%s: %s", entityType, id, ex.getMessage());
                return noStore(Response.status(Response.Status.BAD_GATEWAY)
                    .entity(new LoreError("LORE_UPSTREAM", ex.getMessage())));
            });
    }

    // LH-44: direct status setter for KnowADR (no SCD2 hist row — status is a plain field)
    private Uni<Response> updateAdrStatusDirect(String adrId, String status, String now) {
        return writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE KnowADR SET status=:status WHERE adr_id=:id",
                Map.of("status", status, "id", adrId)))
            .map(__ -> noStore(Response.ok(new StatusUpdateResponse(
                true, "adr", adrId, null, status, new StatusRevision(now, null)))))
            .onFailure().recoverWithItem(ex ->
                noStore(Response.status(Response.Status.BAD_GATEWAY)
                    .entity(new LoreError("LORE_UPSTREAM", ex.getMessage()))));
    }

    private Uni<Response> updatePlanItemStatus(String itemId, String newStatus,
                                                String now, String nsid) {
        MartQuery readQ = new MartQuery("sql",
            "SELECT status_id, status FROM StatusPlanItem " +
            "WHERE in('HAS_STATUS').item_id[0] = :id AND valid_to IS NULL LIMIT 1",
            Map.of("id", itemId), -1);

        return client.query(db, basicAuth(), readQ)
            .chain(res -> {
                List<Map<String, Object>> rows =
                    res.result() != null ? res.result() : List.of();
                final String oldSoid   = rows.isEmpty() ? null
                    : String.valueOf(rows.get(0).getOrDefault("status_id", ""));
                final String oldStatus = rows.isEmpty() ? null
                    : (String) rows.get(0).get("status");

                Uni<LoreCommandClient.LoreCommandResult> step2 =
                    (oldSoid != null && !oldSoid.isEmpty())
                        ? writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                            "UPDATE StatusPlanItem SET valid_to = :now WHERE status_id = :soid",
                            Map.of("now", now, "soid", oldSoid)))
                        : Uni.createFrom().item(new LoreCommandClient.LoreCommandResult(null));

                return step2
                    .chain(__ -> writeClient.command(db, basicAuth(),
                        new LoreCommandClient.LoreCommand("sql",
                            "INSERT INTO StatusPlanItem " +
                            "SET status_id = :nsid, status = :nstatus, valid_from = :now",
                            Map.of("nsid", nsid, "nstatus", newStatus, "now", now))))
                    .chain(__ -> writeClient.command(db, basicAuth(),
                        new LoreCommandClient.LoreCommand("sql",
                            "CREATE EDGE HAS_STATUS " +
                            "FROM (SELECT FROM PlanItem WHERE item_id = :id) " +
                            "TO (SELECT FROM StatusPlanItem WHERE status_id = :nsid)",
                            Map.of("id", itemId, "nsid", nsid))))
                    .map(__ -> noStore(Response.ok(new StatusUpdateResponse(
                        true, "plan_item", itemId, oldStatus, newStatus,
                        new StatusRevision(now, null)))));
            })
            .onFailure().recoverWithItem(ex -> {
                LOG.warnf("[LORE STATUS] item=%s: %s", itemId, ex.getMessage());
                return noStore(Response.status(Response.Status.BAD_GATEWAY)
                    .entity(new LoreError("LORE_UPSTREAM", ex.getMessage())));
            });
    }

    // ── Admin: ingest pipeline (Phase 2, LAL-13) ─────────────────────────────

    @POST
    @Path("/admin/lore/ingest")
    @Produces(MediaType.APPLICATION_JSON)
    public Response adminIngest(
            @HeaderParam("X-Seer-Role") String role,
            @QueryParam("docsRoot") String docsRoot) {
        if (!enabled) return disabled();
        if (!"admin".equals(role) && !"superadmin".equals(role)) {
            return noStore(Response.status(Response.Status.FORBIDDEN)
                .entity(new LoreError("FORBIDDEN", "admin role required")));
        }
        LoreIngestService.IngestReport report = ingestService.ingest(docsRoot);
        java.util.LinkedHashMap<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("ok",           report.errors().isEmpty());
        result.put("adrs",         report.adrs());
        result.put("decisions",    report.decisions());
        result.put("sprints",      report.sprints());
        result.put("edges",        report.edges());
        result.put("runbooks",     report.runbooks());
        result.put("qualityGates", report.qualityGates());
        result.put("docs",         report.docs());
        result.put("tasks",        report.tasks());
        result.put("findings",     report.findings());
        result.put("releases",     report.releases());
        result.put("errors",       report.errors());
        return noStore(Response.ok(result));
    }

    // ── Write-path: register a sprint for a plan-item placeholder ────────────

    // ── Release write-path records ────────────────────────────────────────────
    public record ReleaseCreateRequest(
        String release_id, String release_date, String git_tag,
        String type, String description_md, Boolean is_current, Integer week,
        String git_project) {}
    public record ReleaseUpdateRequest(
        String release_id, String release_date, String git_tag,
        String description_md, Boolean is_current, String git_project) {}
    public record ReleaseLinkRequest(
        String release_id, List<Integer> pr_numbers, List<String> sprint_ids,
        String git_project) {}

    public record SprintRegisterRequest(String item_id, String sprint_id, String name, String status) {}
    public record SprintCreateRequest(String sprint_id, String name, String status,
        String item_id, String plan_id, String priority, String outcome_md, String context_md) {}

    @POST
    @Path("sprint")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response registerSprint(SprintRegisterRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.item_id() == null || req.item_id().isBlank()) {
            return badParams("item_id required");
        }
        if (!SAFE_ID.matcher(req.item_id()).matches()
                || (req.sprint_id() != null && !req.sprint_id().isBlank()
                    && !SAFE_ID.matcher(req.sprint_id()).matches())) {
            return badParams("item_id / sprint_id contain illegal characters");
        }
        String status = (req.status() == null || req.status().isBlank()) ? "active" : req.status();
        if (!PLAN_STATUSES.contains(status)) {
            return badParams("status must be one of: " + PLAN_STATUSES);
        }
        try {
            LoreIngestService.RegisterSprintResult r =
                ingestService.registerSprint(req.item_id(), req.sprint_id(), req.name(), status);
            if (!r.ok()) {
                return noStore(Response.status(Response.Status.NOT_FOUND)
                    .entity(new LoreError("NOT_FOUND", r.error())));
            }
            java.util.LinkedHashMap<String, Object> out = new java.util.LinkedHashMap<>();
            out.put("ok", true);
            out.put("item_id", r.itemId());
            out.put("sprint_id", r.sprintId());
            out.put("created", r.created());
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE SPRINT REGISTER] %s: %s", req.item_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Write-path: create sprint directly (no plan-item required) ──────────

    @POST
    @Path("sprint/create")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response createSprint(SprintCreateRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.sprint_id() == null || req.sprint_id().isBlank()) {
            return badParams("sprint_id required");
        }
        if (!SAFE_ID.matcher(req.sprint_id()).matches()) {
            return badParams("sprint_id contains illegal characters");
        }
        String status = (req.status() == null || req.status().isBlank()) ? "todo" : req.status();
        if (!PLAN_STATUSES.contains(status)) {
            return badParams("status must be one of: " + PLAN_STATUSES);
        }
        try {
            LoreIngestService.CreateSprintResult r = ingestService.createSprint(
                req.sprint_id(), req.name(), status, req.item_id(), req.plan_id(), req.priority(), req.outcome_md(), req.context_md());
            java.util.LinkedHashMap<String, Object> out = new java.util.LinkedHashMap<>();
            out.put("ok", true);
            out.put("sprint_id", r.sprintId());
            out.put("item_id", r.itemId());
            out.put("created", r.created());
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE SPRINT CREATE] %s: %s", req.sprint_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Write-path: create / edit a task ────────────────────────────────────

    @POST
    @Path("task")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Uni<Response> createTask(TaskCreateRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return Uni.createFrom().item(disabled());
        Response guard = requireAdmin(role);
        if (guard != null) return Uni.createFrom().item(guard);
        if (req == null || req.sprint_id() == null || req.task_id() == null
                || req.title() == null || req.title().isBlank()) {
            return Uni.createFrom().item(badParams("sprint_id, task_id, title required"));
        }
        if (!SAFE_ID.matcher(req.sprint_id()).matches() || !SAFE_ID.matcher(req.task_id()).matches()) {
            return Uni.createFrom().item(badParams("sprint_id / task_id contain illegal characters"));
        }
        final String sid   = req.sprint_id();
        final String tid   = req.task_id();
        final String uid   = sid + "/" + tid;
        final String title = req.title().trim();
        final String note  = req.note_md();
        final String now   = Instant.now().toString();
        final String nsid  = UUID.randomUUID().toString();

        // order_index = max existing for this sprint + 1 (tasks keyed task_uid = "<sprint>/<id>")
        MartQuery maxQ = new MartQuery("sql",
            "SELECT max(order_index) AS mx FROM KnowTask WHERE task_uid LIKE :prefix",
            Map.of("prefix", sid + "/%"), -1);

        return client.query(db, basicAuth(), maxQ)
            .chain(res -> {
                List<Map<String, Object>> rows = res.result() != null ? res.result() : List.of();
                Object mxRaw = rows.isEmpty() ? null : rows.get(0).get("mx");
                final int order = (mxRaw instanceof Number n ? n.intValue() : 0) + 1;
                return writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "INSERT INTO KnowTask SET task_uid = :uid, task_id = :tid, title = :title, " +
                        "note_md = :note, order_index = :oi, src = 'manual'",
                        mapOfNullable("uid", uid, "tid", tid, "title", title, "note", note, "oi", order)))
                    .chain(__ -> writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "CREATE EDGE PART_OF FROM (SELECT FROM KnowTask WHERE task_uid = :uid) " +
                        "TO (SELECT FROM KnowSprint WHERE sprint_id = :sid)",
                        Map.of("uid", uid, "sid", sid))))
                    .chain(__ -> writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        // note_md must live on the hist row: tasks_of_sprint / tasks_of_phase
                        // read it via out('HAS_STATE')[note_md IS NOT NULL].note_md[0], not the vertex.
                        "INSERT INTO KnowTaskHist SET state_uid = :nsid, status_raw = '📋 PLANNED', " +
                        "valid_from = :now, note_md = :note",
                        mapOfNullable("nsid", nsid, "now", now, "note", note))))
                    .chain(__ -> writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "CREATE EDGE HAS_STATE FROM (SELECT FROM KnowTask WHERE task_uid = :uid) " +
                        "TO (SELECT FROM KnowTaskHist WHERE state_uid = :nsid)",
                        Map.of("uid", uid, "nsid", nsid))))
                    .map(__ -> noStore(Response.ok(new TaskWriteResponse(true, uid, tid, order))));
            })
            .onFailure().recoverWithItem(ex -> {
                LOG.warnf("[LORE TASK CREATE] %s: %s", uid, ex.getMessage());
                return noStore(Response.status(Response.Status.BAD_GATEWAY)
                    .entity(new LoreError("LORE_UPSTREAM", ex.getMessage())));
            });
    }

    @POST
    @Path("task/edit/batch")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response editTaskBatch(List<TaskEditRequest> reqs, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (reqs == null || reqs.isEmpty()) return badParams("tasks array required");
        int updated = 0;
        List<String> errors = new java.util.ArrayList<>();
        for (TaskEditRequest req : reqs) {
            if (req == null || req.task_uid() == null || req.title() == null || req.title().isBlank()) {
                errors.add("skipped (missing task_uid or title): " + req); continue;
            }
            if (!SAFE_ID.matcher(req.task_uid()).matches()) {
                errors.add("skipped (illegal task_uid): " + req.task_uid()); continue;
            }
            try {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "UPDATE KnowTask SET title = :title, note_md = :note WHERE task_uid = :uid",
                    mapOfNullable("title", req.title().trim(), "note", req.note_md(), "uid", req.task_uid())))
                    .await().indefinitely();
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "UPDATE KnowTaskHist SET note_md = :note " +
                    "WHERE in('HAS_STATE').task_uid CONTAINS :uid AND valid_to IS NULL",
                    mapOfNullable("note", req.note_md(), "uid", req.task_uid())))
                    .await().indefinitely();
                updated++;
            } catch (Exception e) {
                errors.add(req.task_uid() + ": " + e.getMessage());
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", errors.isEmpty()); out.put("updated", updated);
        if (!errors.isEmpty()) out.put("errors", errors);
        return noStore(Response.ok(out));
    }

    @POST
    @Path("task/edit")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Uni<Response> editTask(TaskEditRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return Uni.createFrom().item(disabled());
        Response guard = requireAdmin(role);
        if (guard != null) return Uni.createFrom().item(guard);
        if (req == null || req.task_uid() == null
                || req.title() == null || req.title().isBlank()) {
            return Uni.createFrom().item(badParams("task_uid and title required"));
        }
        if (!SAFE_ID.matcher(req.task_uid()).matches()) {
            return Uni.createFrom().item(badParams("task_uid contains illegal characters"));
        }
        final String uid = req.task_uid();
        return writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE KnowTask SET title = :title, note_md = :note WHERE task_uid = :uid",
                mapOfNullable("title", req.title().trim(), "note", req.note_md(), "uid", uid)))
            // The vertex note_md above is a denormalisation the UI never reads.
            // tasks_of_sprint / tasks_of_phase read note_md from the open KnowTaskHist row
            // (out('HAS_STATE')[note_md IS NOT NULL].note_md[0]); mirror the write there too.
            .chain(__ -> writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE KnowTaskHist SET note_md = :note " +
                "WHERE in('HAS_STATE').task_uid CONTAINS :uid AND valid_to IS NULL",
                mapOfNullable("note", req.note_md(), "uid", uid))))
            .map(__ -> noStore(Response.ok(new TaskWriteResponse(true, uid, null, null))))
            .onFailure().recoverWithItem(ex -> {
                LOG.warnf("[LORE TASK EDIT] %s: %s", uid, ex.getMessage());
                return noStore(Response.status(Response.Status.BAD_GATEWAY)
                    .entity(new LoreError("LORE_UPSTREAM", ex.getMessage())));
            });
    }

    // ── Write-path: create a new KnowRelease ────────────────────────────────

    @POST
    @Path("release")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response createRelease(ReleaseCreateRequest req,
                                  @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.release_id() == null || req.release_id().isBlank()) {
            return badParams("release_id required");
        }
        if (!SAFE_ID.matcher(req.release_id()).matches()) {
            return badParams("release_id contains illegal characters");
        }
        try {
            boolean cur = Boolean.TRUE.equals(req.is_current());
            String gp   = req.git_project() != null && !req.git_project().isBlank()
                          ? req.git_project() : "NooriUta/AIDA";
            if (cur) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "UPDATE KnowRelease SET is_current=false WHERE is_current=true AND git_project='" + gp + "'",
                    null)).await().indefinitely();
            }
            String now  = Instant.now().toString();
            String nsid = UUID.randomUUID().toString();
            // Build SET clause dynamically — ArcadeDB rejects null param bindings
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("rid", req.release_id());
            StringBuilder set = new StringBuilder(
                "INSERT INTO KnowRelease SET release_id=:rid, is_current=" + cur);
            if (req.git_tag()        != null) { set.append(", git_tag=:tag");          p.put("tag",   req.git_tag()); }
            String rdate = req.release_date() != null ? req.release_date()
                                                      : java.time.LocalDate.now().toString();
            set.append(", release_date=:date"); p.put("date", rdate);
            if (req.type()           != null) { set.append(", `type`=:rtype");       p.put("rtype", req.type()); }
            if (req.description_md() != null) { set.append(", description_md=:dmd"); p.put("dmd", req.description_md()); }
            if (req.week()           != null) { set.append(", week=:week");          p.put("week",  req.week()); }
            String ruid = gp + "#" + req.release_id();
            set.append(", git_project=:gp, release_uid=:ruid");
            p.put("gp", gp); p.put("ruid", ruid);
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                set.toString(), p)).await().indefinitely();
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "INSERT INTO KnowReleaseHist SET state_uid=:nsid, valid_from=:now",
                Map.of("nsid", nsid, "now", now))).await().indefinitely();
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "CREATE EDGE HAS_STATE " +
                "FROM (SELECT FROM KnowRelease WHERE release_id=:rid) " +
                "TO   (SELECT FROM KnowReleaseHist WHERE state_uid=:nsid)",
                Map.of("rid", req.release_id(), "nsid", nsid))).await().indefinitely();
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true); out.put("release_id", req.release_id());
            out.put("is_current", cur); out.put("created", now);
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE RELEASE CREATE] %s: %s", req.release_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Write-path: update fields on an existing KnowRelease ────────────────

    @POST
    @Path("release/update")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response updateRelease(ReleaseUpdateRequest req,
                                  @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.release_id() == null || req.release_id().isBlank()) {
            return badParams("release_id required");
        }
        if (!SAFE_ID.matcher(req.release_id()).matches()) {
            return badParams("release_id contains illegal characters");
        }
        try {
            boolean curSet = req.is_current() != null;
            boolean cur    = Boolean.TRUE.equals(req.is_current());
            String ugp     = req.git_project() != null && !req.git_project().isBlank()
                             ? req.git_project() : "NooriUta/AIDA";
            if (cur) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "UPDATE KnowRelease SET is_current=false WHERE is_current=true AND git_project='" + ugp + "'",
                    null)).await().indefinitely();
            }
            // Build SET clause only for non-null fields to allow partial updates.
            StringBuilder sb = new StringBuilder("UPDATE KnowRelease SET ");
            Map<String, Object> p = new LinkedHashMap<>();
            if (req.git_tag()        != null) { sb.append("git_tag=:tag, ");          p.put("tag",  req.git_tag()); }
            if (req.release_date()   != null) { sb.append("release_date=:date, ");    p.put("date", req.release_date()); }
            if (req.description_md() != null) { sb.append("description_md=:dmd, ");   p.put("dmd",  req.description_md()); }
            if (req.git_project()    != null) {
                sb.append("git_project=:gp, release_uid=:ruid, ");
                p.put("gp", req.git_project());
                p.put("ruid", req.git_project() + "#" + req.release_id());
            }
            if (curSet) sb.append("is_current=").append(cur).append(", ");
            // Remove trailing comma+space and finish.
            String set = sb.toString().replaceAll(",\\s*$", "");
            if (set.equals("UPDATE KnowRelease SET")) {
                return badParams("at least one field (git_tag, release_date, description_md, is_current) required");
            }
            // Prefer release_uid lookup when git_project is known for multi-repo safety
            if (req.git_project() != null && !req.git_project().isBlank()) {
                p.put("rkey", req.git_project() + "#" + req.release_id());
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    set + " WHERE release_uid=:rkey", p)).await().indefinitely();
            } else {
                p.put("rid", req.release_id());
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    set + " WHERE release_id=:rid", p)).await().indefinitely();
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true); out.put("release_id", req.release_id());
            out.put("updated_at", Instant.now().toString());
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE RELEASE UPDATE] %s: %s", req.release_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Write-path: link PRs / sprints to a release ─────────────────────────

    @POST
    @Path("release/link")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkRelease(ReleaseLinkRequest req,
                                @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.release_id() == null || req.release_id().isBlank()) {
            return badParams("release_id required");
        }
        if (!SAFE_ID.matcher(req.release_id()).matches()) {
            return badParams("release_id contains illegal characters");
        }
        int sprintsLinked = 0, prsLinked = 0;
        List<String> errors = new java.util.ArrayList<>();
        try {
            String gp = (req.git_project() != null && !req.git_project().isBlank())
                ? req.git_project() : "NooriUta/AIDA";
            String ruid = gp + "#" + req.release_id();
            List<String> sprintIds = req.sprint_ids() != null ? req.sprint_ids() : List.of();
            for (String sid : sprintIds) {
                if (!SAFE_ID.matcher(sid).matches()) {
                    errors.add("skipped sprint (illegal id): " + sid); continue;
                }
                try {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "CREATE EDGE IMPLEMENTED_IN_RELEASE " +
                        "FROM (SELECT FROM KnowSprint WHERE sprint_id=:sid) " +
                        "TO   (SELECT FROM KnowRelease WHERE release_uid=:ruid)",
                        Map.of("sid", sid, "ruid", ruid))).await().indefinitely();
                    sprintsLinked++;
                } catch (Exception e) {
                    errors.add("sprint " + sid + ": " + e.getMessage());
                }
            }
            // LH-43: auto-set week on KnowRelease if null, computed from release_date vs w0_date
            if (sprintsLinked > 0) {
                try {
                    @SuppressWarnings("unchecked")
                    List<Map<String, Object>> relInfo = (List<Map<String, Object>>)
                        client.query(db, basicAuth(), new MartQuery("sql",
                            "SELECT release_date, week FROM KnowRelease WHERE release_uid=:ruid",
                            Map.of("ruid", ruid), -1)).await().indefinitely().result();
                    if (relInfo != null && !relInfo.isEmpty()) {
                        Object weekVal = relInfo.get(0).get("week");
                        Object dateVal = relInfo.get(0).get("release_date");
                        if (weekVal == null && dateVal != null) {
                            java.time.LocalDate w0 = java.time.LocalDate.of(2026, 4, 13);
                            java.time.LocalDate relDate = java.time.LocalDate.parse(
                                dateVal.toString().substring(0, 10));
                            int week = (int)(java.time.temporal.ChronoUnit.DAYS.between(w0, relDate) / 7) + 1;
                            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                                "UPDATE KnowRelease SET week=:week WHERE release_uid=:ruid AND week IS NULL",
                                Map.of("week", week, "ruid", ruid))).await().indefinitely();
                        }
                    }
                } catch (Exception e) {
                    LOG.warnf("[LORE RELEASE LINK] week auto-set failed for %s: %s", ruid, e.getMessage());
                }
            }
            List<Integer> prs = req.pr_numbers() != null ? req.pr_numbers() : List.of();
            for (Integer prNum : prs) {
                try {
                    String prUid = gp + "#" + prNum;
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "UPDATE KnowPR SET pr_uid=:uid, pr_number=:n, git_project=:gp " +
                        "UPSERT WHERE pr_uid=:uid",
                        Map.of("uid", prUid, "n", prNum, "gp", gp))).await().indefinitely();
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "CREATE EDGE SHIPPED_IN " +
                        "FROM (SELECT FROM KnowPR WHERE pr_uid=:uid) " +
                        "TO   (SELECT FROM KnowRelease WHERE release_uid=:ruid)",
                        Map.of("uid", prUid, "ruid", ruid))).await().indefinitely();
                    prsLinked++;
                } catch (Exception e) {
                    errors.add("pr #" + prNum + ": " + e.getMessage());
                }
            }
        } catch (Exception e) {
            LOG.warnf("[LORE RELEASE LINK] %s: %s", req.release_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", errors.isEmpty());
        out.put("release_id", req.release_id());
        out.put("sprints_linked", sprintsLinked);
        out.put("prs_linked", prsLinked);
        if (!errors.isEmpty()) out.put("errors", errors);
        return noStore(Response.ok(out));
    }

    // ── Write-path: unlink sprint or PR from a release ───────────────────────────

    public record ReleaseUnlinkRequest(String release_id, String git_project,
                                       List<String> sprint_ids, List<Integer> pr_numbers) {}

    @POST
    @Path("release/unlink")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response unlinkRelease(ReleaseUnlinkRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.release_id() == null || req.release_id().isBlank())
            return badParams("release_id required");
        String gp = (req.git_project() != null && !req.git_project().isBlank())
            ? req.git_project() : "NooriUta/AIDA";
        String ruid = gp + "#" + req.release_id();
        int sprintsRemoved = 0, prsRemoved = 0;
        List<String> errors = new java.util.ArrayList<>();
        try {
            for (String sid : (req.sprint_ids() != null ? req.sprint_ids() : List.<String>of())) {
                if (!SAFE_ID.matcher(sid).matches()) { errors.add("bad sprint id: " + sid); continue; }
                try {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE EDGE IMPLEMENTED_IN_RELEASE " +
                        "FROM (SELECT FROM KnowSprint WHERE sprint_id=:sid) " +
                        "TO   (SELECT FROM KnowRelease WHERE release_uid=:ruid)",
                        Map.of("sid", sid, "ruid", ruid))).await().indefinitely();
                    sprintsRemoved++;
                } catch (Exception e) { errors.add("sprint " + sid + ": " + e.getMessage()); }
            }
            for (Integer prNum : (req.pr_numbers() != null ? req.pr_numbers() : List.<Integer>of())) {
                String prUid = gp + "#" + prNum;
                try {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE EDGE SHIPPED_IN " +
                        "FROM (SELECT FROM KnowPR WHERE pr_uid=:uid) " +
                        "TO   (SELECT FROM KnowRelease WHERE release_uid=:ruid)",
                        Map.of("uid", prUid, "ruid", ruid))).await().indefinitely();
                    prsRemoved++;
                } catch (Exception e) { errors.add("pr #" + prNum + ": " + e.getMessage()); }
            }
        } catch (Exception e) {
            LOG.warnf("[LORE RELEASE UNLINK] %s: %s", req.release_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", errors.isEmpty());
        out.put("release_id", req.release_id());
        out.put("sprints_removed", sprintsRemoved);
        out.put("prs_removed", prsRemoved);
        if (!errors.isEmpty()) out.put("errors", errors);
        return noStore(Response.ok(out));
    }

    // ── Write-path: move PR or release to a different git_project ───────────────

    public record ProjectMoveRequest(String entity_type, String id, String git_project) {}

    @POST
    @Path("project/move")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response moveToProject(ProjectMoveRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.entity_type() == null || req.id() == null || req.git_project() == null
                || req.id().isBlank() || req.git_project().isBlank())
            return badParams("entity_type, id, git_project required");
        try {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("entity_type", req.entity_type());
            out.put("id", req.id());
            out.put("git_project", req.git_project());

            if ("pr".equals(req.entity_type())) {
                // pr_uid may be old format (number-only) or new "project#number"
                // Accept either pr_uid or raw pr_number as id
                List<Map<String, Object>> rows = (List<Map<String, Object>>)
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "SELECT @rid, pr_number, git_project FROM KnowPR " +
                        "WHERE pr_uid = :id OR pr_number.asString() = :id LIMIT 1",
                        Map.of("id", req.id()))).await().indefinitely().result();
                if (rows == null || rows.isEmpty())
                    return noStore(Response.status(Response.Status.NOT_FOUND)
                        .entity(new LoreError("NOT_FOUND", "PR not found: " + req.id())));
                String rid      = rows.get(0).get("@rid").toString();
                Object prNumObj = rows.get(0).get("pr_number");
                int    prNum    = prNumObj instanceof Number n ? n.intValue() : Integer.parseInt(req.id());
                String newUid   = req.git_project() + "#" + prNum;
                // Update vertex fields
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "UPDATE " + rid + " SET git_project=:gp, pr_uid=:uid",
                    Map.of("gp", req.git_project(), "uid", newUid))).await().indefinitely();
                // Re-wire BELONGS_TO_PROJECT: delete old edge, create new
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE EDGE BELONGS_TO_PROJECT FROM " + rid, null)).await().indefinitely();
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE BELONGS_TO_PROJECT FROM " + rid +
                    " TO (SELECT FROM KnowGitProject WHERE slug=:gp)",
                    Map.of("gp", req.git_project()))).await().indefinitely();
                out.put("pr_uid", newUid);

            } else if ("release".equals(req.entity_type())) {
                String newRuid = req.git_project() + "#" + req.id();
                int updated = ((List<?>) writeClient.command(db, basicAuth(),
                    new LoreCommandClient.LoreCommand("sql",
                        "UPDATE KnowRelease SET git_project=:gp, release_uid=:ruid " +
                        "WHERE release_id=:rid OR release_uid=:rid",
                        Map.of("gp", req.git_project(), "ruid", newRuid, "rid", req.id())))
                    .await().indefinitely().result()).size();
                if (updated == 0)
                    return noStore(Response.status(Response.Status.NOT_FOUND)
                        .entity(new LoreError("NOT_FOUND", "release not found: " + req.id())));
                out.put("release_uid", newRuid);
            } else {
                return badParams("entity_type must be 'pr' or 'release'");
            }
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE PROJECT MOVE] %s %s: %s", req.entity_type(), req.id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Write-path: append PR numbers to open KnowSprintHist.pr_refs ───────────

    @POST
    @Path("sprint/refs")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response updateSprintRefs(SprintRefsRequest req,
                                     @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.sprint_id() == null || req.sprint_id().isBlank())
            return badParams("sprint_id required");
        if (!SAFE_ID.matcher(req.sprint_id()).matches())
            return badParams("sprint_id contains illegal characters");
        if (req.pr_numbers() == null || req.pr_numbers().isEmpty())
            return badParams("pr_numbers required");

        String gp = (req.git_project() != null && !req.git_project().isBlank())
            ? req.git_project() : "NooriUta/AIDA";
        String base = (req.repo_url() != null && !req.repo_url().isBlank())
            ? req.repo_url().replaceAll("/+$", "")
            : "https://github.com/" + gp + "/pull";

        try {
            // Read current pr_refs from the open hist row.
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> rows = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "SELECT @rid, pr_refs FROM KnowSprintHist " +
                    "WHERE in('HAS_STATE').sprint_id CONTAINS :sid AND valid_to IS NULL",
                    Map.of("sid", req.sprint_id()))).await().indefinitely().result();

            if (rows == null || rows.isEmpty())
                return noStore(Response.status(Response.Status.NOT_FOUND)
                    .entity(new LoreError("NOT_FOUND", "no open hist row for sprint: " + req.sprint_id())));

            // pr_refs is a markdown string; build the new entries and append.
            String existing = "";
            Object raw = rows.get(0).get("pr_refs");
            if (raw != null) existing = raw.toString().trim();
            String rid = rows.get(0).get("@rid").toString();

            StringBuilder sb = new StringBuilder(existing);
            int added = 0;
            for (Integer n : req.pr_numbers()) {
                String link = "[#" + n + "](" + base + "/" + n + ")";
                if (!existing.contains(link)) {
                    if (!sb.isEmpty() && !sb.toString().endsWith(" ")) sb.append(" ");
                    sb.append(link);
                    added++;
                }
            }
            String updated = sb.toString().trim();
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE " + rid + " SET pr_refs = :refs",
                Map.of("refs", updated))).await().indefinitely();

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true); out.put("sprint_id", req.sprint_id());
            out.put("added", added); out.put("pr_refs", updated);
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE SPRINT REFS] %s: %s", req.sprint_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Write-path: update KnowSprint vertex fields ──────────────────────────

    @POST
    @Path("sprint/update")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response updateSprint(SprintUpdateRequest req,
                                 @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.sprint_id() == null || req.sprint_id().isBlank())
            return badParams("sprint_id required");
        if (!SAFE_ID.matcher(req.sprint_id()).matches())
            return badParams("sprint_id contains illegal characters");
        StringBuilder sb = new StringBuilder("UPDATE KnowSprint SET ");
        Map<String, Object> p = new LinkedHashMap<>();
        if (req.name()       != null) { sb.append("name=:name, ");            p.put("name",       req.name()); }
        if (req.outcome_md() != null) { sb.append("outcome_md=:outcome, ");  p.put("outcome",    req.outcome_md()); }
        if (req.context_md() != null) { sb.append("context_md=:ctx, ");      p.put("ctx",        req.context_md()); }
        if (req.priority()   != null) { sb.append("priority=:priority, ");   p.put("priority",   req.priority()); }
        if (req.plan_id()    != null) { sb.append("plan_id=:plan_id, ");     p.put("plan_id",    req.plan_id()); }
        if (req.effort_days()!= null) { sb.append("effort_days=:effort, ");  p.put("effort",     req.effort_days()); }
        String set = sb.toString().replaceAll(",\\s*$", "");
        if (set.equals("UPDATE KnowSprint SET"))
            return badParams("at least one field required");
        p.put("sid", req.sprint_id());
        try {
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                set + " WHERE sprint_id=:sid", p)).await().indefinitely();
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true); out.put("sprint_id", req.sprint_id());
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE SPRINT UPDATE] %s: %s", req.sprint_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Write-path: link sprint ↔ project ────────────────────────────────────

    public record SprintProjectRequest(String sprint_id, String git_project, String action) {}

    @POST
    @Path("sprint/project")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkSprintProject(SprintProjectRequest req,
                                      @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.sprint_id() == null || req.git_project() == null)
            return badParams("sprint_id and git_project required");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            if (remove) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE EDGE BELONGS_TO_PROJECT " +
                    "FROM (SELECT FROM KnowSprint WHERE sprint_id=:sid) " +
                    "TO   (SELECT FROM KnowGitProject WHERE slug=:gp)",
                    Map.of("sid", req.sprint_id(), "gp", req.git_project()))).await().indefinitely();
            } else {
                // Idempotent: create edge only if not already linked
                List<Map<String, Object>> existing = ingestService.queryPublic(
                    "SELECT out('BELONGS_TO_PROJECT').slug AS gps FROM KnowSprint WHERE sprint_id=:sid",
                    Map.of("sid", req.sprint_id()));
                @SuppressWarnings("unchecked")
                List<String> current = existing.isEmpty() ? List.of()
                    : (List<String>) existing.get(0).getOrDefault("gps", List.of());
                if (!current.contains(req.git_project())) {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "CREATE EDGE BELONGS_TO_PROJECT " +
                        "FROM (SELECT FROM KnowSprint WHERE sprint_id=:sid) " +
                        "TO   (SELECT FROM KnowGitProject WHERE slug=:gp)",
                        Map.of("sid", req.sprint_id(), "gp", req.git_project()))).await().indefinitely();
                }
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true); out.put("sprint_id", req.sprint_id());
            out.put("git_project", req.git_project()); out.put("action", remove ? "removed" : "added");
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE SPRINT PROJECT] %s / %s: %s", req.sprint_id(), req.git_project(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Write-path: batch status update ──────────────────────────────────────

    @POST
    @Path("status/batch")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response batchSetStatus(BatchStatusRequest req,
                                   @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.ids() == null || req.ids().isEmpty())
            return badParams("ids required");
        if (req.entity_type() == null || req.status() == null)
            return badParams("entity_type and status required");
        int updated = 0;
        List<String> errors = new java.util.ArrayList<>();
        for (String id : req.ids()) {
            try {
                var body = new StatusUpdateRequest(req.entity_type(), id, req.status());
                Response r = updateStatus(body, "admin").await().indefinitely();
                if (r.getStatus() == 200) updated++;
                else errors.add(id + ": HTTP " + r.getStatus());
            } catch (Exception e) {
                errors.add(id + ": " + e.getMessage());
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", errors.isEmpty()); out.put("updated", updated);
        if (!errors.isEmpty()) out.put("errors", errors);
        return noStore(Response.ok(out));
    }

    // ── Write-path: create / upsert KnowADR ──────────────────────────────────

    @POST
    @Path("adr")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response createAdr(AdrCreateRequest req,
                              @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.adr_id() == null || req.adr_id().isBlank())
            return badParams("adr_id required");
        if (!SAFE_ID.matcher(req.adr_id()).matches())
            return badParams("adr_id contains illegal characters");
        try {
            String now  = Instant.now().toString();
            String nsid = UUID.randomUUID().toString();

            // Step 1: upsert KnowADR vertex — LH-44: only set status when provided; for
            // new ADRs default to PROPOSED, for existing ones never overwrite with null.
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> existingAdr = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "SELECT status FROM KnowADR WHERE adr_id=:id",
                    Map.of("id", req.adr_id())))
                .await().indefinitely().result();
            boolean isNewAdr = existingAdr == null || existingAdr.isEmpty();
            String resolvedStatus = (req.status() != null && !req.status().isBlank())
                ? req.status() : (isNewAdr ? "PROPOSED" : null);
            StringBuilder upsertSql = new StringBuilder(
                "UPDATE KnowADR SET adr_id=:adr_id, name=:name, " +
                "date_created=:date_created, component_id=:component_id");
            Map<String, Object> upsertP = mapOfNullable(
                "adr_id",       req.adr_id(),
                "name",         req.name(),
                "date_created", req.date_created() != null ? req.date_created()
                                    : java.time.LocalDate.now().toString(),
                "component_id", req.component_id());
            if (resolvedStatus != null) {
                upsertSql.append(", status=:status");
                upsertP.put("status", resolvedStatus);
            }
            upsertSql.append(" UPSERT WHERE adr_id=:adr_id");
            writeClient.command(db, basicAuth(),
                new LoreCommandClient.LoreCommand("sql", upsertSql.toString(), upsertP))
                .await().indefinitely();

            // Step 2: check for an existing open SCD2 hist row
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> histRows = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "SELECT state_uid FROM KnowADRHist " +
                    "WHERE in('HAS_STATE').adr_id[0] = :id AND valid_to IS NULL LIMIT 1",
                    Map.of("id", req.adr_id())))
                .await().indefinitely().result();

            Map<String, Object> histP = mapOfNullable(
                "ctx", req.context_md(),
                "dec", req.decision_md(),
                "con", req.consequences_md());

            boolean histCreated;
            if (histRows != null && !histRows.isEmpty()) {
                // Step 3a: update body fields on the existing open hist row (re-create / re-call)
                String sid = String.valueOf(histRows.get(0).get("state_uid"));
                histP.put("sid", sid);
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "UPDATE KnowADRHist SET context_md=:ctx, decision_md=:dec, consequences_md=:con" +
                    " WHERE state_uid=:sid",
                    histP)).await().indefinitely();
                histCreated = false;
            } else {
                // Step 3b: create the initial open hist row + HAS_STATE edge
                histP.put("nsid", nsid);
                histP.put("now",  now);
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "INSERT INTO KnowADRHist SET state_uid=:nsid, valid_from=:now, " +
                    "context_md=:ctx, decision_md=:dec, consequences_md=:con",
                    histP)).await().indefinitely();
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE HAS_STATE " +
                    "FROM (SELECT FROM KnowADR     WHERE adr_id    = :id) " +
                    "TO   (SELECT FROM KnowADRHist WHERE state_uid = :nsid)",
                    Map.of("id", req.adr_id(), "nsid", nsid)))
                    .await().indefinitely();
                histCreated = true;
            }

            // Step 4: replace DEPENDS_ON edges
            if (req.depends_on_ids() != null) {
                try {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM (SELECT expand(outE('DEPENDS_ON')) FROM KnowADR WHERE adr_id = :id)",
                        Map.of("id", req.adr_id()))).await().indefinitely();
                } catch (Exception ex) {
                    LOG.warnf("[LORE ADR DEPENDS_ON DEL] %s: %s", req.adr_id(), ex.getMessage());
                }
                for (String dep : req.depends_on_ids()) {
                    if (dep == null || dep.isBlank()) continue;
                    try {
                        writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                            "CREATE EDGE DEPENDS_ON " +
                            "FROM (SELECT FROM KnowADR WHERE adr_id = :id) " +
                            "TO   (SELECT FROM KnowADR WHERE adr_id = :dep)",
                            Map.of("id", req.adr_id(), "dep", dep))).await().indefinitely();
                    } catch (Exception ex) {
                        LOG.warnf("[LORE ADR DEPENDS_ON] %s → %s: %s", req.adr_id(), dep, ex.getMessage());
                    }
                }
            }

            // Step 5: replace SUPERSEDES edges
            if (req.supersedes_ids() != null) {
                try {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM (SELECT expand(outE('SUPERSEDES')) FROM KnowADR WHERE adr_id = :id)",
                        Map.of("id", req.adr_id()))).await().indefinitely();
                } catch (Exception ex) {
                    LOG.warnf("[LORE ADR SUPERSEDES DEL] %s: %s", req.adr_id(), ex.getMessage());
                }
                for (String sup : req.supersedes_ids()) {
                    if (sup == null || sup.isBlank()) continue;
                    try {
                        writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                            "CREATE EDGE SUPERSEDES " +
                            "FROM (SELECT FROM KnowADR WHERE adr_id = :id) " +
                            "TO   (SELECT FROM KnowADR WHERE adr_id = :sup)",
                            Map.of("id", req.adr_id(), "sup", sup))).await().indefinitely();
                    } catch (Exception ex) {
                        LOG.warnf("[LORE ADR SUPERSEDES] %s → %s: %s", req.adr_id(), sup, ex.getMessage());
                    }
                }
            }

            // Step 6: replace BELONGS_TO edges (component_ids wins over legacy single component_id)
            List<String> compIds = (req.component_ids() != null && !req.component_ids().isEmpty())
                ? req.component_ids()
                : (req.component_id() != null && !req.component_id().isBlank()
                    ? List.of(req.component_id()) : null);
            if (compIds != null) {
                try {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM (SELECT expand(outE('BELONGS_TO')) FROM KnowADR WHERE adr_id = :id)",
                        Map.of("id", req.adr_id()))).await().indefinitely();
                } catch (Exception ex) {
                    LOG.warnf("[LORE ADR BELONGS_TO DEL] %s: %s", req.adr_id(), ex.getMessage());
                }
                for (String cid : compIds) {
                    if (cid == null || cid.isBlank()) continue;
                    try {
                        writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                            "CREATE EDGE BELONGS_TO " +
                            "FROM (SELECT FROM KnowADR WHERE adr_id = :id) " +
                            "TO   (SELECT FROM LoreComponent WHERE component_id = :cid)",
                            Map.of("id", req.adr_id(), "cid", cid))).await().indefinitely();
                    } catch (Exception ex) {
                        LOG.warnf("[LORE ADR BELONGS_TO] %s → %s: %s", req.adr_id(), cid, ex.getMessage());
                    }
                }
            }

            // Step 7: replace TAGGED_WITH edges (upsert KnowTag on the fly)
            if (req.tags() != null) {
                try {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM (SELECT expand(outE('TAGGED_WITH')) FROM KnowADR WHERE adr_id = :id)",
                        Map.of("id", req.adr_id()))).await().indefinitely();
                } catch (Exception ex) {
                    LOG.warnf("[LORE ADR TAGGED_WITH DEL] %s: %s", req.adr_id(), ex.getMessage());
                }
                for (String tag : req.tags()) {
                    if (tag == null || tag.isBlank()) continue;
                    try {
                        writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                            "UPDATE KnowTag SET tag_id=:tag UPSERT WHERE tag_id=:tag",
                            Map.of("tag", tag))).await().indefinitely();
                        writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                            "CREATE EDGE TAGGED_WITH " +
                            "FROM (SELECT FROM KnowADR WHERE adr_id = :id) " +
                            "TO   (SELECT FROM KnowTag WHERE tag_id = :tag)",
                            Map.of("id", req.adr_id(), "tag", tag))).await().indefinitely();
                    } catch (Exception ex) {
                        LOG.warnf("[LORE ADR TAGGED_WITH] %s → %s: %s", req.adr_id(), tag, ex.getMessage());
                    }
                }
            }

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true); out.put("adr_id", req.adr_id());
            out.put("hist_created", histCreated);
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE ADR CREATE] %s: %s", req.adr_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Write-path: create / upsert KnowDecision ─────────────────────────────

    @POST
    @Path("decision")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response createDecision(DecisionCreateRequest req,
                                   @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.decision_id() == null || req.decision_id().isBlank())
            return badParams("decision_id required");
        if (req.title() == null || req.title().isBlank())
            return badParams("title required");
        try {
            Map<String, Object> p = mapOfNullable(
                "did",   req.decision_id(),
                "title", req.title().trim(),
                "body",  req.body_md(),
                "date",  req.date_created() != null ? req.date_created()
                             : java.time.LocalDate.now().toString(),
                "refs",  req.refs_raw());
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE KnowDecision SET decision_id=:did, title=:title, body_md=:body, " +
                "date_created=:date, refs_raw=:refs UPSERT WHERE decision_id=:did",
                p)).await().indefinitely();
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true); out.put("decision_id", req.decision_id());
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE DECISION CREATE] %s: %s", req.decision_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    public record ComponentUpdateRequest(
        String component_id,
        String owner, String team,
        String full_name, String area, String game_icon, String parent_id
    ) {}

    @POST
    @Path("component/update")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response updateComponent(ComponentUpdateRequest req,
                                    @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.component_id() == null || req.component_id().isBlank())
            return badParams("component_id required");
        try {
            Map<String, Object> p = mapOfNullable(
                "cid",       req.component_id(),
                "owner",     req.owner(),
                "team",      req.team(),
                "full_name", req.full_name(),
                "area",      req.area(),
                "game_icon", req.game_icon(),
                "parent_id", req.parent_id());
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE LoreComponent SET owner=:owner, team=:team, " +
                "full_name=:full_name, area=:area, game_icon=:game_icon, parent_id=:parent_id " +
                "WHERE component_id=:cid",
                p)).await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "component_id", req.component_id())));
        } catch (Exception e) {
            LOG.warnf("[LORE COMPONENT UPDATE] %s: %s", req.component_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    private Response requireAdmin(String role) {
        if (!"admin".equals(role) && !"superadmin".equals(role)) {
            return noStore(Response.status(Response.Status.FORBIDDEN)
                .entity(new LoreError("FORBIDDEN", "admin role required")));
        }
        return null;
    }

    private Response badParams(String msg) {
        return noStore(Response.status(Response.Status.BAD_REQUEST)
            .entity(new LoreError("BAD_PARAMS", msg)));
    }

    /** Param map that tolerates null values (Map.of forbids them) — used for nullable note_md. */
    private static Map<String, Object> mapOfNullable(Object... kv) {
        Map<String, Object> m = new java.util.HashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    private Response disabled() {
        return noStore(Response.status(Response.Status.NOT_FOUND)
            .entity(new LoreError("LORE_DISABLED",
                "lore.enabled=false (lore is dev-only)")));
    }

    private String basicAuth() {
        return "Basic " + Base64.getEncoder().encodeToString(
            (user + ":" + password).getBytes(StandardCharsets.UTF_8));
    }

    private static Response noStore(Response.ResponseBuilder builder) {
        return builder.type(MediaType.APPLICATION_JSON).header("Cache-Control", "no-store").build();
    }
}
