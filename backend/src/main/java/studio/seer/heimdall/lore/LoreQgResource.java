package studio.seer.heimdall.lore;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * QualityGate / QGJobTask / QGRecommendation write endpoints, split out of
 * AidaLoreResource (B2). Shares infra via LoreResourceBase.
 */
@Path("/lore")
public class LoreQgResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreQgResource.class);

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
        requireAdmin(role);
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
        requireAdmin(role);
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
        requireAdmin(role);
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
        requireAdmin(role);
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

    /** ISO-week id for the rotating QG-housekeeping sprint, e.g. "SPRINT_QG_HOUSEKEEPING_2026W27". */
    private static String weeklyHousekeepingSprintId() {
        java.time.temporal.WeekFields wf = java.time.temporal.WeekFields.ISO;
        java.time.LocalDate today = java.time.LocalDate.now(java.time.ZoneOffset.UTC);
        int isoWeek = today.get(wf.weekOfWeekBasedYear());
        int isoYear = today.get(wf.weekBasedYear());
        return String.format("SPRINT_QG_HOUSEKEEPING_%dW%02d", isoYear, isoWeek);
    }

    @POST
    @Path("qg/promote")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response promoteQGRecommendation(QGPromoteRequest req,
                                            @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
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
                "active", null, null, null,
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
            writeClient.command(db, basicAuth(), linkStateCmd(
                "KnowTask", "KnowTaskHist", "task_uid", taskUid, stateUid)).await().indefinitely();
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
}
