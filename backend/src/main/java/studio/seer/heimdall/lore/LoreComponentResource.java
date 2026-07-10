package studio.seer.heimdall.lore;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.util.Map;

/**
 * LoreComponent write endpoints (update, create, link-parent), split out of
 * AidaLoreResource (B2). Shares infra via LoreResourceBase.
 */
@Path("/lore")
public class LoreComponentResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreComponentResource.class);

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
        requireAdmin(role);
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
            // ADR-LORE-012 level B: keep the IN_AREA edge in sync with the string.
            if (req.area() != null) relinkAreaEdge(req.component_id(), req.area());
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
        requireAdmin(role);
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
            // ADR-LORE-012 level B: keep the IN_AREA edge in sync with the string.
            if (req.area() != null) relinkAreaEdge(req.component_id(), req.area());
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
        requireAdmin(role);
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
}
