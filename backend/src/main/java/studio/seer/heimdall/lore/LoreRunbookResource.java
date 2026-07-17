package studio.seer.heimdall.lore;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * KnowRunbook write endpoints (ADR link, upsert), split out of
 * AidaLoreResource (B2). Shares infra via LoreResourceBase.
 */
@Path("/lore")
public class LoreRunbookResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreRunbookResource.class);

    @jakarta.inject.Inject
    LoreHashStamper hashStamper; // SV-10: content_hash на открытой Hist-строке после записи тел

    // MG3-01 (SPRINT_LORE_MCP_GAPS_3): runbooks previously only referenced an
    // ADR via a text-only [[ADR-ID]] wiki link inside content_md — no real
    // graph edge existed, so nothing queryable connected the two. Real edge:
    // REFERENCES (KnowRunbook → KnowADR), same add/remove pattern as adr/link.
    public record RunbookAdrLinkRequest(String runbook_id, String adr_id, String action) {}

    @POST
    @Path("runbook/adr")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkRunbookAdr(RunbookAdrLinkRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.runbook_id() == null || req.runbook_id().isBlank())
            return badParams("runbook_id required");
        if (req.adr_id() == null || req.adr_id().isBlank())
            return badParams("adr_id required");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            if (remove) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM (SELECT expand(outE('REFERENCES_ADR')) FROM KnowRunbook WHERE runbook_id=:id) " +
                    "WHERE @in.adr_id = :aid",
                    Map.of("id", req.runbook_id(), "aid", req.adr_id()))).await().indefinitely();
                return noStore(Response.ok(Map.of("ok", true, "runbook_id", req.runbook_id(),
                    "adr_id", req.adr_id(), "action", "removed")));
            }
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> created = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE REFERENCES_ADR " +
                    "FROM (SELECT FROM KnowRunbook WHERE runbook_id = :id) " +
                    "TO   (SELECT FROM KnowADR     WHERE adr_id     = :aid) IF NOT EXISTS",
                    Map.of("id", req.runbook_id(), "aid", req.adr_id())))
                .await().indefinitely().result();
            boolean linked = created != null && !created.isEmpty();
            return noStore(Response.ok(Map.of("ok", true, "runbook_id", req.runbook_id(),
                "adr_id", req.adr_id(), "action", "added", "linked", linked,
                "hint", linked ? "" : "no edge created — check runbook_id/adr_id exist")));
        } catch (Exception e) {
            LOG.warnf("[LORE RUNBOOK ADR LINK] %s: %s", req.runbook_id(), e.getMessage());
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
        requireAdmin(role);
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
                // Step 3b: create the initial open hist row + HAS_STATE edge.
                // A1: one atomic sqlscript so a failed edge leaves no orphan hist row.
                Map<String, Object> hp = mapOfNullable("nsid", nsid, "now", now, "cnt", req.content_md());
                hp.put("id", req.runbook_id());
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sqlscript",
                    "INSERT INTO KnowRunbookHist SET state_uid=:nsid, valid_from=:now, content_md=:cnt;" +
                    "CREATE EDGE HAS_STATE FROM (SELECT FROM KnowRunbook WHERE runbook_id=:id) " +
                    "TO (SELECT FROM KnowRunbookHist WHERE state_uid=:nsid);", hp))
                    .await().indefinitely();
                histCreated = true;
            }

            hashStamper.stampOpenHist("KnowRunbookHist", "KnowRunbook", "runbook_id", req.runbook_id());
            return noStore(Response.ok(Map.of("ok", true, "runbook_id", req.runbook_id(),
                "hist_created", histCreated)));
        } catch (Exception e) {
            LOG.warnf("[LORE RUNBOOK UPSERT] %s: %s", req.runbook_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }
}
