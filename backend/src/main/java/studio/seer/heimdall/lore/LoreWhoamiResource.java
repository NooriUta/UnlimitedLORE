package studio.seer.heimdall.lore;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.jwt.JsonWebToken;
import org.jboss.logging.Logger;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * SPRINT_LORE_AGENT_OBSERVABILITY/AO-WHOAMI — {@code GET /lore/whoami}: кем LORE видит
 * вызывающего. Для любого аутентифицированного; без токена при включённом auth —
 * 401 ещё в {@code SeerRoleFromTokenFilter}. Логика ответа — {@link Whoami}.
 *
 * <p>Граф читается best-effort: сбой чтения не превращается в «не опознан» —
 * в ответе {@code identity.state = error} с причиной (не смогли проверить ≠ нет).
 */
@Path("/lore/whoami")
public class LoreWhoamiResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreWhoamiResource.class);

    @ConfigProperty(name = "quarkus.oidc.enabled", defaultValue = "false")
    boolean oidcEnabled;

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    @io.smallrye.common.annotation.Blocking
    public Response whoami(@HeaderParam("X-Seer-Role") String role,
                           @HeaderParam(AgentMachine.HEADER) String machineHeader) {
        if (!enabled) return disabled();
        if (!oidcEnabled || identity == null || !(identity.getPrincipal() instanceof JsonWebToken jwt))
            return noStore(Response.ok(Whoami.body(Whoami.Token.authOff(role), Whoami.Graph.EMPTY)));

        Set<String> roles = new LinkedHashSet<>(identity.getRoles());
        long exp = jwt.getExpirationTime();
        Whoami.Token t = new Whoami.Token(true, callerKcSub() != null ? callerKcSub() : jwt.getSubject(),
            callerClientId(), AgentScopeFilter.agentScopeOf(identity), roles, exp > 0 ? exp : null);
        try {
            Map<String, Object> body = Whoami.body(t, graph(t));
            body.put("machine", Whoami.machineOf(t, machineHeader));
            return noStore(Response.ok(body));
        } catch (Exception e) {
            LOG.warnf("[LORE WHOAMI] граф не прочитан: %s", e.getMessage());
            Map<String, Object> b = Whoami.body(t, Whoami.Graph.EMPTY);
            Map<String, Object> id = new LinkedHashMap<>();
            id.put("state", "error");
            id.put("reason", "граф не прочитан: " + LoreUpstream.detail(e));
            b.put("identity", id);
            b.put("machine", Whoami.machineOf(t, machineHeader));
            return noStore(Response.ok(b));
        }
    }

    private Whoami.Graph graph(Whoami.Token t) {
        if (t.agentScope() != null) {
            if (t.clientId() == null) return Whoami.Graph.EMPTY;
            List<Map<String, Object>> rows = ingestService.queryPublic(
                "SELECT actor_id, name, harness, machine_id, out('OWNED_BY').kc_sub AS owner_subs, "
                    + "out('OWNED_BY').display_name AS owner_names FROM KnowActor "
                    + "WHERE kind = 'agent' AND client_id = :c", Map.of("c", t.clientId()));
            if (rows.isEmpty()) return Whoami.Graph.EMPTY;
            Map<String, Object> r = rows.get(0);
            Map<String, Object> self = new LinkedHashMap<>();
            for (String k : List.of("actor_id", "name", "harness", "machine_id")) self.put(k, r.get(k));
            List<Map<String, Object>> owners = new ArrayList<>();
            List<?> subs = r.get("owner_subs") instanceof List<?> l ? l : List.of();
            List<?> names = r.get("owner_names") instanceof List<?> l ? l : List.of();
            for (int i = 0; i < subs.size(); i++) {
                Map<String, Object> o = new LinkedHashMap<>();
                o.put("kc_sub", String.valueOf(subs.get(i)));
                o.put("display_name", i < names.size() && names.get(i) != null ? String.valueOf(names.get(i)) : null);
                owners.add(o);
            }
            // Права агента — права владельца (ADR-LORE-036): проектные роли первого владельца.
            List<Map<String, Object>> roles = owners.isEmpty() ? List.of()
                : projectRoles(String.valueOf(owners.get(0).get("kc_sub")));
            return new Whoami.Graph(self, owners, roles);
        }
        if (t.sub() == null) return Whoami.Graph.EMPTY;
        List<Map<String, Object>> rows = ingestService.queryPublic(
            "SELECT kc_sub, display_name FROM KnowUser WHERE kc_sub = :s", Map.of("s", t.sub()));
        if (rows.isEmpty()) return Whoami.Graph.EMPTY;
        return new Whoami.Graph(new LinkedHashMap<>(rows.get(0)), List.of(), projectRoles(t.sub()));
    }

    private List<Map<String, Object>> projectRoles(String kcSub) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : ingestService.queryPublic(
                "SELECT @in.slug AS project, role FROM HAS_PROJECT_ROLE WHERE @out.kc_sub = :s ORDER BY project",
                Map.of("s", kcSub))) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("project", r.get("project"));
            m.put("role", r.get("role"));
            out.add(m);
        }
        return out;
    }
}
