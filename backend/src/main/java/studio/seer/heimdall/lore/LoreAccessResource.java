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

    @jakarta.inject.Inject
    ProjectRbacService rbac;

    /**
     * SPRINT_UXR_S7B_ADMIN/S7B-12 — скоуп агентов.
     * <ul>
     *   <li>{@code ?client_id=&agent_scope=} — агент: владелец, проекты на чтение
     *       (все проекты владельца — {@link ProjectRbacService#visibleProjectsForAgent})
     *       и на запись (где роль владельца делегирует профиль, D4 —
     *       {@link ProjectRbacService#allowedProjectsForAgent}). Без владельца — пусто с причиной.</li>
     *   <li>{@code ?kc_sub=} — человек: его агенты и «агенты видят ваши N проектов».</li>
     * </ul>
     */
    @GET
    @jakarta.ws.rs.Path("agents")
    @Produces(MediaType.APPLICATION_JSON)
    public Response agents(@QueryParam("client_id") String clientId, @QueryParam("agent_scope") String agentScope,
                           @QueryParam("kc_sub") String kcSub) {
        if (!enabled) return disabled();
        try {
            if (clientId != null && !clientId.isBlank()) {
                if (!SAFE_ID.matcher(clientId).matches()) return badParams("client_id contains illegal characters");
                String owner = rbac.ownerKcSub(clientId);
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("client_id", clientId);
                body.put("owner_kc_sub", owner);
                body.put("visible", owner == null ? List.of() : rbac.visibleProjectsForAgent(clientId).stream().sorted().toList());
                body.put("agent_scope", agentScope);
                body.put("writable", owner == null || agentScope == null ? List.of()
                    : rbac.allowedProjectsForAgent(clientId, agentScope).stream().sorted().toList());
                body.put("inherited_from", owner);
                if (owner == null)
                    body.put("reason", "у клиента нет владельца в графе (KnowActor kind=agent + OWNED_BY) — проекты не наследуются");
                return noStore(Response.ok(body));
            }
            if (kcSub != null && !kcSub.isBlank()) {
                if (!SAFE_ID.matcher(kcSub).matches()) return badParams("kc_sub contains illegal characters");
                List<Map<String, Object>> agents = new ArrayList<>();
                for (Map<String, Object> r : ingestService.queryPublic(
                        "SELECT actor_id, name, client_id FROM KnowActor WHERE kind = 'agent' "
                        + "AND out('OWNED_BY').kc_sub CONTAINS :sub ORDER BY actor_id", Map.of("sub", kcSub))) {
                    Map<String, Object> a = new LinkedHashMap<>();
                    a.put("actor_id", r.get("actor_id"));
                    a.put("name", r.get("name"));
                    a.put("client_id", r.get("client_id"));
                    agents.add(a);
                }
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("kc_sub", kcSub);
                body.put("agents", agents);
                body.put("count", agents.size());
                body.put("visible_projects", rbac.allowedProjectsForUser(kcSub).size());
                body.put("note", "агенты читают все проекты владельца; пишут — по матрице D4 роли владельца");
                return noStore(Response.ok(body));
            }
            return badParams("client_id or kc_sub required");
        } catch (Exception e) {
            LOG.warnf("[LORE ACCESS AGENTS] %s/%s: %s", clientId, kcSub, e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }

    /**
     * SPRINT_UXR_S7B_ADMIN/S7B-21 — «почему агент получил 403 на инструменте»:
     * {@code ?agent_scope=&family=&path=} → решение {@link AgentScopeFilter#decide}
     * (то же, что отказывает на проде) словами: что закрыто, почему, каким профилям
     * открыто, что предложить. Логика — {@link AgentToolExplain}.
     */
    @GET
    @jakarta.ws.rs.Path("tool")
    @Produces(MediaType.APPLICATION_JSON)
    public Response tool(@QueryParam("agent_scope") String agentScope, @QueryParam("family") String family,
                         @QueryParam("path") String path) {
        if (!enabled) return disabled();
        if (agentScope != null && !agentScope.isBlank() && !SAFE_ID.matcher(agentScope.strip()).matches())
            return badParams("agent_scope contains illegal characters");
        if (path != null && path.length() > 300) return badParams("path too long");
        Map<String, Object> body = AgentToolExplain.explain(agentScope, family, path);
        if ("bad_input".equals(body.get("verdict"))) return badParams("family or path required");
        return noStore(Response.ok(body));
    }

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
