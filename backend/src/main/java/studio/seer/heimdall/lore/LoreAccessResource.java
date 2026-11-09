package studio.seer.heimdall.lore;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-10 — эффективный доступ для админки.
 *
 * <pre>
 * GET /lore/admin/access?kc_sub=&project=&realm_role=   почему человек видит / не видит проект
 * GET /lore/admin/access?project=                       кто видит проект: люди с ролью + роли realm в обход
 * </pre>
 * Роль человека в проекте — из графа (HAS_PROJECT_ROLE). Роль realm — из запроса:
 * её знает KC, а не граф; админка берёт её из карточки KC. Логика — {@link LoreAccessExplain}.
 */
@Path("/lore/admin/access")
public class LoreAccessResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreAccessResource.class);

    /** Тот же флаг, что у AidaLoreResource.allowedProjectsOrNull — читается здесь, не полем чужого бина. */
    @ConfigProperty(name = "lore.scope.enforce", defaultValue = "false")
    boolean scopeEnforce;

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Response access(@QueryParam("kc_sub") String kcSub, @QueryParam("project") String project,
                           @QueryParam("realm_role") String realmRole) {
        if (!enabled) return disabled();
        if (project == null || project.isBlank()) return badParams("project required");
        if (!SAFE_ID.matcher(project).matches()) return badParams("project contains illegal characters");
        try {
            if (kcSub == null || kcSub.isBlank()) return whoSees(project);
            if (!SAFE_ID.matcher(kcSub).matches()) return badParams("kc_sub contains illegal characters");
            Map<String, String> roles = new LinkedHashMap<>();
            for (Map<String, Object> r : ingestService.queryPublic(
                    "SELECT @in.slug AS slug, role FROM HAS_PROJECT_ROLE WHERE @out.kc_sub = :sub", Map.of("sub", kcSub)))
                if (r.get("slug") != null) roles.put(String.valueOf(r.get("slug")), r.get("role") == null ? null : String.valueOf(r.get("role")));
            Map<String, Object> body = LoreAccessExplain.explain(scopeEnforce, realmRole, roles, project);
            body.put("kc_sub", kcSub);
            body.put("projects_with_role", roles.size());
            return noStore(Response.ok(body));
        } catch (Exception e) {
            LOG.warnf("[LORE ACCESS] %s: %s", project, e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }

    private Response whoSees(String project) {
        List<Map<String, Object>> people = new ArrayList<>();
        for (Map<String, Object> r : ingestService.queryPublic(
                "SELECT @out.kc_sub AS kc_sub, @out.display_name AS display_name, role FROM HAS_PROJECT_ROLE "
                + "WHERE @in.slug = :p ORDER BY kc_sub", Map.of("p", project))) {
            if (r.get("kc_sub") == null) continue;
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("kc_sub", r.get("kc_sub"));
            p.put("display_name", r.get("display_name"));
            p.put("role", r.get("role"));
            p.put("can_write", r.get("role") != null && !"reader".equals(r.get("role")));
            people.add(p);
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("project", project);
        body.put("scope_enforced", scopeEnforce);
        body.put("people", people);
        body.put("count", people.size());
        body.put("bypass_realm_roles", LoreAccessExplain.BYPASS_REALM_ROLES.stream().sorted().toList());
        body.put("note", scopeEnforce
            ? "видят: люди с ролью в проекте + роли realm из bypass_realm_roles"
            : "проектный скоуп выключен (lore.scope.enforce=false) — проект видят все вошедшие");
        return noStore(Response.ok(body));
    }
}
