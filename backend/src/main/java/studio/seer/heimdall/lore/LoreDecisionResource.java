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

    public record DecisionCreateRequest(String decision_id, String title, String body_md,
        String date_created, String refs_raw) {}

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
}
