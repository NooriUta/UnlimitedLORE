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
 * KnowMilestone write endpoints (sprint↔milestone link, upsert), split out of
 * AidaLoreResource (B2). Shares infra via LoreResourceBase.
 */
@Path("/lore")
public class LoreMilestoneResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreMilestoneResource.class);

    @jakarta.inject.Inject
    LoreHashStamper hashStamper; // SV-10: content_hash на открытой Hist-строке после записи тел

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
        requireAdmin(role);
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
        requireAdmin(role);
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
            if (req.goal_md() != null)
                hashStamper.stampOpenHist("KnowMilestoneHist", "KnowMilestone", "milestone_id", req.milestone_id());
            return noStore(Response.ok(Map.of("ok", true, "milestone_id", req.milestone_id())));
        } catch (Exception e) {
            LOG.warnf("[LORE MILESTONE] %s: %s", req.milestone_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }
}
