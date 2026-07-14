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
 * KnowGitProject write path (T15, SPRINT_LORE_MCP_EVOLUTION). Before this, KnowGitProject
 * vertices only ever came from a direct ArcadeDB INSERT (no MCP tool, no REST endpoint —
 * see MEMORY lore_git_project_registration) — sprint_link(rel:"project")/release_new/
 * release_mv all assume the target KnowGitProject vertex already exists and silently no-op
 * (ok:true, no edge/vertex written) when it doesn't. This gives project registration a real,
 * idempotent write path. RBAC beyond the standard X-Seer-Role: admin gate (restricting to
 * pm+architect+full agent profiles) lives at the MCP tool-allow-list layer (T11's
 * agent-profiles/*.json), not here — this endpoint itself only enforces the same admin
 * check every other LORE write does.
 */
@Path("/lore")
public class LoreProjectResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreProjectResource.class);

    public record ProjectCreateRequest(String slug, String name) {}

    @POST
    @Path("project")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response createProject(ProjectCreateRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.slug() == null || req.slug().isBlank())
            return badParams("slug required");
        if (!SAFE_ID.matcher(req.slug()).matches())
            return badParams("slug contains illegal characters");
        try {
            // LH-44 partial-safe upsert: only SET fields that were actually supplied,
            // so a slug-only call never wipes an existing name.
            StringBuilder sql = new StringBuilder("UPDATE KnowGitProject SET slug=:slug");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("slug", req.slug());
            if (req.name() != null) { sql.append(", name=:name"); p.put("name", req.name()); }
            sql.append(" UPSERT WHERE slug=:slug");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                sql.toString(), p)).await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "slug", req.slug())));
        } catch (Exception e) {
            LOG.warnf("[LORE PROJECT CREATE] %s: %s", req.slug(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }
}
