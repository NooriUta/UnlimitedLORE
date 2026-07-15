package studio.seer.heimdall.lore;

import io.smallrye.mutiny.Uni;
import jakarta.inject.Inject;
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
 * Sprint/task/phase write endpoints (create, edit, phase attach, sprint/PR
 * refs, sprint↔project/component links, task↔component links, sprint deps),
 * split out of AidaLoreResource (B2). The generic status dispatch (including
 * sprint plan-field edits via /lore/sprint/plan) lives in LoreStatusResource,
 * not here. Shares infra via LoreResourceBase.
 */
@Path("/lore")
public class LoreSprintTaskResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreSprintTaskResource.class);

    // ADR-LORE-013 (task/move) reuses LoreStatusResource's SCD2 transition + task
    // carry-forward helpers to cancel the source task — see updateScd2Status's
    // Javadoc for why those are package-private instead of duplicated here.
    @Inject
    LoreStatusResource statusResource;

    public record SprintRefsRequest(String sprint_id, List<Integer> pr_numbers,
        String git_project, String repo_url, Boolean replace) {}
    // priority moved to SprintPlanRequest/POST /lore/sprint/plan — it's SCD2-tracked
    // (lives on KnowSprintHist), unlike the vertex-only fields below.
    // no_release_required: sprints that never ship a versioned release (docs-only,
    // research spikes, internal tooling) — excluded from deploy-lag/unreleased-burn
    // metrics in LoreAnalytics, which would otherwise flag them as perpetually overdue.
    public record SprintUpdateRequest(String sprint_id, String name, String outcome_md,
        String context_md, String plan_id, Double effort_days, Boolean no_release_required) {}
    // author/executor/reviewer_agent (ADR-LORE-014 §4): free-text identity of who
    // owns/does/accepts the task — on the vertex, not Hist (see LoreSchemaInitializer
    // comment for why: immune to the note_md/effort_days carry-forward bug class).
    // task_type (ADR-LORE-015, T14): defaults to "dev" when omitted — a vertex-only
    // field like author/executor/reviewer_agent above, so no carry-forward concern.
    public record TaskCreateRequest(String sprint_id, String task_id, String title, String note_md,
        String phase_uid, String author_agent, String executor_agent, String reviewer_agent,
        String task_type) {}
    // effort_days: fractional, granular to the hour (1 day = 8 working hours,
    // so the smallest meaningful increment is 0.125). Was Integer — too coarse
    // to estimate sub-day tasks.
    public record TaskEditRequest(String task_uid, String title, String note_md, Double effort_days,
        String author_agent, String executor_agent, String reviewer_agent, String task_type) {}
    public record TaskWriteResponse(boolean ok, String task_uid, String task_id, Integer order_index) {}
    // MCP-PHASES (SPRINT_LORE_MCP_GAPS_2): sprint phases write-path
    public record PhaseCreateRequest(String sprint_id, String phase_key, String name, Integer order_index) {}
    public record PhaseWriteResponse(boolean ok, String phase_uid, String phase_id,
        Integer order_index, boolean created) {}
    public record TaskPhaseRequest(String task_uid, String phase_uid, String action) {}

    public record SprintCreateRequest(String sprint_id, String name, String status,
        String plan_id, String priority, String outcome_md, String context_md, String git_project) {}

    // ── Write-path: create sprint directly ───────────────────────────────────

    @POST
    @Path("sprint/create")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response createSprint(SprintCreateRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
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
                req.sprint_id(), req.name(), status, req.plan_id(), req.priority(), req.outcome_md(), req.context_md());
            // ADR-LORE-017 §Решение 2: sprint_new gets the same optional project param
            // release_new/release_link/sprint_link(rel:"project") already have — brings
            // Tier-1 write coverage in line, no separate call needed for the common case
            // of creating a sprint that already belongs to a known repo.
            if (req.git_project() != null && !req.git_project().isBlank()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE BELONGS_TO_PROJECT " +
                    "FROM (SELECT FROM KnowSprint WHERE sprint_id=:sid) " +
                    "TO   (SELECT FROM KnowGitProject WHERE slug=:gp) IF NOT EXISTS",
                    Map.of("sid", req.sprint_id(), "gp", req.git_project()))).await().indefinitely();
            }
            java.util.LinkedHashMap<String, Object> out = new java.util.LinkedHashMap<>();
            out.put("ok", true);
            out.put("sprint_id", r.sprintId());
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
        requireAdmin(role);
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

                // A1: one atomic sqlscript. ArcadeDB runs all statements in a single
                // implicit transaction, so a mid-sequence failure rolls the whole
                // create back — no orphan KnowTask left without its HAS_STATE hist
                // row. A later statement also sees rows inserted by an earlier one in
                // the same script, so the HAS_STATE edge resolves reliably (this used
                // to need separate commands + careful ordering).
                // note_md lives on the hist row: tasks_of_sprint / tasks_of_phase read
                // it via out('HAS_STATE')[note_md IS NOT NULL].note_md[0], not the vertex.
                final String taskType = (req.task_type() == null || req.task_type().isBlank())
                    ? "dev" : req.task_type();
                StringBuilder script = new StringBuilder()
                    .append("INSERT INTO KnowTask SET task_uid = :uid, task_id = :tid, title = :title, ")
                    .append("note_md = :note, order_index = :oi, src = 'manual', task_type = :tt, ")
                    .append("author_agent = :author, executor_agent = :executor, reviewer_agent = :reviewer;")
                    .append("CREATE EDGE PART_OF FROM (SELECT FROM KnowTask WHERE task_uid = :uid) ")
                    .append("TO (SELECT FROM KnowSprint WHERE sprint_id = :sid);")
                    .append("INSERT INTO KnowTaskHist SET state_uid = :nsid, status_raw = '📋 PLANNED', ")
                    .append("valid_from = :now, note_md = :note;")
                    .append("CREATE EDGE HAS_STATE FROM (SELECT FROM KnowTask WHERE task_uid = :uid) ")
                    .append("TO (SELECT FROM KnowTaskHist WHERE state_uid = :nsid);");
                Map<String, Object> p = mapOfNullable("uid", uid, "tid", tid, "title", title,
                    "note", note, "oi", order, "sid", sid, "nsid", nsid, "now", now, "tt", taskType,
                    "author", req.author_agent(), "executor", req.executor_agent(), "reviewer", req.reviewer_agent());
                // MCP-PHASES: optional task → phase attachment (tasks_of_phase reads out('IN_PHASE'))
                if (phase != null) {
                    script.append("CREATE EDGE IN_PHASE FROM (SELECT FROM KnowTask WHERE task_uid = :uid) ")
                          .append("TO (SELECT FROM KnowPhase WHERE phase_uid = :puid);");
                    p.put("puid", phase);
                }
                return writeClient.command(db, basicAuth(),
                        new LoreCommandClient.LoreCommand("sqlscript", script.toString(), p))
                    .map(__ -> noStore(Response.ok(new TaskWriteResponse(true, uid, tid, order))));
            })
            .onFailure().recoverWithItem(ex -> {
                LOG.warnf("[LORE TASK CREATE] %s: %s", uid, ex.getMessage());
                return noStore(Response.status(Response.Status.BAD_GATEWAY)
                    .entity(new LoreError("LORE_UPSTREAM", ex.getMessage())));
            });
    }

    // ── ADR-LORE-013: move a task between sprints (cancel + recreate) ────────
    // Creates a fresh copy in the target sprint (title/note_md/effort_days +
    // TAGGED_WITH component links, initial PLANNED state) and cancels the source
    // (stays as a ❌ tombstone in the old sprint, note carried forward per #88).
    // No PK re-key / SCD2 surgery — reuses the create + status write paths.
    public record TaskMoveRequest(String task_uid, String target_sprint_id, String new_task_id) {}

    @POST
    @Path("task/move")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response moveTask(TaskMoveRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.task_uid() == null || req.task_uid().isBlank()
                || req.target_sprint_id() == null || req.target_sprint_id().isBlank())
            return badParams("task_uid and target_sprint_id required");
        if (!SAFE_ID.matcher(req.target_sprint_id()).matches()
                || (req.new_task_id() != null && !req.new_task_id().isBlank()
                    && !SAFE_ID.matcher(req.new_task_id()).matches()))
            return badParams("target_sprint_id / new_task_id contain illegal characters");
        final String oldUid = req.task_uid();
        final String targetSid = req.target_sprint_id();
        final String now = Instant.now().toString();
        final String nsid = UUID.randomUUID().toString();   // new task's PLANNED hist
        final String cnsid = UUID.randomUUID().toString();  // source's CANCELLED hist
        try {
            List<Map<String, Object>> src = ingestService.queryPublic(
                "SELECT task_id, title, task_type, author_agent, executor_agent, reviewer_agent, " +
                "out('HAS_STATE')[note_md IS NOT NULL].note_md[0]         AS note_md, " +
                "out('HAS_STATE')[effort_days IS NOT NULL].effort_days[0] AS effort_days, " +
                "out('TAGGED_WITH').component_id AS components " +
                "FROM KnowTask WHERE task_uid=:u LIMIT 1", Map.of("u", oldUid));
            if (src.isEmpty()) return badParams("task not found: " + oldUid);
            if (ingestService.queryPublic("SELECT sprint_id FROM KnowSprint WHERE sprint_id=:s LIMIT 1",
                    Map.of("s", targetSid)).isEmpty())
                return badParams("target sprint not found: " + targetSid);
            Map<String, Object> s = src.get(0);
            String title    = (String) s.get("title");
            String note     = (String) s.get("note_md");
            Object effort   = s.get("effort_days");
            // ADR-LORE-013 amendment: task_type (T00) + author/executor/reviewer_agent
            // (T05) are plain vertex fields on KnowTask (not Hist) — carry across the
            // cancel+recreate the same way title/note_md do, no SCD2 involved.
            String taskType = (String) s.get("task_type");
            String author   = (String) s.get("author_agent");
            String executor = (String) s.get("executor_agent");
            String reviewer = (String) s.get("reviewer_agent");
            List<?> comps = s.get("components") instanceof List<?> l ? l : List.of();

            // Resolve a collision-free task_id in the target sprint.
            String wantTid = (req.new_task_id() != null && !req.new_task_id().isBlank())
                ? req.new_task_id() : (String) s.get("task_id");
            String tid = wantTid;
            for (int k = 2; taskExists(targetSid + "/" + tid); k++) tid = wantTid + "_" + k;
            final String newUid = targetSid + "/" + tid;

            String prefix = targetSid + "/";
            List<Map<String, Object>> mx = ingestService.queryPublic(
                "SELECT max(order_index) AS mx FROM KnowTask WHERE task_uid.substring(0, :plen) = :prefix",
                Map.of("prefix", prefix, "plen", prefix.length()));
            int order = (!mx.isEmpty() && mx.get(0).get("mx") instanceof Number n ? n.intValue() : 0) + 1;

            // Create the new task (mirrors createTask's atomic sqlscript).
            StringBuilder script = new StringBuilder()
                .append("INSERT INTO KnowTask SET task_uid=:uid, task_id=:tid, title=:title, note_md=:note, order_index=:oi, src='manual', ")
                .append("task_type=:tt, author_agent=:author, executor_agent=:executor, reviewer_agent=:reviewer;")
                .append("CREATE EDGE PART_OF FROM (SELECT FROM KnowTask WHERE task_uid=:uid) TO (SELECT FROM KnowSprint WHERE sprint_id=:sid);")
                .append("INSERT INTO KnowTaskHist SET state_uid=:nsid, status_raw='📋 PLANNED', valid_from=:now, note_md=:note")
                .append(effort != null ? ", effort_days=:eff;" : ";")
                .append("CREATE EDGE HAS_STATE FROM (SELECT FROM KnowTask WHERE task_uid=:uid) TO (SELECT FROM KnowTaskHist WHERE state_uid=:nsid);");
            Map<String, Object> p = mapOfNullable("uid", newUid, "tid", tid, "title", title,
                "note", note, "oi", order, "sid", targetSid, "nsid", nsid, "now", now,
                "tt", taskType, "author", author, "executor", executor, "reviewer", reviewer);
            if (effort != null) p.put("eff", effort);
            for (Object c : comps) {
                if (c == null) continue;
                script.append(String.format(
                    "CREATE EDGE TAGGED_WITH FROM (SELECT FROM KnowTask WHERE task_uid='%s') TO (SELECT FROM LoreComponent WHERE component_id='%s');",
                    newUid, c));
            }
            writeClient.command(db, basicAuth(),
                new LoreCommandClient.LoreCommand("sqlscript", script.toString(), p)).await().indefinitely();

            // Cancel the source — reuse the /lore/status flip + #88 note carry-forward.
            Map<String, Object> carry = statusResource.readTaskHistCarryFields(oldUid).await().indefinitely();
            var resp = statusResource.updateScd2Status("task", "KnowTask", "KnowTaskHist", "task_uid",
                oldUid, "cancelled", now, cnsid).await().indefinitely();
            if (resp.getStatus() < 300) {
                statusResource.restoreTaskHistFields(cnsid, (String) carry.get("note_md"),
                    carry.get("effort_days") == null ? null : ((Number) carry.get("effort_days")).doubleValue())
                    .await().indefinitely();
            } else {
                LOG.warnf("[LORE TASK MOVE] %s created as %s but source cancel returned %d",
                    oldUid, newUid, resp.getStatus());
            }
            boolean tidChanged = !tid.equals(s.get("task_id"));
            return noStore(Response.ok(Map.of("ok", true,
                "old_task_uid", oldUid, "new_task_uid", newUid,
                "task_id_changed", tidChanged, "new_task_id", tid)));
        } catch (Exception e) {
            LOG.warnf("[LORE TASK MOVE] %s → %s: %s", oldUid, targetSid, e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    private boolean taskExists(String taskUid) {
        return !ingestService.queryPublic(
            "SELECT task_uid FROM KnowTask WHERE task_uid=:u LIMIT 1", Map.of("u", taskUid)).isEmpty();
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
        requireAdmin(role);
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
                        // A1: atomic sqlscript — a partial failure leaves no KnowPhase
                        // without its PART_OF/HAS_STATE edges.
                        String script =
                            "INSERT INTO KnowPhase SET phase_uid = :uid, phase_id = :pid, name = :name, " +
                            "order_index = :oi, src = 'manual';" +
                            "CREATE EDGE PART_OF FROM (SELECT FROM KnowPhase WHERE phase_uid = :uid) " +
                            "TO (SELECT FROM KnowSprint WHERE sprint_id = :sid);" +
                            "INSERT INTO KnowPhaseHist SET state_uid = :nsid, status_raw = '📋 PLANNED', " +
                            "valid_from = :now;" +
                            "CREATE EDGE HAS_STATE FROM (SELECT FROM KnowPhase WHERE phase_uid = :uid) " +
                            "TO (SELECT FROM KnowPhaseHist WHERE state_uid = :nsid);";
                        Map<String, Object> p = mapOfNullable("uid", uid, "pid", display, "name", name,
                            "oi", order, "sid", sid, "nsid", nsid, "now", now);
                        return writeClient.command(db, basicAuth(),
                                new LoreCommandClient.LoreCommand("sqlscript", script, p))
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
        requireAdmin(role);
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
        requireAdmin(role);
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
                    taskVertexUpdate(req.task_uid(), req.title(), req.note_md(), req.effort_days(),
                        req.author_agent(), req.executor_agent(), req.reviewer_agent(), req.task_type()))
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
            String uid, String title, String noteMd, Double effortDays,
            String authorAgent, String executorAgent, String reviewerAgent, String taskType) {
        StringBuilder sql = new StringBuilder("UPDATE KnowTask SET title = :title");
        Map<String, Object> p = new java.util.HashMap<>();
        p.put("uid", uid);
        p.put("title", title.trim());
        if (noteMd != null)     { sql.append(", note_md = :note");     p.put("note", noteMd); }
        if (effortDays != null) { sql.append(", effort_days = :eff");  p.put("eff", effortDays); }
        // author/executor/reviewer_agent (ADR-LORE-014 §4) and task_type (ADR-LORE-015,
        // T14) — vertex fields, only touched when supplied so a title-only edit never
        // wipes an existing owner/type.
        if (authorAgent   != null) { sql.append(", author_agent = :author");     p.put("author", authorAgent); }
        if (executorAgent != null) { sql.append(", executor_agent = :executor"); p.put("executor", executorAgent); }
        if (reviewerAgent != null) { sql.append(", reviewer_agent = :reviewer"); p.put("reviewer", reviewerAgent); }
        if (taskType      != null) { sql.append(", task_type = :tt");            p.put("tt", taskType); }
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
            String uid, String noteMd, Double effortDays) {
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
        requireAdmin(role);
        if (req == null || req.task_uid() == null
                || req.title() == null || req.title().isBlank()) {
            return Uni.createFrom().item(badParams("task_uid and title required"));
        }
        if (!SAFE_ID.matcher(req.task_uid()).matches()) {
            return Uni.createFrom().item(badParams("task_uid contains illegal characters"));
        }
        final String uid = req.task_uid();
        return writeClient.command(db, basicAuth(),
                taskVertexUpdate(uid, req.title(), req.note_md(), req.effort_days(),
                    req.author_agent(), req.executor_agent(), req.reviewer_agent(), req.task_type()))
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

    // ── Write-path: append PR numbers to open KnowSprintHist.pr_refs ───────────

    @POST
    @Path("sprint/refs")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response updateSprintRefs(SprintRefsRequest req,
                                     @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
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

            // pr_refs is a markdown string; build the new entries and append —
            // unless replace=true, which discards whatever was there before
            // (for fixing a wrong git_project/repo_url baked into earlier
            // entries, since there's no per-entry edit otherwise).
            boolean replace = Boolean.TRUE.equals(req.replace());
            String existing = "";
            if (!replace) {
                Object raw = rows.get(0).get("pr_refs");
                if (raw != null) existing = raw.toString().trim();
            }
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
        requireAdmin(role);
        if (req == null || req.sprint_id() == null || req.sprint_id().isBlank())
            return badParams("sprint_id required");
        if (!SAFE_ID.matcher(req.sprint_id()).matches())
            return badParams("sprint_id contains illegal characters");
        StringBuilder sb = new StringBuilder("UPDATE KnowSprint SET ");
        Map<String, Object> p = new LinkedHashMap<>();
        if (req.name()       != null) { sb.append("name=:name, ");            p.put("name",       req.name()); }
        if (req.outcome_md() != null) { sb.append("outcome_md=:outcome, ");  p.put("outcome",    req.outcome_md()); }
        if (req.context_md() != null) { sb.append("context_md=:ctx, ");      p.put("ctx",        req.context_md()); }
        if (req.plan_id()    != null) { sb.append("plan_id=:plan_id, ");     p.put("plan_id",    req.plan_id()); }
        if (req.effort_days()!= null) { sb.append("effort_days=:effort, ");  p.put("effort",     req.effort_days()); }
        if (req.no_release_required() != null) { sb.append("no_release_required=:nrr, "); p.put("nrr", req.no_release_required()); }
        // trim() is load-bearing: the base StringBuilder is seeded with a
        // trailing space ("...SET "), so when zero fields are appended the
        // regex below (which only strips a trailing comma) leaves that space
        // in place and this equals-check against the untrimmed literal never
        // matched — the empty SET clause then reached ArcadeDB as invalid SQL
        // and came back as a 500 wrapped into our own 502.
        String set = sb.toString().replaceAll(",\\s*$", "").trim();
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

    // NB SPRINT_PLANITEM_RETIRE: removed POST /lore/sprint/track (setSprintTrack)
    // and POST /lore/plan-item/milestone (updatePlanItemMilestone). Both targeted
    // PlanItem, which is being retired — track_id is a plain SCD2-tracked field
    // set via POST /lore/sprint/plan (planned_milestone_id was too, until it was
    // later retired in favor of the TARGETS_MILESTONE edge — see linkSprintMilestone
    // in LoreMilestoneResource). setSprintTrack was additionally dead code: it
    // queried a nonexistent type `KnowPlanItem` (schema only ever had `PlanItem`)
    // and a nonexistent property `represents_sprint` on PlanItem (that was only
    // ever a slice-level SQL alias) — it could never actually create the
    // ON_TRACK edge it claimed to. updatePlanItemMilestone had zero frontend
    // callers (confirmed by repo-wide grep before removal).

    // ── Write-path: link sprint ↔ project ────────────────────────────────────

    public record SprintProjectRequest(String sprint_id, String git_project, String action) {}

    @POST
    @Path("sprint/project")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkSprintProject(SprintProjectRequest req,
                                      @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
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
        requireAdmin(role);
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
        requireAdmin(role);
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

    // ── Write-path: link task ↔ file (EDITED_IN, ADR-LORE-018 T21) ───────────
    // KnowFile is a *reference* (relative path only), created lazily on first
    // link. Keyed by (project, file_path). The URL is composed at read time on
    // the client from the project's hosts[] — nothing here parses code.

    public record TaskFileRequest(String task_uid, String project, String file_path,
                                  String summary_md, String action) {}

    @POST
    @Path("task/file")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkTaskFile(TaskFileRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.task_uid() == null || req.project() == null || req.file_path() == null)
            return badParams("task_uid, project and file_path required");
        if (!SAFE_ID.matcher(req.task_uid()).matches() || !SAFE_ID.matcher(req.project()).matches())
            return badParams("task_uid/project contain illegal characters");
        // file_path allows longer, path-shaped values (deep repo paths), but no
        // quotes/newlines — it flows into String.format'd CREATE EDGE (named
        // params are unreliable there, same as every other edge write here).
        if (!req.file_path().matches("[A-Za-z0-9_./\\-]{1,300}"))
            return badParams("file_path contains illegal characters");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            if (ingestService.queryPublic(
                    "SELECT task_uid FROM KnowTask WHERE task_uid=:t LIMIT 1",
                    Map.of("t", req.task_uid())).isEmpty())
                return badParams("task not found: " + req.task_uid());
            String p = req.project(), f = req.file_path();
            if (remove) {
                List<Map<String, Object>> edges = ingestService.queryPublic(
                    "SELECT @rid FROM EDITED_IN WHERE @out.project=:p AND @out.file_path=:f AND @in.task_uid=:t",
                    Map.of("p", p, "f", f, "t", req.task_uid()));
                for (Map<String, Object> e : edges) {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM EDITED_IN WHERE @rid=" + e.get("@rid").toString(), null)).await().indefinitely();
                }
            } else {
                // Lazy upsert of KnowFile, then idempotent edges — one sqlscript so
                // the CREATE EDGE statements see the just-upserted vertex in-tx.
                String summarySet = req.summary_md() != null
                    ? ", summary_md='" + req.summary_md().replace("'", "''") + "'" : "";
                String script = String.join(";\n",
                    String.format(
                        "UPDATE KnowFile SET project='%s', file_path='%s'%s UPSERT WHERE project='%s' AND file_path='%s'",
                        p, f, summarySet, p, f),
                    String.format(
                        "CREATE EDGE BELONGS_TO_PROJECT FROM (SELECT FROM KnowFile WHERE project='%s' AND file_path='%s') " +
                        "TO (SELECT FROM KnowGitProject WHERE slug='%s') IF NOT EXISTS", p, f, p),
                    String.format(
                        "CREATE EDGE EDITED_IN FROM (SELECT FROM KnowFile WHERE project='%s' AND file_path='%s') " +
                        "TO (SELECT FROM KnowTask WHERE task_uid='%s') IF NOT EXISTS", p, f, req.task_uid()));
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sqlscript",
                    script, null)).await().indefinitely();
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("task_uid", req.task_uid());
            out.put("project", p);
            out.put("file_path", f);
            out.put("action", remove ? "removed" : "added");
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE TASK FILE] %s / %s: %s", req.task_uid(), req.file_path(), e.getMessage());
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
        requireAdmin(role);
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
}
