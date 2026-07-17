package studio.seer.heimdall.lore;

import io.smallrye.mutiny.Uni;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;
import studio.seer.heimdall.bench.MartQuery;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The cross-entity status-transition engine (B2 God-class split). Handles
 * generic SCD2 status flips for sprint/task/phase plus the direct (non-SCD2)
 * ADR status setter, batch status updates, and sprint plan-field edits — all
 * genuinely cross-cutting concerns that don't belong to any single CRUD
 * domain. Shares infra via LoreResourceBase.
 */
@Path("/lore")
public class LoreStatusResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreStatusResource.class);

    @jakarta.inject.Inject
    LoreHashStamper hashStamper; // SV-10: content_hash на открытой Hist-строке после записи тел

    public record StatusUpdateRequest(String entity_type, String id, String status) {}
    record StatusRevision(String valid_from, String plan_version) {}
    public record StatusUpdateResponse(
        boolean ok, String entity_type, String id,
        String old_status, String new_status, StatusRevision revision) {}
    public record BatchStatusRequest(String entity_type, List<String> ids, String status) {}

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
        Uni<Response> flip = switch (req.entity_type()) {
            // Read the currently-open row's plan fields (priority/planned_*/track_id)
            // BEFORE the SCD2 flip, then restore them onto the freshly-opened row —
            // updateScd2Status's INSERT only carries state_uid/status_raw/valid_from,
            // so without this a status change would silently wipe planning data.
            case "sprint"    -> readSprintPlanFields(req.id())
                                  .chain(fields -> updateScd2Status("sprint", "KnowSprint", "KnowSprintHist",
                                    "sprint_id", req.id(), req.status(), now, nsid)
                                  .chain(resp -> resp.getStatus() >= 300
                                    ? Uni.createFrom().item(resp)
                                    // Best-effort: the status flip above already succeeded and is
                                    // the primary outcome the caller asked for. A failure restoring
                                    // plan fields (priority/planned_*/track_id/pr_refs) onto the new
                                    // hist row is a secondary consistency nicety — surface it in
                                    // logs, but don't turn an already-successful status change into
                                    // an opaque 500 for the caller.
                                    : restoreSprintPlanFields(nsid, fields)
                                        .onFailure().invoke(ex -> LOG.warnf(
                                            "[LORE STATUS] sprint=%s plan-field restore failed (status flip itself succeeded): %s",
                                            req.id(), ex.getMessage()))
                                        .onFailure().recoverWithItem(new LoreCommandClient.LoreCommandResult(null))
                                        .replaceWith(resp)));
            // ADR-LORE-014 §4: →done is gated — refuse self-acceptance (reviewer_agent
            // unset or equal to executor_agent) BEFORE the SCD2 flip. Every other task
            // transition is ungated (RBAC-only, per the ADR's "one hard-gate" decision).
            case "task"      -> ("done".equals(req.status())
                                    ? checkTaskDoneGate(req.id())
                                    : Uni.createFrom().<Response>item((Response) null))
                                  .chain(gate -> gate != null
                                    ? Uni.createFrom().item(gate)
                                    : readTaskHistCarryFields(req.id())
                                        .chain(fields -> updateScd2Status("task", "KnowTask", "KnowTaskHist",
                                          "task_uid", req.id(), req.status(), now, nsid)
                                        .chain(resp -> resp.getStatus() >= 300
                                          ? Uni.createFrom().item(resp)
                                          : restoreTaskHistFields(nsid,
                                                (String) fields.get("note_md"),
                                                fields.get("effort_days") == null ? null
                                                    : ((Number) fields.get("effort_days")).doubleValue())
                                              .onFailure().invoke(ex -> LOG.warnf(
                                                  "[LORE STATUS] task=%s note/effort carry-forward failed (status flip itself succeeded): %s",
                                                  req.id(), ex.getMessage()))
                                              .onFailure().recoverWithItem(new LoreCommandClient.LoreCommandResult(null))
                                              .replaceWith(resp))));
            // MCP-PHASES: same SCD2 flip as sprint/task — KnowPhase carries HAS_STATE → KnowPhaseHist
            case "phase"     -> updateScd2Status("phase", "KnowPhase", "KnowPhaseHist",
                                    "phase_uid", req.id(), req.status(), now, nsid);
            case "adr"       -> updateAdrStatusDirect(req.id(), req.status().toUpperCase(), now);
            default          -> Uni.createFrom().item(noStore(Response.status(501)
                                    .entity(new LoreError("NOT_IMPLEMENTED",
                                        req.entity_type() + " not supported yet"))));
        };
        // SV-10: у задач carry-forward несёт note_md, но не content_hash — доштамповать
        // на свежеоткрытой строке (спринт несёт хэш через SPRINT_PLAN_FIELDS).
        return flip.invoke(r -> {
            if (r != null && r.getStatus() < 300 && "task".equals(req.entity_type()))
                hashStamper.stampOpenHist("KnowTaskHist", "KnowTask", "task_uid", req.id());
        });
    }

    /**
     * SCD2 status flip for KnowSprint / KnowTask:
     *   1. close the current open state row (valid_to = now)
     *   2. insert a new {@code <histType>} state row (valid_from = now, status_raw = mapped)
     *   3. link it: CREATE EDGE HAS_STATE entity → new state
     *   4. denormalise the current status_raw onto the entity vertex
     * Entities with no open state row (some backfilled tasks) skip step 1.
     *
     * Package-private (not private): ADR-LORE-013's task/move endpoint
     * (LoreSprintTaskResource) reuses this — plus the two task carry-forward
     * helpers below — to cancel the source task via the exact same SCD2 flip
     * every other status change goes through, instead of duplicating the
     * transition logic. LoreStatusResource stays the sole owner of the
     * mechanism; callers inject this class as a bean (same pattern as
     * ingestService) and call through it.
     */
    Uni<Response> updateScd2Status(String entityType, String vertexType, String histType,
                                           String keyField, String id, String token,
                                           String now, String nsid) {
        final String newRaw = SCD2_STATUS_RAW.getOrDefault(token, token);
        // Guard: the entity vertex must exist. Without this an unknown id — e.g. a
        // bare task_id "T40" instead of the full task_uid "SPRINT_X/T40" — slips
        // through: the CREATE EDGE FROM (SELECT ... WHERE keyField=:id) matches
        // nothing, so an ORPHAN hist row gets inserted yet the call still reports
        // ok:true (a silent no-op that leaves the status unchanged). Fail loud.
        MartQuery existsQ = new MartQuery("sql",
            "SELECT count(*) AS n FROM " + vertexType + " WHERE " + keyField + " = :id",
            Map.of("id", id), -1);
        return client.query(db, basicAuth(), existsQ).chain(exRes -> {
            List<Map<String, Object>> exRows = exRes.result() != null ? exRes.result() : List.of();
            long cnt = exRows.isEmpty() ? 0L : ((Number) exRows.get(0).getOrDefault("n", 0)).longValue();
            if (cnt == 0) {
                return Uni.createFrom().item(noStore(Response.status(Response.Status.NOT_FOUND)
                    .entity(new LoreError("NOT_FOUND", entityType + " '" + id + "' not found — id must be the full "
                        + keyField + " (a task needs \"SPRINT_X/T05\", not a bare task_id)"))));
            }
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

                // A1: close-old + open-new + HAS_STATE edge + denormalize run as one
                // atomic sqlscript (ArcadeDB implicit transaction). A partial SCD2
                // transition can no longer leave two open hist rows, or an entity
                // whose denormalized status_raw disagrees with its open hist row.
                // vertexType/histType/keyField come from the internal type switch,
                // never user input; id is bound as a parameter.
                StringBuilder script = new StringBuilder();
                Map<String, Object> p = new java.util.HashMap<>();
                p.put("nsid", nsid); p.put("ns", newRaw); p.put("now", now); p.put("id", id);
                if (oldRid != null && oldRid.startsWith("#")) {
                    script.append("UPDATE ").append(histType)
                          .append(" SET valid_to = :now WHERE @rid = :oldrid;");
                    p.put("oldrid", oldRid);
                }
                script.append("INSERT INTO ").append(histType)
                      .append(" SET state_uid = :nsid, status_raw = :ns, valid_from = :now;")
                      .append("CREATE EDGE HAS_STATE FROM (SELECT FROM ").append(vertexType)
                      .append(" WHERE ").append(keyField).append(" = :id) ")
                      .append("TO (SELECT FROM ").append(histType).append(" WHERE state_uid = :nsid);")
                      .append("UPDATE ").append(vertexType)
                      .append(" SET status_raw = :ns WHERE ").append(keyField).append(" = :id;");

                return writeClient.command(db, basicAuth(),
                        new LoreCommandClient.LoreCommand("sqlscript", script.toString(), p))
                    .map(__ -> noStore(Response.ok(new StatusUpdateResponse(
                        true, entityType, id, oldStatus, newRaw,
                        new StatusRevision(now, null)))));
                });
        })
            .onFailure().recoverWithItem(ex -> {
                LOG.warnf("[LORE STATUS] %s=%s: %s", entityType, id, ex.getMessage());
                return noStore(Response.status(Response.Status.BAD_GATEWAY)
                    .entity(new LoreError("LORE_UPSTREAM", ex.getMessage())));
            });
    }

    // ── SPRINT_PLANITEM_RETIRE: sprint plan-field carry-forward helpers ──────
    // priority/planned_start_date/planned_end_date/track_id all live on the open
    // KnowSprintHist row. Any SCD2 transition that inserts a fresh row (status
    // flip via updateScd2Status, or an explicit plan edit via /lore/sprint/plan)
    // must carry these forward, or they silently disappear. pr_refs joined this
    // list after a live bug: a status flip right after sprint_set (pr_refs)
    // wiped the just-added PR links, because the freshly-opened hist row only
    // ever inherited the plan fields above.
    // planned_milestone_id used to live here too — retired. It required this
    // exact carry-forward mechanism to stay in sync with the TARGETS_MILESTONE
    // edge (which needs no such handling — edges point at the stable KnowSprint
    // vertex, not the hist row, so they survive SCD2 transitions untouched) and
    // drifted on 62+ sprints in production before removal.
    // SV-10/ADR-021 (2026-07-17): + context_md/outcome_md/content_hash. До этого
    // смена статуса спринта ПЕРЕНОСИЛА план-поля, но НЕ тела — каждый флип
    // осиротлял эссе спринта на закрытой строке (ровно carry-forward класс,
    // от которого задачи защищены restoreTaskHistFields, а спринты не были).
    private static final List<String> SPRINT_PLAN_FIELDS = List.of(
        "priority", "planned_start_date", "planned_end_date", "track_id", "pr_refs",
        "context_md", "outcome_md", "content_hash");

    private Uni<Map<String, Object>> readSprintPlanFields(String sprintId) {
        MartQuery q = new MartQuery("sql",
            "SELECT priority, planned_start_date, planned_end_date, track_id, pr_refs, " +
            "context_md, outcome_md, content_hash " +
            "FROM KnowSprintHist WHERE in('HAS_STATE').sprint_id[0] = :sid AND valid_to IS NULL LIMIT 1",
            Map.of("sid", sprintId), -1);
        return client.query(db, basicAuth(), q).map(res -> {
            List<Map<String, Object>> rows = res.result() != null ? res.result() : List.of();
            return rows.isEmpty() ? Map.<String, Object>of() : rows.get(0);
        });
    }

    // Targets the new hist row by state_uid (the same value used to CREATE EDGE
    // HAS_STATE moments earlier in updateScd2Status) rather than re-traversing
    // in('HAS_STATE') — a live bug showed that traversal-based UPDATE right
    // after a CREATE EDGE on the same connection can find zero rows (the edge
    // not yet visible to a fresh traversal query), silently failing to carry
    // pr_refs forward and surfacing as an opaque 500. state_uid is a plain
    // indexed property lookup, no edge traversal required, so it can't miss.
    private Uni<LoreCommandClient.LoreCommandResult> restoreSprintPlanFields(
            String nsid, Map<String, Object> fields) {
        if (fields.isEmpty()) return Uni.createFrom().item(new LoreCommandClient.LoreCommandResult(null));
        StringBuilder sb = new StringBuilder("UPDATE KnowSprintHist SET ");
        Map<String, Object> p = new LinkedHashMap<>();
        for (String f : SPRINT_PLAN_FIELDS) {
            if (fields.get(f) != null) { sb.append(f).append("=:").append(f).append(", "); p.put(f, fields.get(f)); }
        }
        // fields can be non-empty (one hist row read) while every SPRINT_PLAN_FIELDS
        // value on it is null (a bare sprint with no priority/dates/track/pr_refs set
        // yet) — p stays empty in that case, which is the real "nothing to restore"
        // signal. A string-equality check on the built SET clause used to gate this
        // instead and never matched (StringBuilder's seed already has a trailing
        // space the check didn't account for), so every status flip on such a
        // sprint fired an invalid empty "UPDATE ... SET " and logged a spurious 500.
        if (p.isEmpty()) return Uni.createFrom().item(new LoreCommandClient.LoreCommandResult(null));
        String set = sb.toString().replaceAll(",\\s*$", "");
        p.put("nsid", nsid);
        return writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
            set + " WHERE state_uid = :nsid", p));
    }

    // ── Write-path: real-SCD2 edit of sprint plan fields ─────────────────────
    // Unlike updateSprint() (in-place vertex mutation, no history), this closes
    // the open KnowSprintHist row and opens a new one — same contract as
    // updateScd2Status — carrying forward every SPRINT_PLAN_FIELDS value the
    // caller didn't explicitly override. priority moves here exclusively;
    // updateSprint() no longer accepts it (see its handler).

    public record SprintPlanRequest(String sprint_id, String priority, String planned_start_date,
        String planned_end_date, String track_id) {}

    @POST
    @Path("sprint/plan")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Uni<Response> updateSprintPlan(SprintPlanRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return Uni.createFrom().item(disabled());
        requireAdmin(role);
        if (req == null || req.sprint_id() == null || req.sprint_id().isBlank())
            return Uni.createFrom().item(badParams("sprint_id required"));
        if (!SAFE_ID.matcher(req.sprint_id()).matches())
            return Uni.createFrom().item(badParams("sprint_id contains illegal characters"));
        if (req.priority() == null && req.planned_start_date() == null && req.planned_end_date() == null
                && req.track_id() == null)
            return Uni.createFrom().item(badParams("at least one field required"));

        final String sid  = req.sprint_id();
        final String now  = Instant.now().toString();
        final String nsid = UUID.randomUUID().toString();

        // + context_md/outcome_md/content_hash (2026-07-17): этот close-open нёс тот же
        // carry-forward баг, что и статус-флип, — тела спринта терялись при правке плана.
        MartQuery readQ = new MartQuery("sql",
            "SELECT @rid AS rid, status_raw, priority, planned_start_date, planned_end_date, " +
            "track_id, pr_refs, context_md, outcome_md, content_hash FROM KnowSprintHist " +
            "WHERE in('HAS_STATE').sprint_id[0] = :sid AND valid_to IS NULL LIMIT 1",
            Map.of("sid", sid), -1);

        return client.query(db, basicAuth(), readQ).chain(res -> {
            List<Map<String, Object>> rows = res.result() != null ? res.result() : List.of();
            if (rows.isEmpty())
                return Uni.createFrom().item(badParams("sprint has no open hist row: " + sid));
            Map<String, Object> cur = rows.get(0);
            String oldRid = String.valueOf(cur.getOrDefault("rid", ""));

            Map<String, Object> next = new LinkedHashMap<>();
            next.put("status_raw",           cur.get("status_raw"));
            next.put("priority",             req.priority()             != null ? req.priority()             : cur.get("priority"));
            next.put("planned_start_date",   req.planned_start_date()   != null ? req.planned_start_date()   : cur.get("planned_start_date"));
            next.put("planned_end_date",     req.planned_end_date()     != null ? req.planned_end_date()     : cur.get("planned_end_date"));
            next.put("track_id",             req.track_id()             != null ? req.track_id()             : cur.get("track_id"));
            next.put("pr_refs",              cur.get("pr_refs"));
            next.put("context_md",           cur.get("context_md"));
            next.put("outcome_md",           cur.get("outcome_md"));
            next.put("content_hash",         cur.get("content_hash"));

            Uni<LoreCommandClient.LoreCommandResult> closeOld = oldRid.startsWith("#")
                ? writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "UPDATE KnowSprintHist SET valid_to = :now WHERE @rid = :rid",
                    Map.of("now", now, "rid", oldRid)))
                : Uni.createFrom().item(new LoreCommandClient.LoreCommandResult(null));

            Map<String, Object> insertParams = new LinkedHashMap<>(next);
            insertParams.put("nsid", nsid);
            insertParams.put("now", now);

            return closeOld
                .chain(__ -> writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "INSERT INTO KnowSprintHist SET state_uid = :nsid, valid_from = :now, " +
                    "status_raw = :status_raw, priority = :priority, planned_start_date = :planned_start_date, " +
                    "planned_end_date = :planned_end_date, " +
                    "track_id = :track_id, pr_refs = :pr_refs, " +
                    "context_md = :context_md, outcome_md = :outcome_md, content_hash = :content_hash",
                    insertParams)))
                .chain(__ -> writeClient.command(db, basicAuth(), linkStateCmd(
                    "KnowSprint", "KnowSprintHist", "sprint_id", sid, nsid)))
                .map(__ -> {
                    Map<String, Object> out = new LinkedHashMap<>(next);
                    out.put("ok", true);
                    out.put("sprint_id", sid);
                    out.remove("status_raw");
                    return noStore(Response.ok(out));
                });
        }).onFailure().recoverWithItem(ex -> {
            LOG.warnf("[LORE SPRINT PLAN] %s: %s", sid, ex.getMessage());
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

    /**
     * ADR-LORE-014 §4 hard-gate: a task may not move to {@code done} if it has no
     * reviewer_agent, or if reviewer_agent equals executor_agent (no self-acceptance).
     * Returns null when the transition may proceed, or a 409 Response to short-circuit
     * with otherwise. author/executor/reviewer_agent are plain KnowTask vertex fields
     * (not Hist — see LoreSchemaInitializer), so this is a single non-traversal read.
     */
    private Uni<Response> checkTaskDoneGate(String taskUid) {
        MartQuery q = new MartQuery("sql",
            "SELECT executor_agent, reviewer_agent FROM KnowTask WHERE task_uid = :uid LIMIT 1",
            Map.of("uid", taskUid), -1);
        return client.query(db, basicAuth(), q).map(res -> {
            List<Map<String, Object>> rows = res.result() != null ? res.result() : List.of();
            if (rows.isEmpty()) return null; // unknown task — let the normal flip report NOT_FOUND-shaped failure
            String executor = (String) rows.get(0).get("executor_agent");
            String reviewer = (String) rows.get(0).get("reviewer_agent");
            if (reviewer == null || reviewer.isBlank() || reviewer.equals(executor)) {
                return noStore(Response.status(Response.Status.CONFLICT)
                    .entity(new LoreError("NO_SELF_ACCEPTANCE",
                        "task cannot move to done: reviewer_agent must be set and differ from executor_agent")));
            }
            return null;
        });
    }

    /** Read note_md / effort_days from the currently-open KnowTaskHist row BEFORE a SCD2 flip.
     * Package-private — see updateScd2Status's Javadoc (ADR-LORE-013 task/move reuse). */
    Uni<Map<String, Object>> readTaskHistCarryFields(String taskUid) {
        MartQuery q = new MartQuery("sql",
            "SELECT note_md, effort_days FROM KnowTaskHist" +
            " WHERE in('HAS_STATE').task_uid CONTAINS :uid AND valid_to IS NULL LIMIT 1",
            Map.of("uid", taskUid), -1);
        return client.query(db, basicAuth(), q).map(res -> {
            List<Map<String, Object>> rows = res.result() != null ? res.result() : List.of();
            return rows.isEmpty() ? Map.<String, Object>of() : rows.get(0);
        });
    }

    /**
     * Restore note_md / effort_days onto the newly-opened KnowTaskHist row after a SCD2 flip.
     * Targets by state_uid (indexed property, no edge traversal) to avoid the CREATE EDGE
     * visibility race that would break an in('HAS_STATE') traversal done on the same connection.
     * Package-private — see updateScd2Status's Javadoc (ADR-LORE-013 task/move reuse).
     */
    Uni<LoreCommandClient.LoreCommandResult> restoreTaskHistFields(
            String nsid, String noteMd, Double effortDays) {
        StringBuilder sb = new StringBuilder("UPDATE KnowTaskHist SET ");
        Map<String, Object> p = new LinkedHashMap<>();
        if (noteMd     != null) { sb.append("note_md = :note, ");     p.put("note", noteMd); }
        if (effortDays != null) { sb.append("effort_days = :eff, ");  p.put("eff", effortDays); }
        if (p.isEmpty()) return Uni.createFrom().item(new LoreCommandClient.LoreCommandResult(null));
        String set = sb.toString().replaceAll(",\\s*$", "");
        p.put("nsid", nsid);
        return writeClient.command(db, basicAuth(),
            new LoreCommandClient.LoreCommand("sql", set + " WHERE state_uid = :nsid", p));
    }

    // ── Write-path: batch status update ──────────────────────────────────────

    @POST
    @Path("status/batch")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response batchSetStatus(BatchStatusRequest req,
                                   @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
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
}
