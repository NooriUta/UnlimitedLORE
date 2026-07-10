package studio.seer.heimdall.lore;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.util.List;
import java.util.Map;

/**
 * ADR-LORE-012: KnowDictEntry write endpoints — dictionary entries (dict_type,
 * code) plus the one-time IN_AREA backfill. Split out at creation time (never
 * lived in the old AidaLoreResource monolith) — merged in from origin/develop
 * after the B2 God-class split, so it's placed here directly rather than
 * re-added to the now-305-line residual AidaLoreResource.
 */
@Path("/lore")
public class LoreDictResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreDictResource.class);

    // One vertex per (dict_type, code). Fully partial-safe: every field (metadata
    // AND the is_active/is_extensible flags) is SET only when provided. Create-time
    // defaults are then applied in a second step, gated on `... IS NULL`, so they
    // land only on a freshly-inserted row and never overwrite an explicit value.
    // (The brief NULL-flag window on a fresh insert is masked at read time by the
    // dictionary slice's ifnull(...) — consumers never see NULL.)
    public record DictEntryRequest(String dict_type, String code, String label_ru,
                                   String label_en, String color, String icon,
                                   Integer sort_order, Boolean is_active, Boolean is_extensible) {}

    @POST
    @Path("dict/entry")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertDictEntry(DictEntryRequest req,
                                    @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.dict_type() == null || req.dict_type().isBlank()
                || req.code() == null || req.code().isBlank())
            return badParams("dict_type and code required");
        try {
            StringBuilder sql = new StringBuilder(
                "UPDATE KnowDictEntry SET dict_type=:dt, code=:code");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("dt", req.dict_type());
            p.put("code", req.code());
            // Partial-safe: SET the flags only when explicitly provided — an omitted
            // flag on a metadata-only update must NOT silently reactivate a
            // soft-deleted (is_active=false) entry. Create-time defaults applied below.
            if (req.is_active()     != null) { sql.append(", is_active=:ia");     p.put("ia", req.is_active()); }
            if (req.is_extensible() != null) { sql.append(", is_extensible=:ie"); p.put("ie", req.is_extensible()); }
            if (req.label_ru()   != null) { sql.append(", label_ru=:lr");   p.put("lr", req.label_ru()); }
            if (req.label_en()   != null) { sql.append(", label_en=:le");   p.put("le", req.label_en()); }
            if (req.color()      != null) { sql.append(", color=:col");     p.put("col", req.color()); }
            if (req.icon()       != null) { sql.append(", icon=:icon");     p.put("icon", req.icon()); }
            if (req.sort_order() != null) { sql.append(", sort_order=:so"); p.put("so", req.sort_order()); }
            sql.append(" UPSERT WHERE dict_type=:dt AND code=:code");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                sql.toString(), p)).await().indefinitely();
            // Create-time defaults ONLY where the flag is still unset (fresh insert) —
            // never overwrites an explicit is_active=false / is_extensible on an
            // existing row, so a metadata-only update can't resurrect a soft-delete.
            Map<String, Object> key = Map.of("dt", req.dict_type(), "code", req.code());
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE KnowDictEntry SET is_active=true WHERE dict_type=:dt AND code=:code AND is_active IS NULL",
                key)).await().indefinitely();
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE KnowDictEntry SET is_extensible=false WHERE dict_type=:dt AND code=:code AND is_extensible IS NULL",
                key)).await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true,
                "dict_type", req.dict_type(), "code", req.code())));
        } catch (Exception e) {
            LOG.warnf("[LORE DICT] %s/%s: %s", req.dict_type(), req.code(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // One-time (idempotent) backfill of IN_AREA edges from existing area strings —
    // the schema initializer's DDL is gated off in prod, so this ensures the edge
    // type exists and links every component that has an area. Safe to re-run.
    @POST
    @Path("dict/backfill-area")
    @Produces(MediaType.APPLICATION_JSON)
    public Response backfillAreaEdges(@HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        try {
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "CREATE EDGE TYPE IN_AREA IF NOT EXISTS")).await().indefinitely();
            List<Map<String, Object>> comps = ingestService.queryPublic(
                "SELECT component_id, area FROM LoreComponent WHERE area IS NOT NULL", Map.of());
            int n = 0;
            for (Map<String, Object> c : comps) {
                relinkAreaEdge((String) c.get("component_id"), (String) c.get("area"));
                n++;
            }
            return noStore(Response.ok(Map.of("ok", true, "relinked", n)));
        } catch (Exception e) {
            LOG.warnf("[LORE IN_AREA backfill] %s", e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }
}
