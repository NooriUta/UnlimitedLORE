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
 * idempotent write path.
 *
 * <p>AL-84/ADR-LORE-025-D17: единственный write-путь этого ресурса (create И update —
 * LH-44 partial upsert по slug, отдельного «только создание» пути нет) требует
 * super-admin, не admin. Привязка УЖЕ существующих сущностей к проекту
 * (sprint_link rel=project, release_new) идёт другими путями, этого ограничения
 * не касается.
 *
 * <p><b>Поправка 2026-08-11</b> (решение владельца): гейт был непроходим НИ ДЛЯ
 * КОГО на практике — {@code project} сидел в {@code AgentScopeFilter.HUMAN_ONLY}
 * (ни один из семи агентных профилей, включая {@code full}, не писал сюда), а у
 * человека нет ни UI-кнопки, ни проверенной {@code superadmin}-учётки отдельно от
 * обычного {@code admin}. Открыт РОВНО {@code agent-full}
 * ({@link LoreResourceBase#requireSuperAdminOrAgentFull}) — человеческий порог не
 * тронут, там по-прежнему нужна именно {@code superadmin}, не {@code admin}.
 */
@Path("/lore")
public class LoreProjectResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreProjectResource.class);

    // hosts = JSON array string (ADR-018); default_branch = repo default branch.
    // JSON field names map 1:1 to record components (snake_case kept deliberately).
    public record ProjectCreateRequest(String slug, String name, String hosts, String default_branch) {}

    @POST
    @Path("project")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response createProject(ProjectCreateRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        // AL-84/ADR-LORE-025-D17, поправка 2026-08-11: проект — единица изоляции
        // всей RBAC-модели, требует super-admin (не admin) — либо agent-full.
        requireSuperAdminOrAgentFull(role);
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
            if (req.hosts() != null) { sql.append(", hosts=:hosts"); p.put("hosts", req.hosts()); }
            if (req.default_branch() != null) { sql.append(", default_branch=:db"); p.put("db", req.default_branch()); }
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
