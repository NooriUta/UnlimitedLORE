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
import java.util.Map;

/**
 * KnowDecision write endpoint, split out of AidaLoreResource (B2). Shares
 * infra via LoreResourceBase.
 */
@Path("/lore")
public class LoreDecisionResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreDecisionResource.class);

    // ADR-019: component_id (vertex filter axis), adr_id (parent → DECIDED_IN edge),
    // tags (KnowTag → TAGGED_WITH). Decision stays vertex-only — no KnowDecisionHist.
    public record DecisionCreateRequest(String decision_id, String title, String body_md,
        String date_created, String refs_raw, String component_id, String adr_id,
        java.util.List<String> tags) {}

    // ── Write-path: create / upsert KnowDecision ─────────────────────────────

    @POST
    @Path("decision")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response createDecision(DecisionCreateRequest req,
                                   @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
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
            if (req.component_id() != null) { dsql.append(", component_id=:comp"); p.put("comp", req.component_id()); }
            dsql.append(" UPSERT WHERE decision_id=:did");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                dsql.toString(), p)).await().indefinitely();
            // Default date_created=today only where missing (fresh insert without explicit date).
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE KnowDecision SET date_created=:d WHERE decision_id=:did AND date_created IS NULL",
                Map.of("d", java.time.LocalDate.now().toString(), "did", req.decision_id())))
                .await().indefinitely();
            // ADR-019: parent link (DECIDED_IN) + tags (TAGGED_WITH → KnowTag),
            // both idempotent (IF NOT EXISTS). No-op if the target ADR is absent.
            if (req.adr_id() != null && !req.adr_id().isBlank()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE DECIDED_IN FROM (SELECT FROM KnowDecision WHERE decision_id=:did) " +
                    "TO (SELECT FROM KnowADR WHERE adr_id=:adr) IF NOT EXISTS",
                    Map.of("did", req.decision_id(), "adr", req.adr_id()))).await().indefinitely();
            }
            if (req.tags() != null) {
                for (String tag : req.tags()) {
                    if (tag == null || tag.isBlank()) continue;
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "UPDATE KnowTag SET tag_id=:tag UPSERT WHERE tag_id=:tag", Map.of("tag", tag)))
                        .await().indefinitely();
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "CREATE EDGE TAGGED_WITH FROM (SELECT FROM KnowDecision WHERE decision_id=:did) " +
                        "TO (SELECT FROM KnowTag WHERE tag_id=:tag) IF NOT EXISTS",
                        Map.of("did", req.decision_id(), "tag", tag))).await().indefinitely();
                }
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true); out.put("decision_id", req.decision_id());
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE DECISION CREATE] %s: %s", req.decision_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Links (T43): multi component (BELONGS_TO) + multi project (BELONGS_TO_PROJECT) ──

    public record DComponentRequest(String decision_id, String component_id, String action) {}

    @POST
    @Path("decision/component")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkComponent(DComponentRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.decision_id() == null || req.component_id() == null)
            return badParams("decision_id and component_id required");
        if (!SAFE_ID.matcher(req.decision_id()).matches() || !SAFE_ID.matcher(req.component_id()).matches())
            return badParams("ids contain illegal characters");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            if (remove) {
                deleteEdges("BELONGS_TO", "@out.decision_id=:d AND @in.component_id=:c",
                    Map.of("d", req.decision_id(), "c", req.component_id()));
            } else {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE BELONGS_TO FROM (SELECT FROM KnowDecision WHERE decision_id=:d) " +
                    "TO (SELECT FROM LoreComponent WHERE component_id=:c) IF NOT EXISTS",
                    Map.of("d", req.decision_id(), "c", req.component_id()))).await().indefinitely();
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "UPDATE KnowDecision SET component_id=:c WHERE decision_id=:d AND component_id IS NULL",
                    Map.of("c", req.component_id(), "d", req.decision_id()))).await().indefinitely();
            }
            return noStore(Response.ok(Map.of("ok", true, "decision_id", req.decision_id(),
                "component_id", req.component_id(), "action", remove ? "removed" : "added")));
        } catch (Exception e) {
            LOG.warnf("[LORE DECISION COMPONENT] %s: %s", req.decision_id(), e.getMessage());
            return upstream(e);
        }
    }

    public record DProjectRequest(String decision_id, String project, String action) {}

    @POST
    @Path("decision/project")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkProject(DProjectRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.decision_id() == null || req.project() == null)
            return badParams("decision_id and project required");
        if (!SAFE_ID.matcher(req.decision_id()).matches())
            return badParams("decision_id contains illegal characters");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            if (remove) {
                deleteEdges("BELONGS_TO_PROJECT", "@out.decision_id=:d AND @in.slug=:p",
                    Map.of("d", req.decision_id(), "p", req.project()));
            } else {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE BELONGS_TO_PROJECT FROM (SELECT FROM KnowDecision WHERE decision_id=:d) " +
                    "TO (SELECT FROM KnowGitProject WHERE slug=:p) IF NOT EXISTS",
                    Map.of("d", req.decision_id(), "p", req.project()))).await().indefinitely();
            }
            return noStore(Response.ok(Map.of("ok", true, "decision_id", req.decision_id(),
                "project", req.project(), "action", remove ? "removed" : "added")));
        } catch (Exception e) {
            LOG.warnf("[LORE DECISION PROJECT] %s: %s", req.decision_id(), e.getMessage());
            return upstream(e);
        }
    }

    private void deleteEdges(String edgeType, String where, Map<String, Object> params) {
        java.util.List<Map<String, Object>> edges = ingestService.queryPublic(
            "SELECT @rid FROM " + edgeType + " WHERE " + where, params);
        for (Map<String, Object> e : edges) {
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "DELETE FROM " + edgeType + " WHERE @rid=" + e.get("@rid").toString(), null)).await().indefinitely();
        }
    }

    private Response upstream(Exception e) {
        return noStore(Response.status(Response.Status.BAD_GATEWAY)
            .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
    }
}
