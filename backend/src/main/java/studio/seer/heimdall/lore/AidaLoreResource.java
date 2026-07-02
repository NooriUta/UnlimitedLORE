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
import java.util.ArrayList;
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
        List<String> component_ids, List<String> tags, String file_path) {}
    public record DecisionCreateRequest(String decision_id, String title, String body_md,
        String date_created, String refs_raw) {}
    public record TaskCreateRequest(String sprint_id, String task_id, String title, String note_md,
        String phase_uid) {}
    public record TaskEditRequest(String task_uid, String title, String note_md, Integer effort_days) {}
    public record TaskWriteResponse(boolean ok, String task_uid, String task_id, Integer order_index) {}
    // MCP-PHASES (SPRINT_LORE_MCP_GAPS_2): sprint phases write-path
    public record PhaseCreateRequest(String sprint_id, String phase_key, String name, Integer order_index) {}
    public record PhaseWriteResponse(boolean ok, String phase_uid, String phase_id,
        Integer order_index, boolean created) {}
    public record TaskPhaseRequest(String task_uid, String phase_uid, String action) {}

    // task_uid carries a '/' (e.g. SPRINT_X/SH-1); all values are bound as SQL params, never concatenated.
    private static final Pattern SAFE_ID = Pattern.compile("[A-Za-z0-9_./\\-]{1,100}");
    private static final Set<String> ENTITY_TYPES =
        Set.of("plan_item", "sprint", "task", "checkpoint", "adr", "phase");
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

    // ── Analytics: pre-aggregated dashboard data ─────────────────────────────
    // Computed in Java from a handful of light queries (KnowTaskHist current rows
    // instead of per-task HAS_STATE traversal — fast). Tasks are mapped to sprints
    // by task_uid prefix; sprints to components by the explicit BELONGS_TO edge.

    private static String classifyStatus(String s) {
        if (s == null || s.isBlank()) return "none";   // status not set ≠ TODO
        String u = s.toUpperCase();
        if (u.contains("DONE") || u.contains("CLOSED") || u.contains("ЗАВЕРШ")) return "done";
        if (u.contains("PROGRESS") || u.contains("WIP"))                        return "in_progress";
        if (u.contains("PARTIAL") || u.contains("ЧАСТИЧ"))                      return "partial";
        if (u.contains("READY") || u.contains("ДЕПЛО"))                         return "ready_for_deploy";
        if (u.contains("BLOCK") || u.contains("ЗАБЛОК"))                        return "blocked";
        if (u.contains("CANCEL") || u.contains("ОТМЕН"))                        return "cancelled";
        if (u.contains("PLANNED"))                                             return "planned";
        if (u.contains("DESIGN"))                                              return "design";
        if (u.contains("BACKLOG"))                                             return "backlog";
        if (u.contains("DEFER") || u.contains("ОТЛОЖ"))                        return "deferred";
        return "todo";
    }

    @SuppressWarnings("unchecked")
    private static String firstStr(Object v) {
        if (v == null) return null;
        if (v instanceof List<?> l) return l.isEmpty() ? null : String.valueOf(l.get(0));
        return String.valueOf(v);
    }

    @GET
    @Path("analytics")
    @Produces(MediaType.APPLICATION_JSON)
    public Response analytics(@HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        try {
            List<Map<String, Object>> comps = ingestService.queryPublic(
                "SELECT component_id, full_name, area FROM LoreComponent", Map.of());
            List<Map<String, Object>> links = ingestService.queryPublic(
                "SELECT @out.sprint_id AS s, @in.component_id AS c FROM BELONGS_TO WHERE @out.sprint_id IS NOT NULL", Map.of());
            List<Map<String, Object>> sprints = ingestService.queryPublic(
                "SELECT sprint_id, out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0] AS status_raw FROM KnowSprint", Map.of());
            List<Map<String, Object>> taskRows = ingestService.queryPublic(
                "SELECT in('HAS_STATE').task_uid AS tuid, status_raw, effort_days FROM KnowTaskHist WHERE valid_to IS NULL", Map.of());
            List<Map<String, Object>> releases = ingestService.queryPublic(
                "SELECT git_tag, git_project, is_current FROM KnowRelease", Map.of());

            // ── Tasks: dedupe by task_uid (SCD2 may leave >1 open row), classify ──
            Map<String, String> taskStatus = new LinkedHashMap<>();
            Map<String, Double> taskEffortMap = new LinkedHashMap<>(); // task_uid -> effort_days
            for (Map<String, Object> r : taskRows) {
                String tuid = firstStr(r.get("tuid"));
                if (tuid == null) continue;
                String cls = classifyStatus((String) r.get("status_raw"));
                // prefer a "done" classification on collision
                String prev = taskStatus.get(tuid);
                if (prev == null || (!"done".equals(prev) && "done".equals(cls))) taskStatus.put(tuid, cls);
                // collect effort_days (first non-null wins)
                if (!taskEffortMap.containsKey(tuid)) {
                    Object ed = r.get("effort_days");
                    if (ed instanceof Number n) taskEffortMap.put(tuid, n.doubleValue());
                }
            }
            Map<String, Integer> tasksByStatus = new LinkedHashMap<>();
            Map<String, int[]> perSprint = new LinkedHashMap<>(); // sprint_id -> [total, done]
            Map<String, double[]> perSprintEffort = new LinkedHashMap<>(); // sprint_id -> [effort_sum]
            for (Map.Entry<String, String> e : taskStatus.entrySet()) {
                String tuid = e.getKey(), cls = e.getValue();
                tasksByStatus.merge(cls, 1, Integer::sum);
                int slash = tuid.indexOf('/');
                if (slash < 0) slash = tuid.indexOf(':');
                String sid = slash > 0 ? tuid.substring(0, slash) : tuid;
                int[] td = perSprint.computeIfAbsent(sid, k -> new int[2]);
                td[0]++;
                if ("done".equals(cls)) td[1]++;
                Double ef = taskEffortMap.get(tuid);
                if (ef != null) perSprintEffort.computeIfAbsent(sid, k -> new double[1])[0] += ef;
            }

            // ── Sprints by status ──
            Map<String, Integer> sprintsByStatus = new LinkedHashMap<>();
            for (Map<String, Object> sp : sprints)
                sprintsByStatus.merge(classifyStatus((String) sp.get("status_raw")), 1, Integer::sum);

            // ── Per-component rollup over explicitly linked sprints ──
            Map<String, List<String>> compSprints = new LinkedHashMap<>();
            for (Map<String, Object> lnk : links) {
                String s = (String) lnk.get("s"), c = (String) lnk.get("c");
                if (s == null || c == null) continue;
                compSprints.computeIfAbsent(c, k -> new ArrayList<>()).add(s);
            }
            Map<String, Map<String, Object>> compMeta = new LinkedHashMap<>();
            for (Map<String, Object> c : comps)
                compMeta.put((String) c.get("component_id"), c);

            List<Map<String, Object>> byComponent = new ArrayList<>();
            for (Map.Entry<String, List<String>> e : compSprints.entrySet()) {
                String cid = e.getKey();
                int total = 0, done = 0;
                for (String sid : e.getValue()) {
                    int[] td = perSprint.get(sid);
                    if (td != null) { total += td[0]; done += td[1]; }
                }
                Map<String, Object> meta = compMeta.getOrDefault(cid, Map.of());
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("component_id", cid);
                row.put("full_name", meta.get("full_name"));
                row.put("area", meta.get("area"));
                row.put("sprint_count", e.getValue().size());
                row.put("task_total", total);
                row.put("task_done", done);
                byComponent.add(row);
            }
            byComponent.sort((a, b) -> ((Integer) b.get("sprint_count")) - ((Integer) a.get("sprint_count")));

            // ── Per-sprint rows (only sprints that have tasks) ──
            Map<String, String> sprintStatusMap = new LinkedHashMap<>();
            for (Map<String, Object> sp : sprints)
                sprintStatusMap.put((String) sp.get("sprint_id"), (String) sp.get("status_raw"));
            List<Map<String, Object>> bySprint = new ArrayList<>();
            for (Map.Entry<String, int[]> e : perSprint.entrySet()) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("sprint_id", e.getKey());
                row.put("status_raw", sprintStatusMap.get(e.getKey()));
                row.put("task_total", e.getValue()[0]);
                row.put("task_done", e.getValue()[1]);
                double[] ef = perSprintEffort.get(e.getKey());
                if (ef != null) row.put("effort_days_sum", Math.round(ef[0] * 10.0) / 10.0);
                bySprint.add(row);
            }
            bySprint.sort((a, b) -> ((Integer) b.get("task_total")) - ((Integer) a.get("task_total")));

            // ── Releases by project ──
            Map<String, Integer> relByProject = new LinkedHashMap<>();
            List<String> currentTags = new ArrayList<>();
            for (Map<String, Object> r : releases) {
                String p = (String) r.get("git_project");
                relByProject.merge(p == null ? "—" : p, 1, Integer::sum);
                if (Boolean.TRUE.equals(r.get("is_current"))) currentTags.add((String) r.get("git_tag"));
            }

            int taskTotal = taskStatus.size();
            int taskDone = tasksByStatus.getOrDefault("done", 0);
            Map<String, Object> totals = new LinkedHashMap<>();
            totals.put("sprints", sprints.size());
            totals.put("tasks", taskTotal);
            totals.put("tasks_done", taskDone);
            totals.put("releases", releases.size());
            totals.put("components", comps.size());

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("totals", totals);
            out.put("tasks_by_status", tasksByStatus);
            out.put("sprints_by_status", sprintsByStatus);
            out.put("by_component", byComponent);
            out.put("by_sprint", bySprint);
            out.put("releases_by_project", relByProject);
            out.put("current_releases", currentTags);
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE ANALYTICS] %s", e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
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
            // Sprint is the source of truth: after flipping the sprint's status, push
            // the same status token onto every plan_item that REPRESENTS it, so plan
            // bars never drift (covers both MCP lore_set_status and the UI).
            case "sprint"    -> updateScd2Status("sprint", "KnowSprint", "KnowSprintHist",
                                    "sprint_id", req.id(), req.status(), now, nsid)
                                  .chain(resp -> resp.getStatus() >= 300
                                    ? Uni.createFrom().item(resp)
                                    : propagateSprintStatusToPlanItems(req.id(), req.status(), now)
                                        .replaceWith(resp));
            case "task"      -> updateScd2Status("task", "KnowTask", "KnowTaskHist",
                                    "task_uid", req.id(), req.status(), now, nsid);
            // MCP-PHASES: same SCD2 flip as sprint/task — KnowPhase carries HAS_STATE → KnowPhaseHist
            case "phase"     -> updateScd2Status("phase", "KnowPhase", "KnowPhaseHist",
                                    "phase_uid", req.id(), req.status(), now, nsid);
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

    /**
     * Mirror a sprint's new status token onto every PlanItem that REPRESENTS it.
     * Best-effort: a failure here is logged but never fails the sprint update — the
     * sprint stays the source of truth and the board's read-time sync covers any gap.
     */
    private Uni<Void> propagateSprintStatusToPlanItems(String sprintId, String token, String now) {
        MartQuery q = new MartQuery("sql",
            "SELECT item_id FROM PlanItem WHERE out('REPRESENTS').sprint_id CONTAINS :sid",
            Map.of("sid", sprintId), -1);
        return client.query(db, basicAuth(), q)
            .chain(res -> {
                List<Map<String, Object>> rows = res.result() != null ? res.result() : List.of();
                Uni<Void> chain = Uni.createFrom().voidItem();
                for (Map<String, Object> r : rows) {
                    final String itemId = String.valueOf(r.get("item_id"));
                    if (itemId == null || itemId.isEmpty() || "null".equals(itemId)) continue;
                    chain = chain.chain(__ -> updatePlanItemStatus(
                        itemId, token, now, UUID.randomUUID().toString()).replaceWithVoid());
                }
                return chain;
            })
            .onFailure().recoverWithItem(ex -> {
                LOG.warnf("[LORE STATUS] propagate sprint=%s → plan_item failed: %s", sprintId, ex.getMessage());
                return null;
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
        if (req.phase_uid() != null && !SAFE_ID.matcher(req.phase_uid()).matches()) {
            return Uni.createFrom().item(badParams("phase_uid contains illegal characters"));
        }
        final String sid   = req.sprint_id();
        final String tid   = req.task_id();
        final String uid   = sid + "/" + tid;
        final String title = req.title().trim();
        final String note  = req.note_md();
        final String phase = req.phase_uid();
        final String now   = Instant.now().toString();
        final String nsid  = UUID.randomUUID().toString();

        // MCP-PHASES: a phase must exist and belong to THIS sprint (phase_uid = "<sprint>/PHASE_x")
        if (phase != null && !phase.startsWith(sid + "/")) {
            return Uni.createFrom().item(badParams(
                "phase_uid must belong to sprint " + sid + " (got: " + phase + ")"));
        }

        // order_index = max existing for this sprint + 1 (tasks keyed task_uid = "<sprint>/<id>").
        // Exact-prefix match via substring, NOT LIKE: '_' in sprint ids is a LIKE wildcard
        // ("any one char"), so LIKE :prefix could count same-shaped uids from OTHER sprints.
        String prefix = sid + "/";
        MartQuery maxQ = new MartQuery("sql",
            "SELECT max(order_index) AS mx FROM KnowTask WHERE task_uid.substring(0, :plen) = :prefix",
            Map.of("prefix", prefix, "plen", prefix.length()), -1);

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
                    // MCP-PHASES: optional task → phase attachment (tasks_of_phase reads out('IN_PHASE'))
                    .chain(__ -> phase == null
                        ? Uni.createFrom().item((LoreCommandClient.LoreCommandResult) null)
                        : writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                            "CREATE EDGE IN_PHASE FROM (SELECT FROM KnowTask WHERE task_uid = :uid) " +
                            "TO (SELECT FROM KnowPhase WHERE phase_uid = :puid)",
                            Map.of("uid", uid, "puid", phase))))
                    .map(__ -> noStore(Response.ok(new TaskWriteResponse(true, uid, tid, order))));
            })
            .onFailure().recoverWithItem(ex -> {
                LOG.warnf("[LORE TASK CREATE] %s: %s", uid, ex.getMessage());
                return noStore(Response.status(Response.Status.BAD_GATEWAY)
                    .entity(new LoreError("LORE_UPSTREAM", ex.getMessage())));
            });
    }

    // ── Write-path: sprint phases (MCP-PHASES, SPRINT_LORE_MCP_GAPS_2) ────────
    // Read side already exists (phases_of_sprint / tasks_of_phase, LoreSlices): KnowPhase
    // { phase_uid = "<sprint>/PHASE_<KEY>", phase_id = "Фаза <KEY>", order_index }
    // + PART_OF → KnowSprint + HAS_STATE → KnowPhaseHist; task → phase via IN_PHASE.

    @POST
    @Path("phase")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Uni<Response> createPhase(PhaseCreateRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return Uni.createFrom().item(disabled());
        Response guard = requireAdmin(role);
        if (guard != null) return Uni.createFrom().item(guard);
        if (req == null || req.sprint_id() == null || req.phase_key() == null || req.phase_key().isBlank()) {
            return Uni.createFrom().item(badParams("sprint_id, phase_key required"));
        }
        final String key = req.phase_key().trim().toUpperCase();
        if (!SAFE_ID.matcher(req.sprint_id()).matches()
                || !key.matches("[A-Z0-9_\\-]{1,20}")) {
            return Uni.createFrom().item(badParams(
                "sprint_id / phase_key contain illegal characters (key: A-Z, 0-9, _, -)"));
        }
        final String sid     = req.sprint_id();
        final String uid     = sid + "/PHASE_" + key;
        final String display = "Фаза " + key;
        final String name    = req.name();
        final String now     = Instant.now().toString();
        final String nsid    = UUID.randomUUID().toString();

        MartQuery existingQ = new MartQuery("sql",
            "SELECT phase_uid, order_index FROM KnowPhase WHERE phase_uid = :uid LIMIT 1",
            Map.of("uid", uid), -1);

        return client.query(db, basicAuth(), existingQ)
            .chain(res -> {
                List<Map<String, Object>> rows = res.result() != null ? res.result() : List.of();
                if (!rows.isEmpty()) {   // idempotent: phase already registered
                    Object oi = rows.get(0).get("order_index");
                    return Uni.createFrom().item(noStore(Response.ok(new PhaseWriteResponse(
                        true, uid, display, oi instanceof Number n ? n.intValue() : null, false))));
                }
                MartQuery sprintQ = new MartQuery("sql",
                    "SELECT sprint_id FROM KnowSprint WHERE sprint_id = :sid LIMIT 1",
                    Map.of("sid", sid), -1);
                return client.query(db, basicAuth(), sprintQ).chain(sres -> {
                    if (sres.result() == null || sres.result().isEmpty()) {
                        return Uni.createFrom().item(badParams("sprint not found: " + sid));
                    }
                    // order_index: explicit or max+1 among this sprint's phases (substring, not LIKE —
                    // same '_'-wildcard pitfall as createTask)
                    String prefix = sid + "/";
                    MartQuery maxQ = new MartQuery("sql",
                        "SELECT max(order_index) AS mx FROM KnowPhase WHERE phase_uid.substring(0, :plen) = :prefix",
                        Map.of("prefix", prefix, "plen", prefix.length()), -1);
                    return client.query(db, basicAuth(), maxQ).chain(mres -> {
                        List<Map<String, Object>> mrows = mres.result() != null ? mres.result() : List.of();
                        Object mxRaw = mrows.isEmpty() ? null : mrows.get(0).get("mx");
                        final int order = req.order_index() != null ? req.order_index()
                            : (mxRaw instanceof Number n ? n.intValue() : 0) + 1;
                        return writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                                "INSERT INTO KnowPhase SET phase_uid = :uid, phase_id = :pid, name = :name, " +
                                "order_index = :oi, src = 'manual'",
                                mapOfNullable("uid", uid, "pid", display, "name", name, "oi", order)))
                            .chain(__ -> writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                                "CREATE EDGE PART_OF FROM (SELECT FROM KnowPhase WHERE phase_uid = :uid) " +
                                "TO (SELECT FROM KnowSprint WHERE sprint_id = :sid)",
                                Map.of("uid", uid, "sid", sid))))
                            .chain(__ -> writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                                "INSERT INTO KnowPhaseHist SET state_uid = :nsid, status_raw = '📋 PLANNED', " +
                                "valid_from = :now",
                                Map.of("nsid", nsid, "now", now))))
                            .chain(__ -> writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                                "CREATE EDGE HAS_STATE FROM (SELECT FROM KnowPhase WHERE phase_uid = :uid) " +
                                "TO (SELECT FROM KnowPhaseHist WHERE state_uid = :nsid)",
                                Map.of("uid", uid, "nsid", nsid))))
                            .map(__ -> noStore(Response.ok(new PhaseWriteResponse(true, uid, display, order, true))));
                    });
                });
            })
            .onFailure().recoverWithItem(ex -> {
                LOG.warnf("[LORE PHASE CREATE] %s: %s", uid, ex.getMessage());
                return noStore(Response.status(Response.Status.BAD_GATEWAY)
                    .entity(new LoreError("LORE_UPSTREAM", ex.getMessage())));
            });
    }

    @POST
    @Path("task/phase")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkTaskPhase(TaskPhaseRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.task_uid() == null)
            return badParams("task_uid required");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        if (req.phase_uid() == null && !remove)
            return badParams("phase_uid required for action=add (omit only with action=remove to detach all)");
        if (!SAFE_ID.matcher(req.task_uid()).matches()
                || (req.phase_uid() != null && !SAFE_ID.matcher(req.phase_uid()).matches()))
            return badParams("ids contain illegal characters");
        try {
            if (ingestService.queryPublic(
                    "SELECT task_uid FROM KnowTask WHERE task_uid=:t LIMIT 1",
                    Map.of("t", req.task_uid())).isEmpty())
                return badParams("task not found: " + req.task_uid());
            if (req.phase_uid() != null && ingestService.queryPublic(
                    "SELECT phase_uid FROM KnowPhase WHERE phase_uid=:p LIMIT 1",
                    Map.of("p", req.phase_uid())).isEmpty())
                return badParams("phase not found: " + req.phase_uid());
            // task and phase must share the sprint prefix ("SPRINT_X/…")
            if (req.phase_uid() != null) {
                String taskSprint  = req.task_uid().substring(0, Math.max(0, req.task_uid().indexOf('/')));
                String phaseSprint = req.phase_uid().substring(0, Math.max(0, req.phase_uid().indexOf('/')));
                if (!taskSprint.equals(phaseSprint))
                    return badParams("task and phase belong to different sprints: "
                        + taskSprint + " vs " + phaseSprint);
            }
            if (remove) {
                String where = req.phase_uid() != null
                    ? "@out.task_uid=:t AND @in.phase_uid=:p"
                    : "@out.task_uid=:t";
                Map<String, Object> params = req.phase_uid() != null
                    ? Map.of("t", req.task_uid(), "p", req.phase_uid())
                    : Map.of("t", req.task_uid());
                List<Map<String, Object>> edges = ingestService.queryPublic(
                    "SELECT @rid FROM IN_PHASE WHERE " + where, params);
                for (Map<String, Object> e : edges) {
                    String rid = e.get("@rid").toString();
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM IN_PHASE WHERE @rid=" + rid, null)).await().indefinitely();
                }
            } else {
                List<Map<String, Object>> existing = ingestService.queryPublic(
                    "SELECT @rid FROM IN_PHASE WHERE @out.task_uid=:t AND @in.phase_uid=:p",
                    Map.of("t", req.task_uid(), "p", req.phase_uid()));
                if (existing.isEmpty()) {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        String.format(
                            "CREATE EDGE IN_PHASE FROM (SELECT FROM KnowTask WHERE task_uid='%s') " +
                            "TO (SELECT FROM KnowPhase WHERE phase_uid='%s')",
                            req.task_uid(), req.phase_uid()),
                        null)).await().indefinitely();
                }
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("task_uid", req.task_uid());
            out.put("phase_uid", req.phase_uid());
            out.put("action", remove ? "removed" : "added");
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE TASK PHASE] %s / %s: %s", req.task_uid(), req.phase_uid(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
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
                writeClient.command(db, basicAuth(),
                    taskVertexUpdate(req.task_uid(), req.title(), req.note_md(), req.effort_days()))
                    .await().indefinitely();
                mirrorTaskHist(req.task_uid(), req.note_md(), req.effort_days()).await().indefinitely();
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

    /**
     * Dynamic vertex update for task edits — LH-44: only SET fields actually supplied,
     * so a title-only edit never wipes note_md/effort_days denormalised on the vertex
     * (the UI reads the hist row, but the vertex copy must stay consistent too).
     */
    private static LoreCommandClient.LoreCommand taskVertexUpdate(
            String uid, String title, String noteMd, Integer effortDays) {
        StringBuilder sql = new StringBuilder("UPDATE KnowTask SET title = :title");
        Map<String, Object> p = new java.util.HashMap<>();
        p.put("uid", uid);
        p.put("title", title.trim());
        if (noteMd != null)     { sql.append(", note_md = :note");     p.put("note", noteMd); }
        if (effortDays != null) { sql.append(", effort_days = :eff");  p.put("eff", effortDays); }
        sql.append(" WHERE task_uid = :uid");
        return new LoreCommandClient.LoreCommand("sql", sql.toString(), p);
    }

    /**
     * Mirror note_md / effort_days onto a task's OPEN history row (KnowTaskHist,
     * valid_to IS NULL) — the row the tasks_of_sprint / tasks_of_phase slices read.
     * Only fields actually supplied (non-null) are written, so a title-only edit
     * never wipes an existing note or effort. No-op (passthrough) when both are null.
     */
    private Uni<LoreCommandClient.LoreCommandResult> mirrorTaskHist(
            String uid, String noteMd, Integer effortDays) {
        StringBuilder set = new StringBuilder();
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("uid", uid);
        if (noteMd != null)     { set.append("note_md = :note, ");     p.put("note", noteMd); }
        if (effortDays != null) { set.append("effort_days = :eff, ");  p.put("eff", effortDays); }
        if (set.length() == 0) return Uni.createFrom().item(new LoreCommandClient.LoreCommandResult(null));
        return writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
            "UPDATE KnowTaskHist SET " + set.substring(0, set.length() - 2) +
            " WHERE in('HAS_STATE').task_uid CONTAINS :uid AND valid_to IS NULL", p));
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
        return writeClient.command(db, basicAuth(),
                taskVertexUpdate(uid, req.title(), req.note_md(), req.effort_days()))
            // The vertex note_md/effort_days above are denormalisations the UI never reads.
            // tasks_of_sprint / tasks_of_phase read BOTH from the open KnowTaskHist row
            // (out('HAS_STATE')[…][0]); mirror the write there too — only for fields that
            // were actually supplied, so a title-only edit never wipes note/effort.
            .chain(__ -> mirrorTaskHist(uid, req.note_md(), req.effort_days()))
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
            // SCD2 write contract: the sprints slice reads priority ONLY from the hist
            // chain (out('HAS_STATE')[priority IS NOT NULL].priority[0]) — a vertex-only
            // write is never visible. Mirror it onto the open hist row (same pattern as
            // pr_refs). Matched by HAS_STATE + valid_to, not state_uid (legacy-null safe).
            if (req.priority() != null) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "UPDATE KnowSprintHist SET priority=:prio " +
                    "WHERE in('HAS_STATE').sprint_id[0] = :sid AND valid_to IS NULL",
                    Map.of("prio", req.priority(), "sid", req.sprint_id()))).await().indefinitely();
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true); out.put("sprint_id", req.sprint_id());
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE SPRINT UPDATE] %s: %s", req.sprint_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Write-path: set sprint track (ON_TRACK edge on KnowPlanItem) ─────────

    public record SprintTrackRequest(String sprint_id, String track_id) {}

    @POST
    @Path("sprint/track")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response setSprintTrack(SprintTrackRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.sprint_id() == null || req.sprint_id().isBlank())
            return badParams("sprint_id required");
        try {
            // DELETE EDGE doesn't work in ArcadeDB — SELECT @rid + DELETE FROM
            List<Map<String, Object>> edges = ingestService.queryPublic(
                "SELECT @rid FROM ON_TRACK WHERE @out.represents_sprint = :sid",
                Map.of("sid", req.sprint_id()));
            for (Map<String, Object> e : edges) {
                String rid = e.get("@rid").toString();
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM ON_TRACK WHERE @rid=" + rid, null)).await().indefinitely();
            }
            if (req.track_id() != null && !req.track_id().isBlank()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    String.format(
                        "CREATE EDGE ON_TRACK " +
                        "FROM (SELECT FROM KnowPlanItem WHERE represents_sprint='%s' LIMIT 1) " +
                        "TO (SELECT FROM PlanTrack WHERE track_id='%s' LIMIT 1)",
                        req.sprint_id(), req.track_id()),
                    null)).await().indefinitely();
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true); out.put("sprint_id", req.sprint_id()); out.put("track_id", req.track_id());
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE SPRINT TRACK] %s: %s", req.sprint_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Write-path: link plan-item ↔ milestone (CONTRIBUTES_TO) ─────────────

    public record PlanItemMilestoneRequest(String item_id, String milestone_id, String action) {}

    @POST
    @Path("plan-item/milestone")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response updatePlanItemMilestone(PlanItemMilestoneRequest req,
                                            @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.item_id() == null || req.item_id().isBlank())
            return badParams("item_id required");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            // DELETE EDGE doesn't work in ArcadeDB — SELECT @rid + DELETE FROM
            List<Map<String, Object>> edges = ingestService.queryPublic(
                "SELECT @rid FROM CONTRIBUTES_TO WHERE @out.item_id=:iid" +
                (req.milestone_id() != null ? " AND @in.milestone_id=:mid" : ""),
                req.milestone_id() != null
                    ? Map.of("iid", req.item_id(), "mid", req.milestone_id())
                    : Map.of("iid", req.item_id()));
            for (Map<String, Object> e : edges) {
                String rid = e.get("@rid").toString();
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM CONTRIBUTES_TO WHERE @rid=" + rid, null)).await().indefinitely();
            }
            if (!remove && req.milestone_id() != null && !req.milestone_id().isBlank()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    String.format(
                        "CREATE EDGE CONTRIBUTES_TO " +
                        "FROM (SELECT FROM PlanItem WHERE item_id='%s' LIMIT 1) " +
                        "TO   (SELECT FROM KnowMilestone WHERE milestone_id='%s' LIMIT 1)",
                        req.item_id(), req.milestone_id()),
                    null)).await().indefinitely();
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true); out.put("item_id", req.item_id());
            out.put("milestone_id", req.milestone_id()); out.put("action", remove ? "removed" : "added");
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE PLAN-ITEM MILESTONE] %s / %s: %s", req.item_id(), req.milestone_id(), e.getMessage());
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
                // DELETE EDGE doesn't work in ArcadeDB — SELECT @rid + DELETE FROM
                List<Map<String, Object>> edges = ingestService.queryPublic(
                    "SELECT @rid FROM BELONGS_TO_PROJECT WHERE @out.sprint_id=:sid AND @in.slug=:gp",
                    Map.of("sid", req.sprint_id(), "gp", req.git_project()));
                for (Map<String, Object> e : edges) {
                    String rid = e.get("@rid").toString();
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM BELONGS_TO_PROJECT WHERE @rid=" + rid, null)).await().indefinitely();
                }
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

    // ── Write-path: link sprint ↔ milestone (TARGETS_MILESTONE) ──────────────
    // Direct edge so the milestone-management UI can link ANY sprint (not only
    // the 160/186 that have a plan-item bridge). Read paths union both sources.

    public record SprintMilestoneRequest(String sprint_id, String milestone_id, String action) {}

    @POST
    @Path("milestone/sprint")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkSprintMilestone(SprintMilestoneRequest req,
                                        @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.sprint_id() == null || req.milestone_id() == null)
            return badParams("sprint_id and milestone_id required");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            if (remove) {
                // DELETE EDGE doesn't work in ArcadeDB — SELECT @rid + DELETE FROM
                List<Map<String, Object>> edges = ingestService.queryPublic(
                    "SELECT @rid FROM TARGETS_MILESTONE WHERE @out.sprint_id=:sid AND @in.milestone_id=:mid",
                    Map.of("sid", req.sprint_id(), "mid", req.milestone_id()));
                for (Map<String, Object> e : edges) {
                    String rid = e.get("@rid").toString();
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM TARGETS_MILESTONE WHERE @rid=" + rid, null)).await().indefinitely();
                }
            } else {
                List<Map<String, Object>> existing = ingestService.queryPublic(
                    "SELECT @rid FROM TARGETS_MILESTONE WHERE @out.sprint_id=:sid AND @in.milestone_id=:mid",
                    Map.of("sid", req.sprint_id(), "mid", req.milestone_id()));
                if (existing.isEmpty()) {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "CREATE EDGE TARGETS_MILESTONE " +
                        "FROM (SELECT FROM KnowSprint WHERE sprint_id=:sid) " +
                        "TO   (SELECT FROM KnowMilestone WHERE milestone_id=:mid)",
                        Map.of("sid", req.sprint_id(), "mid", req.milestone_id()))).await().indefinitely();
                }
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true); out.put("sprint_id", req.sprint_id());
            out.put("milestone_id", req.milestone_id()); out.put("action", remove ? "removed" : "added");
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE SPRINT MILESTONE] %s / %s: %s", req.sprint_id(), req.milestone_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Write-path: upsert milestone (create / edit label, week, date, goal) ──

    public record MilestoneRequest(String milestone_id, String label, Integer week,
                                   String date_display, String goal_md, String priority) {}

    @POST
    @Path("milestone")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertMilestone(MilestoneRequest req,
                                    @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.milestone_id() == null || req.milestone_id().isBlank())
            return badParams("milestone_id required");
        try {
            // Upsert the milestone vertex — LH-44: only SET fields actually provided,
            // a partial call (e.g. priority-only) must not wipe label/week/date_display.
            StringBuilder msql = new StringBuilder("UPDATE KnowMilestone SET milestone_id=:mid");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("mid", req.milestone_id());
            if (req.label() != null)        { msql.append(", label=:lbl");       p.put("lbl",  req.label()); }
            if (req.week() != null)         { msql.append(", week=:wk");         p.put("wk",   req.week()); }
            if (req.date_display() != null) { msql.append(", date_display=:dd"); p.put("dd",   req.date_display()); }
            if (req.priority() != null)     { msql.append(", priority=:prio");   p.put("prio", req.priority()); }
            msql.append(" UPSERT WHERE milestone_id=:mid");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                msql.toString(), p)).await().indefinitely();
            // Goal text lives in the current HAS_STATE hist row — update it if provided.
            if (req.goal_md() != null) {
                List<Map<String, Object>> hist = ingestService.queryPublic(
                    "SELECT @rid FROM (SELECT expand(out('HAS_STATE')) FROM KnowMilestone " +
                    "WHERE milestone_id=:mid) WHERE valid_to IS NULL", Map.of("mid", req.milestone_id()));
                if (!hist.isEmpty()) {
                    String rid = hist.get(0).get("@rid").toString();
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "UPDATE " + rid + " SET goal_md=:g", Map.of("g", req.goal_md()))).await().indefinitely();
                }
            }
            return noStore(Response.ok(Map.of("ok", true, "milestone_id", req.milestone_id())));
        } catch (Exception e) {
            LOG.warnf("[LORE MILESTONE] %s: %s", req.milestone_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Write-path: link sprint ↔ component (BELONGS_TO) ─────────────────────
    // An explicit sprint→component link. When present it OVERRIDES the fuzzy
    // naming-convention match (sprint_id LIKE %component_key%) used by the
    // component_sprints / sprint-module-badges read paths.

    public record SprintComponentRequest(String sprint_id, String component_id, String action) {}

    @POST
    @Path("sprint/component")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkSprintComponent(SprintComponentRequest req,
                                        @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.sprint_id() == null || req.component_id() == null)
            return badParams("sprint_id and component_id required");
        if (!SAFE_ID.matcher(req.sprint_id()).matches() || !SAFE_ID.matcher(req.component_id()).matches())
            return badParams("ids contain illegal characters");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            // Validate both endpoints exist — CREATE EDGE FROM/TO an empty subquery is a
            // silent no-op (returns ok but writes nothing), so a typo'd component_id would
            // quietly do nothing. Fail loudly instead.
            if (ingestService.queryPublic(
                    "SELECT sprint_id FROM KnowSprint WHERE sprint_id=:s LIMIT 1",
                    Map.of("s", req.sprint_id())).isEmpty())
                return badParams("sprint not found: " + req.sprint_id());
            if (ingestService.queryPublic(
                    "SELECT component_id FROM LoreComponent WHERE component_id=:c LIMIT 1",
                    Map.of("c", req.component_id())).isEmpty())
                return badParams("component not found: " + req.component_id());
            if (remove) {
                // DELETE EDGE doesn't work in ArcadeDB — SELECT @rid + DELETE FROM
                List<Map<String, Object>> edges = ingestService.queryPublic(
                    "SELECT @rid FROM BELONGS_TO WHERE @out.sprint_id=:s AND @in.component_id=:c",
                    Map.of("s", req.sprint_id(), "c", req.component_id()));
                for (Map<String, Object> e : edges) {
                    String rid = e.get("@rid").toString();
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM BELONGS_TO WHERE @rid=" + rid, null)).await().indefinitely();
                }
            } else {
                // Idempotent: skip if already linked
                List<Map<String, Object>> existing = ingestService.queryPublic(
                    "SELECT @rid FROM BELONGS_TO WHERE @out.sprint_id=:s AND @in.component_id=:c",
                    Map.of("s", req.sprint_id(), "c", req.component_id()));
                if (existing.isEmpty()) {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        String.format(
                            "CREATE EDGE BELONGS_TO FROM (SELECT FROM KnowSprint WHERE sprint_id='%s') " +
                            "TO (SELECT FROM LoreComponent WHERE component_id='%s')",
                            req.sprint_id(), req.component_id()),
                        null)).await().indefinitely();
                }
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("sprint_id", req.sprint_id());
            out.put("component_id", req.component_id());
            out.put("action", remove ? "removed" : "added");
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE SPRINT COMPONENT] %s / %s: %s", req.sprint_id(), req.component_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Write-path: link task ↔ component (TAGGED_WITH) ─────────────────────
    // Many-to-many: a task can be tagged with 0..N components.
    // Uses TAGGED_WITH (distinct from sprint→component BELONGS_TO) so that
    // analytics queries filtering on BELONGS_TO are unaffected.

    public record TaskComponentRequest(String task_uid, String component_id, String action) {}

    @POST
    @Path("task/component")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkTaskComponent(TaskComponentRequest req,
                                      @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.task_uid() == null || req.component_id() == null)
            return badParams("task_uid and component_id required");
        if (!SAFE_ID.matcher(req.task_uid()).matches() || !SAFE_ID.matcher(req.component_id()).matches())
            return badParams("ids contain illegal characters");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            if (ingestService.queryPublic(
                    "SELECT task_uid FROM KnowTask WHERE task_uid=:t LIMIT 1",
                    Map.of("t", req.task_uid())).isEmpty())
                return badParams("task not found: " + req.task_uid());
            if (ingestService.queryPublic(
                    "SELECT component_id FROM LoreComponent WHERE component_id=:c LIMIT 1",
                    Map.of("c", req.component_id())).isEmpty())
                return badParams("component not found: " + req.component_id());
            if (remove) {
                List<Map<String, Object>> edges = ingestService.queryPublic(
                    "SELECT @rid FROM TAGGED_WITH WHERE @out.task_uid=:t AND @in.component_id=:c",
                    Map.of("t", req.task_uid(), "c", req.component_id()));
                for (Map<String, Object> e : edges) {
                    String rid = e.get("@rid").toString();
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM TAGGED_WITH WHERE @rid=" + rid, null)).await().indefinitely();
                }
            } else {
                List<Map<String, Object>> existing = ingestService.queryPublic(
                    "SELECT @rid FROM TAGGED_WITH WHERE @out.task_uid=:t AND @in.component_id=:c",
                    Map.of("t", req.task_uid(), "c", req.component_id()));
                if (existing.isEmpty()) {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        String.format(
                            "CREATE EDGE TAGGED_WITH FROM (SELECT FROM KnowTask WHERE task_uid='%s') " +
                            "TO (SELECT FROM LoreComponent WHERE component_id='%s')",
                            req.task_uid(), req.component_id()),
                        null)).await().indefinitely();
                }
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("task_uid", req.task_uid());
            out.put("component_id", req.component_id());
            out.put("action", remove ? "removed" : "added");
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE TASK COMPONENT] %s / %s: %s", req.task_uid(), req.component_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Write-path: link sprint ↔ sprint (DEPENDS_ON) ────────────────────────

    public record SprintDepRequest(String from_sprint, String to_sprint, String kind, String reason, String action) {}

    @POST
    @Path("sprint/dep")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkSprintDep(SprintDepRequest req,
                                  @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.from_sprint() == null || req.to_sprint() == null)
            return badParams("from_sprint and to_sprint required");
        if (!SAFE_ID.matcher(req.from_sprint()).matches() || !SAFE_ID.matcher(req.to_sprint()).matches())
            return badParams("sprint ids contain illegal characters");
        if (req.from_sprint().equals(req.to_sprint()))
            return badParams("self-loop not allowed");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            if (remove) {
                // DELETE EDGE doesn't work in ArcadeDB — use SELECT @rid + DELETE FROM
                List<Map<String, Object>> edges = ingestService.queryPublic(
                    "SELECT @rid FROM DEPENDS_ON WHERE @out.sprint_id=:f AND @in.sprint_id=:t",
                    Map.of("f", req.from_sprint(), "t", req.to_sprint()));
                for (Map<String, Object> e : edges) {
                    String rid = e.get("@rid").toString();
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM DEPENDS_ON WHERE @rid=" + rid, null)).await().indefinitely();
                }
            } else {
                // Cycle guard: if to_sprint can reach from_sprint → adding edge creates a cycle
                // @depth is not filterable in ArcadeDB TRAVERSE; self-loop guard above
                // already ensures from != to, so sprint_id=from_sprint at any depth = cycle
                List<Map<String, Object>> cycleCheck = ingestService.queryPublic(
                    "SELECT sprint_id FROM (TRAVERSE out('DEPENDS_ON') FROM " +
                    "(SELECT FROM KnowSprint WHERE sprint_id=:t) MAXDEPTH 50) " +
                    "WHERE sprint_id=:f",
                    Map.of("t", req.to_sprint(), "f", req.from_sprint()));
                if (!cycleCheck.isEmpty())
                    return badParams("cycle detected: " + req.to_sprint() + " already depends (transitively) on " + req.from_sprint());
                // Idempotent: skip if already linked
                List<Map<String, Object>> existing = ingestService.queryPublic(
                    "SELECT @rid FROM DEPENDS_ON WHERE @out.sprint_id=:f AND @in.sprint_id=:t",
                    Map.of("f", req.from_sprint(), "t", req.to_sprint()));
                if (existing.isEmpty()) {
                    // Named params don't work for CREATE EDGE in ArcadeDB — use String.format
                    String kind   = req.kind() != null && !req.kind().isBlank() ? req.kind() : "soft";
                    String reason = req.reason() != null ? req.reason().replace("'", "\\'").replace("\n", " ") : "";
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        String.format(
                            "CREATE EDGE DEPENDS_ON FROM (SELECT FROM KnowSprint WHERE sprint_id='%s') " +
                            "TO (SELECT FROM KnowSprint WHERE sprint_id='%s') " +
                            "SET kind='%s', reason='%s'",
                            req.from_sprint(), req.to_sprint(), kind, reason),
                        null)).await().indefinitely();
                }
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("from_sprint", req.from_sprint());
            out.put("to_sprint", req.to_sprint());
            out.put("action", remove ? "removed" : "added");
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE SPRINT DEP] %s → %s: %s", req.from_sprint(), req.to_sprint(), e.getMessage());
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
            // LH-44: date_created/component_id only SET when provided (or on first
            // insert) — previously a partial amend call with neither field would reset
            // date_created to today and null out component_id. Found alongside the
            // context_md/decision_md/consequences_md bug fixed above, 2026-07-02.
            StringBuilder upsertSql = new StringBuilder("UPDATE KnowADR SET adr_id=:adr_id, name=:name");
            Map<String, Object> upsertP = mapOfNullable("adr_id", req.adr_id(), "name", req.name());
            if (req.date_created() != null) {
                upsertSql.append(", date_created=:date_created");
                upsertP.put("date_created", req.date_created());
            } else if (isNewAdr) {
                upsertSql.append(", date_created=:date_created");
                upsertP.put("date_created", java.time.LocalDate.now().toString());
            }
            if (req.component_id() != null) {
                upsertSql.append(", component_id=:component_id");
                upsertP.put("component_id", req.component_id());
            }
            if (req.file_path() != null) {
                upsertSql.append(", file_path=:file_path");
                upsertP.put("file_path", req.file_path());
            }
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
                    "SELECT @rid as rid, state_uid FROM KnowADRHist " +
                    "WHERE in('HAS_STATE').adr_id[0] = :id AND valid_to IS NULL LIMIT 1",
                    Map.of("id", req.adr_id())))
                .await().indefinitely().result();

            boolean histCreated;
            if (histRows != null && !histRows.isEmpty()) {
                // Step 3a: update body fields on the existing open hist row — SAME null-safe
                // pattern as status above (LH-44): only SET fields that were actually provided.
                // Previously this unconditionally SET context_md/decision_md/consequences_md to
                // whatever was passed, including null — a partial amend call (e.g. only
                // decision_md to fix a typo) would silently WIPE the other two sections. Found
                // 2026-07-02 while wiring up an "amend ADR body" workflow.
                //
                // Match by @rid, not state_uid: 59/83 open KnowADRHist rows (bulk-imported
                // pre-MCP, e.g. ADR-HND-STMTGEOID-STABILITY, ADR-HND-019/021, ADR-SHT-001)
                // have state_uid=null. WHERE state_uid=:sid with a null business key bound
                // String.valueOf(null)="null" — matched zero rows, so every amend call on
                // those ADRs silently no-op'd with no error. @rid is always non-null/unique.
                // Found 2026-07-02 debugging why body edits weren't landing on real ADRs.
                Object rid = histRows.get(0).get("rid");
                Object existingSid = histRows.get(0).get("state_uid");
                StringBuilder histSql = new StringBuilder("UPDATE KnowADRHist SET ");
                Map<String, Object> histUpdP = new java.util.HashMap<>();
                histUpdP.put("rid", rid);
                boolean first = true;
                if (existingSid == null) {
                    // Backfill the missing business key while we're touching this row anyway.
                    histSql.append("state_uid=:nsid");
                    histUpdP.put("nsid", nsid);
                    first = false;
                }
                if (req.context_md() != null)      { histSql.append(first ? "" : ", ").append("context_md=:ctx");       histUpdP.put("ctx", req.context_md());      first = false; }
                if (req.decision_md() != null)     { histSql.append(first ? "" : ", ").append("decision_md=:dec");      histUpdP.put("dec", req.decision_md());     first = false; }
                if (req.consequences_md() != null) { histSql.append(first ? "" : ", ").append("consequences_md=:con");  histUpdP.put("con", req.consequences_md()); first = false; }
                if (!first) {
                    histSql.append(" WHERE @rid=:rid");
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        histSql.toString(), histUpdP)).await().indefinitely();
                }
                // else: no body fields provided at all (e.g. a pure status/edges-only call) — leave the hist row untouched.
                histCreated = false;
            } else {
                Map<String, Object> histP = mapOfNullable(
                    "ctx", req.context_md(),
                    "dec", req.decision_md(),
                    "con", req.consequences_md());
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
            // Explicit body signal — hist_created:false alone reads ambiguously
            // ("did my body land?"); body_written says whether any of the three
            // body sections was actually persisted this call.
            out.put("body_written", req.context_md() != null
                || req.decision_md() != null || req.consequences_md() != null);
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE ADR CREATE] %s: %s", req.adr_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Write-path: ADR ↔ sprint/release links, rename, delete ──────────────
    public record AdrLinkRequest(String adr_id, String sprint_id, String release_id,
                                 String git_project, String action) {}
    public record AdrRenameRequest(String adr_id, String new_adr_id) {}
    public record AdrDeleteRequest(String adr_id) {}

    @POST
    @Path("adr/link")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkAdr(AdrLinkRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.adr_id() == null || req.adr_id().isBlank())
            return badParams("adr_id required");
        boolean toSprint  = req.sprint_id()  != null && !req.sprint_id().isBlank();
        boolean toRelease = req.release_id() != null && !req.release_id().isBlank();
        if (toSprint == toRelease)
            return badParams("exactly one of sprint_id / release_id required");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            if (toSprint) {
                if (remove) {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM (SELECT expand(outE('IMPLEMENTED_IN')) FROM KnowADR WHERE adr_id=:id) " +
                        "WHERE @in.sprint_id = :sid",
                        Map.of("id", req.adr_id(), "sid", req.sprint_id()))).await().indefinitely();
                    return noStore(Response.ok(Map.of("ok", true, "adr_id", req.adr_id(),
                        "sprint_id", req.sprint_id(), "action", "removed")));
                }
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> created = (List<Map<String, Object>>)
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "CREATE EDGE IMPLEMENTED_IN " +
                        "FROM (SELECT FROM KnowADR    WHERE adr_id   = :id) " +
                        "TO   (SELECT FROM KnowSprint WHERE sprint_id = :sid) IF NOT EXISTS",
                        Map.of("id", req.adr_id(), "sid", req.sprint_id())))
                    .await().indefinitely().result();
                // CREATE EDGE into an empty FROM/TO set is a silent no-op — surface it.
                boolean linked = created != null && !created.isEmpty();
                return noStore(Response.ok(Map.of("ok", true, "adr_id", req.adr_id(),
                    "sprint_id", req.sprint_id(), "action", "added", "linked", linked,
                    "hint", linked ? "" : "no edge created — check adr_id/sprint_id exist")));
            }
            // Release target: prefer release_uid (git_project#release_id) for multi-repo
            // safety; fall back to bare release_id when git_project is not supplied.
            String relField = (req.git_project() != null && !req.git_project().isBlank())
                ? "release_uid" : "release_id";
            String relKey = "release_uid".equals(relField)
                ? req.git_project() + "#" + req.release_id() : req.release_id();
            if (remove) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM (SELECT expand(outE('IMPLEMENTED_IN_RELEASE')) FROM KnowADR WHERE adr_id=:id) " +
                    "WHERE @in." + relField + " = :rkey",
                    Map.of("id", req.adr_id(), "rkey", relKey))).await().indefinitely();
                return noStore(Response.ok(Map.of("ok", true, "adr_id", req.adr_id(),
                    "release_id", req.release_id(), "action", "removed")));
            }
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> created = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE IMPLEMENTED_IN_RELEASE " +
                    "FROM (SELECT FROM KnowADR     WHERE adr_id = :id) " +
                    "TO   (SELECT FROM KnowRelease WHERE " + relField + " = :rkey) IF NOT EXISTS",
                    Map.of("id", req.adr_id(), "rkey", relKey)))
                .await().indefinitely().result();
            boolean linked = created != null && !created.isEmpty();
            return noStore(Response.ok(Map.of("ok", true, "adr_id", req.adr_id(),
                "release_id", req.release_id(), "action", "added", "linked", linked,
                "hint", linked ? "" : "no edge created — release not found by " + relField + "='" + relKey
                    + "' (register it via lore_create_release, or pass git_project)")));
        } catch (Exception e) {
            LOG.warnf("[LORE ADR LINK] %s: %s", req.adr_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    @POST
    @Path("adr/rename")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response renameAdr(AdrRenameRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.adr_id() == null || req.adr_id().isBlank()
                || req.new_adr_id() == null || req.new_adr_id().isBlank())
            return badParams("adr_id and new_adr_id required");
        if (!SAFE_ID.matcher(req.new_adr_id()).matches())
            return badParams("new_adr_id contains illegal characters");
        try {
            // Edges hang off the vertex @rid, not the business key — renaming adr_id
            // in place keeps every DEPENDS_ON/SUPERSEDES/BELONGS_TO/TAGGED_WITH/
            // IMPLEMENTED_IN*/HAS_STATE edge intact. No tombstone needed.
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> clash = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "SELECT adr_id FROM KnowADR WHERE adr_id=:nid",
                    Map.of("nid", req.new_adr_id()))).await().indefinitely().result();
            if (clash != null && !clash.isEmpty())
                return badParams("new_adr_id already exists: " + req.new_adr_id());
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> hit = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "UPDATE KnowADR SET adr_id=:nid WHERE adr_id=:oid",
                    Map.of("nid", req.new_adr_id(), "oid", req.adr_id())))
                .await().indefinitely().result();
            Object count = (hit != null && !hit.isEmpty()) ? hit.get(0).get("count") : 0;
            return noStore(Response.ok(Map.of("ok", true,
                "adr_id", req.new_adr_id(), "renamed_from", req.adr_id(), "updated", count)));
        } catch (Exception e) {
            LOG.warnf("[LORE ADR RENAME] %s → %s: %s", req.adr_id(), req.new_adr_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    @POST
    @Path("adr/delete")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response deleteAdr(AdrDeleteRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.adr_id() == null || req.adr_id().isBlank())
            return badParams("adr_id required");
        try {
            // Cascade order matters (ArcadeDB: DELETE VERTEX unsupported, edges first):
            // 1) collect hist rids while HAS_STATE still exists, 2) drop all edges,
            // 3) drop hist rows by rid, 4) drop the vertex.
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> histRids = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "SELECT @rid as rid FROM KnowADRHist WHERE in('HAS_STATE').adr_id[0]=:id",
                    Map.of("id", req.adr_id()))).await().indefinitely().result();
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "DELETE FROM (SELECT expand(bothE()) FROM KnowADR WHERE adr_id=:id)",
                Map.of("id", req.adr_id()))).await().indefinitely();
            int histDeleted = 0;
            if (histRids != null) {
                for (Map<String, Object> r : histRids) {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM KnowADRHist WHERE @rid=:rid",
                        Map.of("rid", r.get("rid")))).await().indefinitely();
                    histDeleted++;
                }
            }
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "DELETE FROM KnowADR WHERE adr_id=:id",
                Map.of("id", req.adr_id()))).await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "adr_id", req.adr_id(),
                "hist_deleted", histDeleted)));
        } catch (Exception e) {
            LOG.warnf("[LORE ADR DELETE] %s: %s", req.adr_id(), e.getMessage());
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
            // LH-44: only SET provided fields — a title-only re-call must not wipe
            // body_md/refs_raw or reset date_created to today.
            StringBuilder dsql = new StringBuilder("UPDATE KnowDecision SET decision_id=:did, title=:title");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("did", req.decision_id());
            p.put("title", req.title().trim());
            if (req.body_md() != null)      { dsql.append(", body_md=:body");      p.put("body", req.body_md()); }
            if (req.date_created() != null) { dsql.append(", date_created=:date"); p.put("date", req.date_created()); }
            if (req.refs_raw() != null)     { dsql.append(", refs_raw=:refs");     p.put("refs", req.refs_raw()); }
            dsql.append(" UPSERT WHERE decision_id=:did");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                dsql.toString(), p)).await().indefinitely();
            // Default date_created=today only where missing (fresh insert without explicit date).
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE KnowDecision SET date_created=:d WHERE decision_id=:did AND date_created IS NULL",
                Map.of("d", java.time.LocalDate.now().toString(), "did", req.decision_id())))
                .await().indefinitely();
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
            // LH-44: the MCP tool contract explicitly promises "partial update — only
            // supplied fields written"; previously ALL six fields were SET unconditionally,
            // so an owner-only call wiped team/full_name/area/game_icon/parent_id.
            StringBuilder csql = new StringBuilder("UPDATE LoreComponent SET component_id=:cid");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("cid", req.component_id());
            if (req.owner() != null)     { csql.append(", owner=:owner");         p.put("owner",     req.owner()); }
            if (req.team() != null)      { csql.append(", team=:team");           p.put("team",      req.team()); }
            if (req.full_name() != null) { csql.append(", full_name=:full_name"); p.put("full_name", req.full_name()); }
            if (req.area() != null)      { csql.append(", area=:area");           p.put("area",      req.area()); }
            if (req.game_icon() != null) { csql.append(", game_icon=:game_icon"); p.put("game_icon", req.game_icon()); }
            if (req.parent_id() != null) { csql.append(", parent_id=:parent_id"); p.put("parent_id", req.parent_id()); }
            csql.append(" WHERE component_id=:cid");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                csql.toString(), p)).await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "component_id", req.component_id())));
        } catch (Exception e) {
            LOG.warnf("[LORE COMPONENT UPDATE] %s: %s", req.component_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    public record ComponentCreateRequest(
        String component_id,
        String full_name, String area, String team,
        String game_icon, String owner, String parent_id
    ) {}

    @POST
    @Path("component/create")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response createComponent(ComponentCreateRequest req,
                                    @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.component_id() == null || req.component_id().isBlank())
            return badParams("component_id required");
        if (!SAFE_ID.matcher(req.component_id()).matches())
            return badParams("component_id contains illegal characters");
        try {
            // LH-44: dynamic SET — re-calling create on an existing component must not
            // wipe unspecified fields nor reset children/tech arrays (initialised below
            // only where still missing, i.e. genuinely new vertices).
            StringBuilder csql = new StringBuilder("UPDATE LoreComponent SET component_id=:cid");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("cid", req.component_id());
            if (req.full_name() != null) { csql.append(", full_name=:full_name"); p.put("full_name", req.full_name()); }
            if (req.area() != null)      { csql.append(", area=:area");           p.put("area",      req.area()); }
            if (req.team() != null)      { csql.append(", team=:team");           p.put("team",      req.team()); }
            if (req.game_icon() != null) { csql.append(", game_icon=:game_icon"); p.put("game_icon", req.game_icon()); }
            if (req.owner() != null)     { csql.append(", owner=:owner");         p.put("owner",     req.owner()); }
            if (req.parent_id() != null) { csql.append(", parent_id=:parent_id"); p.put("parent_id", req.parent_id()); }
            csql.append(" UPSERT WHERE component_id=:cid");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                csql.toString(), p)).await().indefinitely();
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE LoreComponent SET children=[] WHERE component_id=:cid AND children IS NULL",
                Map.of("cid", req.component_id()))).await().indefinitely();
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE LoreComponent SET tech=[] WHERE component_id=:cid AND tech IS NULL",
                Map.of("cid", req.component_id()))).await().indefinitely();
            if (req.parent_id() != null && !req.parent_id().isBlank()) {
                Map<String, Object> ep = Map.of("cid", req.component_id(), "pid", req.parent_id());
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    String.format(
                    "CREATE EDGE PARENT_OF FROM (SELECT FROM LoreComponent WHERE component_id='%s') " +
                    "TO (SELECT FROM LoreComponent WHERE component_id='%s')",
                    req.component_id(), req.parent_id()),
                    Map.of())).await().indefinitely();
            }
            return noStore(Response.ok(Map.of("ok", true, "component_id", req.component_id())));
        } catch (Exception e) {
            LOG.warnf("[LORE COMPONENT CREATE] %s: %s", req.component_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    public record ComponentLinkParentRequest(String component_id, String parent_id) {}

    @POST
    @Path("component/link-parent")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkComponentParent(ComponentLinkParentRequest req,
                                        @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.component_id() == null || req.parent_id() == null)
            return badParams("component_id and parent_id required");
        try {
            Map<String, Object> p = Map.of("cid", req.component_id(), "pid", req.parent_id());
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE LoreComponent SET parent_id=:pid WHERE component_id=:cid", p))
                .await().indefinitely();
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                String.format(
                    "CREATE EDGE PARENT_OF FROM (SELECT FROM LoreComponent WHERE component_id='%s') " +
                    "TO (SELECT FROM LoreComponent WHERE component_id='%s')",
                    req.component_id(), req.parent_id()),
                Map.of())).await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "component_id", req.component_id(), "parent_id", req.parent_id())));
        } catch (Exception e) {
            LOG.warnf("[LORE COMPONENT LINK-PARENT] %s→%s: %s", req.component_id(), req.parent_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Spec write ───────────────────────────────────────────────────────────
    public record SpecUpsertRequest(String spec_id, String title, String version,
        String component_id, String content_md, String file_path, String summary) {}
    public record SpecDeleteRequest(String spec_id) {}

    @POST
    @Path("spec")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertSpec(SpecUpsertRequest req,
                               @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.spec_id() == null || req.spec_id().isBlank())
            return badParams("spec_id required");
        if (!SAFE_ID.matcher(req.spec_id()).matches())
            return badParams("spec_id contains illegal characters");
        try {
            // LH-44: only SET fields actually provided — a partial amend call (e.g. only
            // content_md to bump a spec's body) must not wipe version/component_id/file_path
            // to null. Same class of bug found and fixed on /lore/adr, 2026-07-02.
            //
            // SCD2 write contract: spec_by_id reads content_md/version/summary through
            // COALESCE(out('HAS_STATE')...[0], <vertex>) — the hist row WINS whenever one
            // exists (164 KnowSpecHist rows do). A vertex-only write is therefore invisible
            // for every ingested spec. Body fields go to the open hist row (created here
            // when missing); the vertex keeps title/file_path/component_id + a fallback copy.
            StringBuilder sql = new StringBuilder("UPDATE KnowSpec SET spec_id=:id");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("id", req.spec_id());
            if (req.title() != null)        { sql.append(", title=:title");             p.put("title", req.title()); }
            if (req.version() != null)      { sql.append(", version=:version");         p.put("version", req.version()); }
            if (req.component_id() != null) { sql.append(", component_id=:cid");        p.put("cid", req.component_id()); }
            if (req.content_md() != null)   { sql.append(", content_md=:content");      p.put("content", req.content_md()); }
            if (req.file_path() != null)    { sql.append(", file_path=:fp");            p.put("fp", req.file_path()); }
            sql.append(" UPSERT WHERE spec_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                sql.toString(), p)).await().indefinitely();

            boolean bodyProvided = req.content_md() != null || req.version() != null || req.summary() != null;
            boolean histWritten = false;
            if (bodyProvided) {
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> histRows = (List<Map<String, Object>>)
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "SELECT @rid as rid FROM KnowSpecHist " +
                        "WHERE in('HAS_STATE').spec_id[0] = :id AND valid_to IS NULL LIMIT 1",
                        Map.of("id", req.spec_id())))
                    .await().indefinitely().result();
                if (histRows != null && !histRows.isEmpty()) {
                    // Match by @rid — state_uid can be null on legacy rows (same silent
                    // no-op class as the ADR fix, 162cc18).
                    StringBuilder hsql = new StringBuilder("UPDATE KnowSpecHist SET spec_id=:id");
                    Map<String, Object> hp = new java.util.HashMap<>();
                    hp.put("id", req.spec_id());
                    hp.put("rid", histRows.get(0).get("rid"));
                    if (req.content_md() != null) { hsql.append(", content_md=:content"); hp.put("content", req.content_md()); }
                    if (req.version() != null)    { hsql.append(", version=:version");    hp.put("version", req.version()); }
                    if (req.summary() != null)    { hsql.append(", summary=:summary");    hp.put("summary", req.summary()); }
                    hsql.append(" WHERE @rid=:rid");
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        hsql.toString(), hp)).await().indefinitely();
                } else {
                    String nsid = UUID.randomUUID().toString();
                    Map<String, Object> hp = mapOfNullable(
                        "content", req.content_md(), "version", req.version(), "summary", req.summary());
                    hp.put("id", req.spec_id());
                    hp.put("nsid", nsid);
                    hp.put("now", Instant.now().toString());
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "INSERT INTO KnowSpecHist SET spec_id=:id, state_uid=:nsid, valid_from=:now, " +
                        "content_md=:content, version=:version, summary=:summary", hp)).await().indefinitely();
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "CREATE EDGE HAS_STATE " +
                        "FROM (SELECT FROM KnowSpec     WHERE spec_id   = :id) " +
                        "TO   (SELECT FROM KnowSpecHist WHERE state_uid = :nsid)",
                        Map.of("id", req.spec_id(), "nsid", nsid))).await().indefinitely();
                }
                histWritten = true;
            }
            return noStore(Response.ok(Map.of("ok", true, "spec_id", req.spec_id(),
                "body_written", histWritten)));
        } catch (Exception e) {
            LOG.warnf("[LORE SPEC UPSERT] %s: %s", req.spec_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    @POST
    @Path("spec/delete")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response deleteSpec(SpecDeleteRequest req,
                               @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.spec_id() == null || req.spec_id().isBlank())
            return badParams("spec_id required");
        if (!SAFE_ID.matcher(req.spec_id()).matches())
            return badParams("spec_id contains illegal characters");
        try {
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "DELETE FROM KnowSpec WHERE spec_id=:id",
                Map.of("id", req.spec_id()))).await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "spec_id", req.spec_id())));
        } catch (Exception e) {
            LOG.warnf("[LORE SPEC DELETE] %s: %s", req.spec_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── QualityGate write ────────────────────────────────────────────────────
    public record QGUpsertRequest(String qg_id, String name, String description,
        String component_id, String status, String content_md, String sprint_id) {}

    @POST
    @Path("quality-gate")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertQualityGate(QGUpsertRequest req,
                                      @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.qg_id() == null || req.qg_id().isBlank())
            return badParams("qg_id required");
        if (!SAFE_ID.matcher(req.qg_id()).matches())
            return badParams("qg_id contains illegal characters");
        try {
            // LH-44: only SET provided fields — a status-only call (e.g. deprecate a gate)
            // must not wipe curated content_md/description/routine links.
            StringBuilder qsql = new StringBuilder("UPDATE QualityGate SET qg_id=:id");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("id", req.qg_id());
            if (req.name() != null)         { qsql.append(", name=:nm");          p.put("nm",  req.name()); }
            if (req.description() != null)  { qsql.append(", description=:dsc");  p.put("dsc", req.description()); }
            if (req.component_id() != null) { qsql.append(", component_id=:cid"); p.put("cid", req.component_id()); }
            if (req.status() != null)       { qsql.append(", status=:st");        p.put("st",  req.status()); }
            if (req.content_md() != null)   { qsql.append(", content_md=:cnt");   p.put("cnt", req.content_md()); }
            if (req.sprint_id() != null)    { qsql.append(", sprint_id=:sid");    p.put("sid", req.sprint_id()); }
            qsql.append(" UPSERT WHERE qg_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                qsql.toString(), p)).await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "qg_id", req.qg_id())));
        } catch (Exception e) {
            LOG.warnf("[LORE QG UPSERT] %s: %s", req.qg_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── QG Run record (ClRoutineRun + ClRoutineMetric batch) ─────────────────
    public record QGMetricEntry(String key, Double value, String unit, Double target, String status, String source) {}
    public record QGRunRequest(
        String run_id, String routine_name, String run_date, String status,
        String started_at, String finished_at, String flags,
        java.util.List<QGMetricEntry> metrics) {}

    @POST
    @Path("qg/run")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response recordQGRun(QGRunRequest req,
                                @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.routine_name() == null || req.routine_name().isBlank())
            return badParams("routine_name required");
        String runId = req.run_id() != null ? req.run_id()
            : req.routine_name() + "_" + (req.run_date() != null ? req.run_date() : "unknown");
        try {
            // Upsert ClRoutineRun
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE ClRoutineRun SET run_id=:rid, routine_name=:rn, run_date=:rd, " +
                "status=:st, started_at=:sa, finished_at=:fa, flags=:fl " +
                "UPSERT WHERE run_id=:rid",
                mapOfNullable("rid", runId, "rn", req.routine_name(), "rd", req.run_date(),
                    "st", req.status(), "sa", req.started_at(), "fa", req.finished_at(),
                    "fl", req.flags()))).await().indefinitely();
            // Upsert ClRoutineMetric entries
            int written = 0;
            if (req.metrics() != null) {
                for (QGMetricEntry m : req.metrics()) {
                    if (m.key() == null) continue;
                    String mId = runId + "_" + m.key();
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "UPDATE ClRoutineMetric SET metric_id=:mid, run_id=:rid, " +
                        "routine_name=:rn, run_date=:rd, metric_key=:mk, value=:val, " +
                        "unit=:unit, target=:tgt, status=:st, source=:src " +
                        "UPSERT WHERE metric_id=:mid",
                        mapOfNullable("mid", mId, "rid", runId, "rn", req.routine_name(),
                            "rd", req.run_date(), "mk", m.key(), "val", m.value(),
                            "unit", m.unit(), "tgt", m.target(), "st", m.status(),
                            "src", m.source())))
                        .await().indefinitely();
                    written++;
                }
            }
            return noStore(Response.ok(Map.of("ok", true, "run_id", runId, "metrics_written", written)));
        } catch (Exception e) {
            LOG.warnf("[LORE QG RUN] %s: %s", runId, e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── QGJobTask / QGRecommendation write ───────────────────────────────────
    public record QGJobTaskRequest(
        String job_id, String qg_id, String inv_id, String run_date,
        String severity, String status, String note_md) {}

    @POST
    @Path("qg/job-task")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertQGJobTask(QGJobTaskRequest req,
                                    @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.job_id() == null || req.job_id().isBlank())
            return badParams("job_id required");
        if (req.qg_id() == null || req.qg_id().isBlank())
            return badParams("qg_id required");
        try {
            // LH-44: only SET provided fields — a status-only resolve call must not
            // wipe note_md/severity/run_date evidence.
            StringBuilder jsql = new StringBuilder("UPDATE QGJobTask SET job_id=:jid, qg_id=:qid");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("jid", req.job_id());
            p.put("qid", req.qg_id());
            if (req.inv_id() != null)   { jsql.append(", inv_id=:inv");    p.put("inv",  req.inv_id()); }
            if (req.run_date() != null) { jsql.append(", run_date=:rd");   p.put("rd",   req.run_date()); }
            if (req.severity() != null) { jsql.append(", severity=:sev");  p.put("sev",  req.severity()); }
            if (req.status() != null)   { jsql.append(", status=:st");     p.put("st",   req.status()); }
            if (req.note_md() != null)  { jsql.append(", note_md=:note");  p.put("note", req.note_md()); }
            jsql.append(" UPSERT WHERE job_id=:jid");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                jsql.toString(), p)).await().indefinitely();
            // YIELDED edge: QualityGate → QGJobTask (idempotent)
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "CREATE EDGE YIELDED FROM (SELECT FROM QualityGate WHERE qg_id=:qid) " +
                "TO (SELECT FROM QGJobTask WHERE job_id=:jid) IF NOT EXISTS",
                Map.of("qid", req.qg_id(), "jid", req.job_id()))).await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "job_id", req.job_id())));
        } catch (Exception e) {
            LOG.warnf("[LORE QG JOB-TASK] %s: %s", req.job_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    public record QGRecommendationRequest(
        String rec_id, String job_id, String title, String body_md, String status,
        String priority, String severity, Double effort_days, String tags,
        String component_id, String qg_id, String inv_id,
        String fix_cmd, String how_to_verify) {}

    @POST
    @Path("qg/recommendation")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertQGRecommendation(QGRecommendationRequest req,
                                           @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.rec_id() == null || req.rec_id().isBlank())
            return badParams("rec_id required");
        if (req.job_id() == null || req.job_id().isBlank())
            return badParams("job_id required");
        try {
            // LH-44: only SET provided fields. Two former hazards on partial re-calls:
            // (1) body_md/fix_cmd/how_to_verify etc. wiped to null; (2) status forced
            // back to 'pending' — silently un-promoting an already promoted rec.
            // Default status='pending' now applies only where still missing (fresh insert).
            StringBuilder rsql = new StringBuilder("UPDATE QGRecommendation SET rec_id=:rid, job_id=:jid");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("rid", req.rec_id());
            p.put("jid", req.job_id());
            if (req.title() != null)         { rsql.append(", title=:ttl");           p.put("ttl",  req.title()); }
            if (req.body_md() != null)       { rsql.append(", body_md=:body");        p.put("body", req.body_md()); }
            if (req.status() != null)        { rsql.append(", status=:st");           p.put("st",   req.status()); }
            if (req.priority() != null)      { rsql.append(", priority=:pri");        p.put("pri",  req.priority()); }
            if (req.severity() != null)      { rsql.append(", severity=:sev");        p.put("sev",  req.severity()); }
            if (req.effort_days() != null)   { rsql.append(", effort_days=:eff");     p.put("eff",  req.effort_days()); }
            if (req.tags() != null)          { rsql.append(", tags=:tags");           p.put("tags", req.tags()); }
            if (req.component_id() != null)  { rsql.append(", component_id=:cid");    p.put("cid",  req.component_id()); }
            if (req.qg_id() != null)         { rsql.append(", qg_id=:qgid");          p.put("qgid", req.qg_id()); }
            if (req.inv_id() != null)        { rsql.append(", inv_id=:inv");          p.put("inv",  req.inv_id()); }
            if (req.fix_cmd() != null)       { rsql.append(", fix_cmd=:fcmd");        p.put("fcmd", req.fix_cmd()); }
            if (req.how_to_verify() != null) { rsql.append(", how_to_verify=:htv");   p.put("htv",  req.how_to_verify()); }
            rsql.append(" UPSERT WHERE rec_id=:rid");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                rsql.toString(), p)).await().indefinitely();
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE QGRecommendation SET status='pending' WHERE rec_id=:rid AND status IS NULL",
                Map.of("rid", req.rec_id()))).await().indefinitely();
            // PRODUCED edge: QGJobTask → QGRecommendation (idempotent)
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "CREATE EDGE PRODUCED FROM (SELECT FROM QGJobTask WHERE job_id=:jid) " +
                "TO (SELECT FROM QGRecommendation WHERE rec_id=:rid) IF NOT EXISTS",
                Map.of("jid", req.job_id(), "rid", req.rec_id()))).await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "rec_id", req.rec_id())));
        } catch (Exception e) {
            LOG.warnf("[LORE QG REC] %s: %s", req.rec_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    public record QGPromoteRequest(
        String rec_id, String sprint_id, String task_uid, String title, String note_md) {}

    @POST
    @Path("qg/promote")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response promoteQGRecommendation(QGPromoteRequest req,
                                            @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.rec_id() == null || req.rec_id().isBlank())
            return badParams("rec_id required");
        // Default target: a weekly rotating housekeeping sprint (ISO week), not one
        // never-closing bucket. Explicit req.sprint_id() still wins (backward-compat
        // override). Found 2026-07-02: SPRINT_QG_VIOLATIONS accumulated every promoted
        // recommendation across every gate/run forever — no velocity signal, no closure.
        String sprintId = req.sprint_id() != null ? req.sprint_id() : weeklyHousekeepingSprintId();
        if (req.sprint_id() == null) {
            java.time.temporal.WeekFields wf = java.time.temporal.WeekFields.ISO;
            java.time.LocalDate today = java.time.LocalDate.now(java.time.ZoneOffset.UTC);
            ingestService.createSprint(
                sprintId,
                String.format("QG Housekeeping — Week %02d %d",
                    today.get(wf.weekOfWeekBasedYear()), today.get(wf.weekBasedYear())),
                "active", null, null, null, null,
                "Автосоздан при первом промоуте QG-рекомендации на этой ISO-неделе " +
                "(lore/qg/promote). Явный sprint_id в вызове переопределяет этот дефолт.");
        }
        String stateUid = java.util.UUID.randomUUID().toString();
        String nowTs    = java.time.Instant.now().toString();
        try {
            // 1. Look up the recommendation to enrich the task
            List<Map<String, Object>> recRows = ingestService.queryPublic(
                "SELECT rec_id, title, body_md, priority, severity, effort_days, " +
                "fix_cmd, how_to_verify, component_id, qg_id, inv_id, tags " +
                "FROM QGRecommendation WHERE rec_id=:rid LIMIT 1",
                Map.of("rid", req.rec_id()));
            Map<String, Object> rec = recRows.isEmpty() ? Map.of() : recRows.get(0);

            // 2. Derive task_id = next TNN in sprint.
            // PART_OF edge direction is Task --PART_OF--> Sprint (CREATE EDGE PART_OF FROM
            // KnowTask TO KnowSprint, below) — so from a KnowTask row the OWN edge is
            // out('PART_OF'), not in(). Using in() here always returned zero matches,
            // silently resetting maxN to 0 → every 2nd+ promotion into the same sprint
            // recomputed task_id="T01" and UPSERT-overwrote the FIRST task's title/note_md.
            // Found + fixed live 2026-07-02 (test promote clobbered the real T01 in
            // SPRINT_QG_VIOLATIONS — restored from history after this fix landed).
            List<Map<String, Object>> existingTasks = ingestService.queryPublic(
                "SELECT task_id FROM KnowTask WHERE task_id IS NOT NULL " +
                "AND task_id LIKE 'T%' AND out('PART_OF').sprint_id=:sid",
                Map.of("sid", sprintId));
            int maxN = existingTasks.stream()
                .map(t -> t.getOrDefault("task_id", "T0").toString().replaceAll("[^0-9]", ""))
                .filter(s -> !s.isBlank()).mapToInt(s -> { try { return Integer.parseInt(s); } catch (Exception e2) { return 0; } })
                .max().orElse(0);
            String taskId  = String.format("T%02d", maxN + 1);
            String taskUid = req.task_uid() != null ? req.task_uid()
                           : sprintId + "/" + taskId;

            // 3. Build rich note_md from rec fields
            String recTitle    = str(rec.get("title"));
            String recBody     = str(rec.get("body_md"));
            String recPri      = str(rec.get("priority"));
            String recSev      = str(rec.get("severity"));
            String recEffort   = str(rec.get("effort_days"));
            String recFixCmd   = str(rec.get("fix_cmd"));
            String recVerify   = str(rec.get("how_to_verify"));
            String recQg       = str(rec.get("qg_id"));
            String recInv      = str(rec.get("inv_id"));
            String recTags     = str(rec.get("tags"));
            String recComp     = str(rec.get("component_id"));

            String title = req.title() != null ? req.title()
                         : (!recTitle.isBlank() ? recTitle : taskUid);

            String note;
            if (req.note_md() != null) {
                note = req.note_md();
            } else {
                StringBuilder sb = new StringBuilder();
                sb.append("## ").append(title).append("\n\n");
                if (!recQg.isBlank() || !recInv.isBlank())
                    sb.append("**QG:** ").append(recQg).append(" · **INV:** ").append(recInv).append("\n");
                if (!recPri.isBlank() || !recSev.isBlank())
                    sb.append("**Priority:** ").append(recPri)
                      .append(" · **Severity:** ").append(recSev);
                if (!recEffort.isBlank()) sb.append(" · **Effort:** ").append(recEffort).append("d");
                if (!recPri.isBlank() || !recSev.isBlank()) sb.append("\n");
                if (!recTags.isBlank()) sb.append("**Tags:** ").append(recTags).append("\n");
                sb.append("\n");
                if (!recBody.isBlank()) sb.append(recBody).append("\n\n");
                if (!recFixCmd.isBlank())
                    sb.append("**Fix:**\n```bash\n").append(recFixCmd).append("\n```\n\n");
                if (!recVerify.isBlank())
                    sb.append("**Verify:**\n```bash\n").append(recVerify).append("\n```\n");
                note = sb.toString().trim();
            }

            // 4. Upsert task vertex with task_id + component_id
            String compId = recComp.isBlank() ? "AIDA" : recComp;
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE KnowTask SET task_uid=:uid, task_id=:tid, title=:title, " +
                "note_md=:note, src='qg', component_id=:cid UPSERT WHERE task_uid=:uid",
                mapOfNullable("uid", taskUid, "tid", taskId, "title", title, "note", note, "cid", compId)))
                .await().indefinitely();
            // Insert KnowTaskHist row with TODO status
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "INSERT INTO KnowTaskHist SET state_uid=:nsid, status_raw='⬜ TODO', valid_from=:now",
                Map.of("nsid", stateUid, "now", nowTs))).await().indefinitely();
            // Link HAS_STATE: KnowTask → KnowTaskHist
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "CREATE EDGE HAS_STATE FROM (SELECT FROM KnowTask WHERE task_uid=:uid) " +
                "TO (SELECT FROM KnowTaskHist WHERE state_uid=:nsid)",
                Map.of("uid", taskUid, "nsid", stateUid))).await().indefinitely();
            // Link PART_OF: KnowTask → KnowSprint
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "CREATE EDGE PART_OF FROM (SELECT FROM KnowTask WHERE task_uid=:uid) " +
                "TO (SELECT FROM KnowSprint WHERE sprint_id=:sid) IF NOT EXISTS",
                Map.of("uid", taskUid, "sid", sprintId))).await().indefinitely();
            // PROMOTED_TO edge: QGRecommendation → KnowTask
            Map<String, Object> ep = Map.of("rid", req.rec_id(), "uid", taskUid);
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "CREATE EDGE PROMOTED_TO FROM (SELECT FROM QGRecommendation WHERE rec_id=:rid) " +
                "TO (SELECT FROM KnowTask WHERE task_uid=:uid) IF NOT EXISTS", ep))
                .await().indefinitely();
            // Mark recommendation as promoted
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE QGRecommendation SET status='promoted' WHERE rec_id=:rid",
                Map.of("rid", req.rec_id()))).await().indefinitely();
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true); out.put("task_uid", taskUid);
            out.put("task_id", taskId); out.put("sprint_id", sprintId);
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE QG PROMOTE] %s: %s", req.rec_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Runbook write ────────────────────────────────────────────────────────
    public record RunbookUpsertRequest(String runbook_id, String name, String area,
        String date_created, String content_md) {}

    @POST
    @Path("runbook")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertRunbook(RunbookUpsertRequest req,
                                  @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.runbook_id() == null || req.runbook_id().isBlank())
            return badParams("runbook_id required");
        if (!SAFE_ID.matcher(req.runbook_id()).matches())
            return badParams("runbook_id contains illegal characters");
        try {
            String now  = Instant.now().toString();
            String nsid = UUID.randomUUID().toString();

            // Step 1: upsert KnowRunbook vertex (metadata only — content lives in hist).
            // LH-44: only SET provided fields — a content-only re-call must not wipe
            // area or reset date_created to today. Default date applies only where missing.
            StringBuilder rbsql = new StringBuilder("UPDATE KnowRunbook SET runbook_id=:id, name=:name");
            Map<String, Object> upsertP = new java.util.HashMap<>();
            upsertP.put("id", req.runbook_id());
            upsertP.put("name", req.name());
            if (req.area() != null)         { rbsql.append(", area=:area");         upsertP.put("area", req.area()); }
            if (req.date_created() != null) { rbsql.append(", date_created=:date"); upsertP.put("date", req.date_created()); }
            rbsql.append(" UPSERT WHERE runbook_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                rbsql.toString(), upsertP)).await().indefinitely();
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE KnowRunbook SET date_created=:d WHERE runbook_id=:id AND date_created IS NULL",
                Map.of("d", java.time.LocalDate.now().toString(), "id", req.runbook_id())))
                .await().indefinitely();

            // Step 2: check for an existing open SCD2 hist row
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> histRows = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "SELECT @rid as rid FROM KnowRunbookHist " +
                    "WHERE in('HAS_STATE').runbook_id[0] = :id AND valid_to IS NULL LIMIT 1",
                    Map.of("id", req.runbook_id())))
                .await().indefinitely().result();

            boolean histCreated;
            if (histRows != null && !histRows.isEmpty()) {
                // Step 3a: update content on the existing open hist row. Match by @rid
                // (state_uid can be null on legacy rows — same silent-no-op class as the
                // ADR fix above), and only SET content_md when provided (LH-44) — a
                // metadata-only upsert must not wipe the runbook body.
                if (req.content_md() != null) {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "UPDATE KnowRunbookHist SET content_md=:cnt WHERE @rid=:rid",
                        Map.of("cnt", req.content_md(), "rid", histRows.get(0).get("rid"))))
                        .await().indefinitely();
                }
                histCreated = false;
            } else {
                // Step 3b: create the initial open hist row + HAS_STATE edge
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "INSERT INTO KnowRunbookHist SET state_uid=:nsid, valid_from=:now, content_md=:cnt",
                    mapOfNullable("nsid", nsid, "now", now, "cnt", req.content_md())))
                    .await().indefinitely();
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE HAS_STATE " +
                    "FROM (SELECT FROM KnowRunbook     WHERE runbook_id = :id) " +
                    "TO   (SELECT FROM KnowRunbookHist WHERE state_uid  = :nsid)",
                    Map.of("id", req.runbook_id(), "nsid", nsid)))
                    .await().indefinitely();
                histCreated = true;
            }

            return noStore(Response.ok(Map.of("ok", true, "runbook_id", req.runbook_id(),
                "hist_created", histCreated)));
        } catch (Exception e) {
            LOG.warnf("[LORE RUNBOOK UPSERT] %s: %s", req.runbook_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── KnowDoc write ────────────────────────────────────────────────────────
    public record DocUpsertRequest(String doc_id, String title, String kind,
        Boolean has_ext_deps, String component_id, String file_path, String content_html) {}

    @POST
    @Path("doc")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertDoc(DocUpsertRequest req,
                              @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.doc_id() == null || req.doc_id().isBlank())
            return badParams("doc_id required");
        if (!SAFE_ID.matcher(req.doc_id()).matches())
            return badParams("doc_id contains illegal characters");
        try {
            // LH-44: only SET provided fields — a metadata-only re-call must not wipe
            // content_html (up to 100 KB of page content) or the other attributes.
            StringBuilder dcsql = new StringBuilder("UPDATE KnowDoc SET doc_id=:id");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("id", req.doc_id());
            if (req.title() != null)        { dcsql.append(", title=:title");           p.put("title",    req.title()); }
            if (req.kind() != null)         { dcsql.append(", kind=:kind");             p.put("kind",     req.kind()); }
            if (req.has_ext_deps() != null) { dcsql.append(", has_ext_deps=:ext_deps"); p.put("ext_deps", req.has_ext_deps()); }
            if (req.component_id() != null) { dcsql.append(", component_id=:cid");      p.put("cid",      req.component_id()); }
            if (req.file_path() != null)    { dcsql.append(", file_path=:fp");          p.put("fp",       req.file_path()); }
            if (req.content_html() != null) { dcsql.append(", content_html=:content");  p.put("content",  req.content_html()); }
            dcsql.append(" UPSERT WHERE doc_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                dcsql.toString(), p)).await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "doc_id", req.doc_id())));
        } catch (Exception e) {
            LOG.warnf("[LORE DOC UPSERT] %s: %s", req.doc_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── BRAGI content archive write — MCP-01: publications, variants, assets ──
    // Flat vertices (no SCD2/Hist twin, see LoreSchemaInitializer Phase 7) — LH-44
    // partial-upsert still applies (re-calling with fewer fields must not wipe
    // existing content), edges are idempotent CREATE ... IF NOT EXISTS.
    public record BragiPublicationRequest(
        String publication_id, String title, String topic, String main_text_md,
        String type, String status_general, java.util.List<String> keyword_ids) {}

    @POST
    @Path("bragi/publication")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertBragiPublication(BragiPublicationRequest req,
                                           @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.publication_id() == null || req.publication_id().isBlank())
            return badParams("publication_id required");
        if (!SAFE_ID.matcher(req.publication_id()).matches())
            return badParams("publication_id contains illegal characters");
        try {
            StringBuilder sql = new StringBuilder("UPDATE BragiPublication SET publication_id=:id");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("id", req.publication_id());
            if (req.title() != null)          { sql.append(", title=:title");         p.put("title", req.title()); }
            if (req.topic() != null)          { sql.append(", topic=:topic");         p.put("topic", req.topic()); }
            if (req.main_text_md() != null)   { sql.append(", main_text_md=:mt");     p.put("mt", req.main_text_md()); }
            if (req.type() != null)           { sql.append(", type=:type");           p.put("type", req.type()); }
            if (req.status_general() != null) { sql.append(", status_general=:sg");   p.put("sg", req.status_general()); }
            sql.append(" UPSERT WHERE publication_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                sql.toString(), p)).await().indefinitely();
            int keysLinked = 0;
            if (req.keyword_ids() != null) {
                for (String kid : req.keyword_ids()) {
                    if (kid == null || kid.isBlank()) continue;
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "CREATE EDGE TARGETS_KEY FROM (SELECT FROM BragiPublication WHERE publication_id=:pid) " +
                        "TO (SELECT FROM BragiKeyword WHERE keyword_id=:kid) IF NOT EXISTS",
                        Map.of("pid", req.publication_id(), "kid", kid))).await().indefinitely();
                    keysLinked++;
                }
            }
            return noStore(Response.ok(Map.of("ok", true, "publication_id", req.publication_id(), "keys_linked", keysLinked)));
        } catch (Exception e) {
            LOG.warnf("[BRAGI PUBLICATION] %s: %s", req.publication_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    public record BragiVariantRequest(
        String variant_id, String publication_id, String channel_id, String text_md,
        String status, String url, String published_at, String asset_id) {}

    @POST
    @Path("bragi/variant")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertBragiVariant(BragiVariantRequest req,
                                       @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.variant_id() == null || req.variant_id().isBlank())
            return badParams("variant_id required");
        if (!SAFE_ID.matcher(req.variant_id()).matches())
            return badParams("variant_id contains illegal characters");
        try {
            StringBuilder sql = new StringBuilder("UPDATE BragiVariant SET variant_id=:id");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("id", req.variant_id());
            if (req.text_md() != null)      { sql.append(", text_md=:tm");    p.put("tm", req.text_md()); }
            if (req.status() != null)       { sql.append(", status=:st");     p.put("st", req.status()); }
            if (req.url() != null)          { sql.append(", url=:url");      p.put("url", req.url()); }
            if (req.published_at() != null) { sql.append(", published_at=:pa"); p.put("pa", req.published_at()); }
            sql.append(" UPSERT WHERE variant_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                sql.toString(), p)).await().indefinitely();
            boolean linkedPub = false, linkedChannel = false, linkedAsset = false;
            if (req.publication_id() != null && !req.publication_id().isBlank()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE HAS_VARIANT FROM (SELECT FROM BragiPublication WHERE publication_id=:pid) " +
                    "TO (SELECT FROM BragiVariant WHERE variant_id=:vid) IF NOT EXISTS",
                    Map.of("pid", req.publication_id(), "vid", req.variant_id()))).await().indefinitely();
                linkedPub = true;
            }
            if (req.channel_id() != null && !req.channel_id().isBlank()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE IN_CHANNEL FROM (SELECT FROM BragiVariant WHERE variant_id=:vid) " +
                    "TO (SELECT FROM BragiChannel WHERE channel_id=:cid) IF NOT EXISTS",
                    Map.of("vid", req.variant_id(), "cid", req.channel_id()))).await().indefinitely();
                linkedChannel = true;
            }
            if (req.asset_id() != null && !req.asset_id().isBlank()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE HAS_ASSET FROM (SELECT FROM BragiVariant WHERE variant_id=:vid) " +
                    "TO (SELECT FROM BragiAsset WHERE asset_id=:aid) IF NOT EXISTS",
                    Map.of("vid", req.variant_id(), "aid", req.asset_id()))).await().indefinitely();
                linkedAsset = true;
            }
            return noStore(Response.ok(Map.of("ok", true, "variant_id", req.variant_id(),
                "linked_publication", linkedPub, "linked_channel", linkedChannel, "linked_asset", linkedAsset)));
        } catch (Exception e) {
            LOG.warnf("[BRAGI VARIANT] %s: %s", req.variant_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    public record BragiAssetRequest(
        String asset_id, String asset_type, String file_url, String alt, Long size_bytes,
        String attach_to_publication_id, String attach_to_variant_id) {}

    @POST
    @Path("bragi/asset")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertBragiAsset(BragiAssetRequest req,
                                     @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.asset_id() == null || req.asset_id().isBlank())
            return badParams("asset_id required");
        if (!SAFE_ID.matcher(req.asset_id()).matches())
            return badParams("asset_id contains illegal characters");
        try {
            StringBuilder sql = new StringBuilder("UPDATE BragiAsset SET asset_id=:id");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("id", req.asset_id());
            if (req.asset_type() != null) { sql.append(", asset_type=:at");  p.put("at", req.asset_type()); }
            if (req.file_url() != null)   { sql.append(", file_url=:fu");    p.put("fu", req.file_url()); }
            if (req.alt() != null)        { sql.append(", alt=:alt");        p.put("alt", req.alt()); }
            if (req.size_bytes() != null) { sql.append(", size_bytes=:sz");  p.put("sz", req.size_bytes()); }
            sql.append(" UPSERT WHERE asset_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                sql.toString(), p)).await().indefinitely();
            String attachedTo = null;
            if (req.attach_to_publication_id() != null && !req.attach_to_publication_id().isBlank()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE HAS_ASSET FROM (SELECT FROM BragiPublication WHERE publication_id=:pid) " +
                    "TO (SELECT FROM BragiAsset WHERE asset_id=:aid) IF NOT EXISTS",
                    Map.of("pid", req.attach_to_publication_id(), "aid", req.asset_id()))).await().indefinitely();
                attachedTo = "publication:" + req.attach_to_publication_id();
            } else if (req.attach_to_variant_id() != null && !req.attach_to_variant_id().isBlank()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE HAS_ASSET FROM (SELECT FROM BragiVariant WHERE variant_id=:vid) " +
                    "TO (SELECT FROM BragiAsset WHERE asset_id=:aid) IF NOT EXISTS",
                    Map.of("vid", req.attach_to_variant_id(), "aid", req.asset_id()))).await().indefinitely();
                attachedTo = "variant:" + req.attach_to_variant_id();
            }
            return noStore(Response.ok(Map.of("ok", true, "asset_id", req.asset_id(),
                "attached_to", attachedTo == null ? "" : attachedTo)));
        } catch (Exception e) {
            LOG.warnf("[BRAGI ASSET] %s: %s", req.asset_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── BRAGI content archive write — MCP-02: keywords, pages, campaigns ──────
    public record BragiKeywordRequest(
        String keyword_id, String phrase, String cluster, Integer freq_exact, Integer freq_broad,
        String source, String intent, String region_engine, String measured_at, String page_id) {}

    @POST
    @Path("bragi/keyword")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertBragiKeyword(BragiKeywordRequest req,
                                       @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.keyword_id() == null || req.keyword_id().isBlank())
            return badParams("keyword_id required");
        if (!SAFE_ID.matcher(req.keyword_id()).matches())
            return badParams("keyword_id contains illegal characters");
        try {
            StringBuilder sql = new StringBuilder("UPDATE BragiKeyword SET keyword_id=:id");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("id", req.keyword_id());
            if (req.phrase() != null)        { sql.append(", phrase=:ph");         p.put("ph", req.phrase()); }
            if (req.cluster() != null)       { sql.append(", cluster=:cl");        p.put("cl", req.cluster()); }
            if (req.freq_exact() != null)    { sql.append(", freq_exact=:fe");     p.put("fe", req.freq_exact()); }
            if (req.freq_broad() != null)    { sql.append(", freq_broad=:fb");     p.put("fb", req.freq_broad()); }
            if (req.source() != null)        { sql.append(", source=:src");       p.put("src", req.source()); }
            if (req.intent() != null)        { sql.append(", intent=:in");        p.put("in", req.intent()); }
            if (req.region_engine() != null) { sql.append(", region_engine=:re"); p.put("re", req.region_engine()); }
            if (req.measured_at() != null)   { sql.append(", measured_at=:ma");   p.put("ma", req.measured_at()); }
            sql.append(" UPSERT WHERE keyword_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                sql.toString(), p)).await().indefinitely();
            boolean linkedPage = false;
            if (req.page_id() != null && !req.page_id().isBlank()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE TARGETS_PAGE FROM (SELECT FROM BragiKeyword WHERE keyword_id=:kid) " +
                    "TO (SELECT FROM BragiPage WHERE page_id=:pgid) IF NOT EXISTS",
                    Map.of("kid", req.keyword_id(), "pgid", req.page_id()))).await().indefinitely();
                linkedPage = true;
            }
            return noStore(Response.ok(Map.of("ok", true, "keyword_id", req.keyword_id(), "linked_page", linkedPage)));
        } catch (Exception e) {
            LOG.warnf("[BRAGI KEYWORD] %s: %s", req.keyword_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    public record BragiPageRequest(
        String page_id, String url, String title, String description, String page_type, String deployed_at) {}

    @POST
    @Path("bragi/page")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertBragiPage(BragiPageRequest req,
                                    @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.page_id() == null || req.page_id().isBlank())
            return badParams("page_id required");
        if (!SAFE_ID.matcher(req.page_id()).matches())
            return badParams("page_id contains illegal characters");
        try {
            StringBuilder sql = new StringBuilder("UPDATE BragiPage SET page_id=:id");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("id", req.page_id());
            if (req.url() != null)         { sql.append(", url=:url");         p.put("url", req.url()); }
            if (req.title() != null)       { sql.append(", title=:title");     p.put("title", req.title()); }
            if (req.description() != null) { sql.append(", description=:d");   p.put("d", req.description()); }
            if (req.page_type() != null)   { sql.append(", page_type=:pt");    p.put("pt", req.page_type()); }
            if (req.deployed_at() != null) { sql.append(", deployed_at=:da");  p.put("da", req.deployed_at()); }
            sql.append(" UPSERT WHERE page_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                sql.toString(), p)).await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "page_id", req.page_id())));
        } catch (Exception e) {
            LOG.warnf("[BRAGI PAGE] %s: %s", req.page_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    public record BragiCampaignRequest(
        String campaign_id, String utm_source, String utm_medium, String utm_campaign,
        String target_url, String period, String variant_id) {}

    @POST
    @Path("bragi/campaign")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertBragiCampaign(BragiCampaignRequest req,
                                        @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response guard = requireAdmin(role);
        if (guard != null) return guard;
        if (req == null || req.campaign_id() == null || req.campaign_id().isBlank())
            return badParams("campaign_id required");
        if (!SAFE_ID.matcher(req.campaign_id()).matches())
            return badParams("campaign_id contains illegal characters");
        try {
            StringBuilder sql = new StringBuilder("UPDATE BragiCampaign SET campaign_id=:id");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("id", req.campaign_id());
            if (req.utm_source() != null)   { sql.append(", utm_source=:us");   p.put("us", req.utm_source()); }
            if (req.utm_medium() != null)   { sql.append(", utm_medium=:um");   p.put("um", req.utm_medium()); }
            if (req.utm_campaign() != null) { sql.append(", utm_campaign=:uc"); p.put("uc", req.utm_campaign()); }
            if (req.target_url() != null)   { sql.append(", target_url=:tu");   p.put("tu", req.target_url()); }
            if (req.period() != null)       { sql.append(", period=:pe");       p.put("pe", req.period()); }
            sql.append(" UPSERT WHERE campaign_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                sql.toString(), p)).await().indefinitely();
            boolean linkedVariant = false;
            if (req.variant_id() != null && !req.variant_id().isBlank()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE FOR_VARIANT FROM (SELECT FROM BragiCampaign WHERE campaign_id=:cid) " +
                    "TO (SELECT FROM BragiVariant WHERE variant_id=:vid) IF NOT EXISTS",
                    Map.of("cid", req.campaign_id(), "vid", req.variant_id()))).await().indefinitely();
                linkedVariant = true;
            }
            return noStore(Response.ok(Map.of("ok", true, "campaign_id", req.campaign_id(), "linked_variant", linkedVariant)));
        } catch (Exception e) {
            LOG.warnf("[BRAGI CAMPAIGN] %s: %s", req.campaign_id(), e.getMessage());
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

    /** ISO-week id for the rotating QG-housekeeping sprint, e.g. "SPRINT_QG_HOUSEKEEPING_2026W27". */
    private static String weeklyHousekeepingSprintId() {
        java.time.temporal.WeekFields wf = java.time.temporal.WeekFields.ISO;
        java.time.LocalDate today = java.time.LocalDate.now(java.time.ZoneOffset.UTC);
        int isoWeek = today.get(wf.weekOfWeekBasedYear());
        int isoYear = today.get(wf.weekBasedYear());
        return String.format("SPRINT_QG_HOUSEKEEPING_%dW%02d", isoYear, isoWeek);
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

    private static String str(Object o) {
        return o == null ? "" : o.toString().trim();
    }
}
