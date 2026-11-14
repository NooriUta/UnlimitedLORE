package studio.seer.heimdall.lore;

import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.Priority;
import jakarta.inject.Inject;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.Provider;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalInt;

/**
 * SPRINT_LORE_AGENT_OBSERVABILITY/AO-03 — квота записи агентов на входе мутаций /lore/*.
 * Правило и отказ — {@link AgentQuota}; здесь только счёт по журналу AO-01.
 *
 * <p>По умолчанию ВЫКЛЮЧЕНО: оба потолка не заданы — фильтр не делает ни одного запроса.
 * Сбой счёта не отказывает записи (квота вспомогательна): строка в логе и пропуск.
 */
@Provider
@Priority(Priorities.AUTHENTICATION + 310)
public class AgentQuotaFilter implements ContainerRequestFilter {

    private static final Logger LOG = Logger.getLogger(AgentQuotaFilter.class);

    @Inject
    SecurityIdentity identity;

    @Inject
    LoreIngestService ingest;

    @ConfigProperty(name = AgentQuota.PER_AGENT)
    Optional<Integer> perAgent;

    @ConfigProperty(name = AgentQuota.PER_CLIENT)
    Optional<Integer> perClient;

    @ConfigProperty(name = AgentQuota.TOTAL)
    Optional<Integer> total;

    @ConfigProperty(name = AgentQuota.WINDOW, defaultValue = "PT24H")
    Duration window;

    @Override
    public void filter(ContainerRequestContext req) {
        if (perAgent.isEmpty() && perClient.isEmpty() && total.isEmpty()) return;   // выключено — ни одного запроса
        String path = req.getUriInfo().getPath();
        if (path == null || !(path.startsWith("/lore/") || path.startsWith("lore/"))) return;
        String scope = identity == null || identity.isAnonymous() ? null : AgentScopeFilter.agentScopeOf(identity);
        if (!AgentQuota.applies(req.getMethod(), scope)) return;
        try {
            long from = System.currentTimeMillis() - window.toMillis();
            long agentN = perAgent.isPresent() ? count(AgentQuota.AGENT_SQL, Map.of("scope", scope, "from", from)) : 0;
            String client = AgentActionLog.clientMark(true, LoreRequestStatsFilter.clientIdOf(identity));
            long clientN = perClient.isPresent() && AgentQuota.countsPerClient(client)
                ? count(AgentQuota.CLIENT_SQL, Map.of("client", client, "from", from)) : 0;
            long totalN = total.isPresent() ? count(AgentQuota.TOTAL_SQL, Map.of("from", from)) : 0;
            AgentQuota.Denial d = AgentQuota.judge(scope, client, toInt(perAgent), toInt(perClient), toInt(total),
                agentN, clientN, totalN);
            if (d == null) return;
            req.abortWith(Response.status(429).type(MediaType.APPLICATION_JSON)
                .header("Cache-Control", "no-store")
                .entity(new LoreResourceBase.LoreError(d.code(), d.reason())).build());
        } catch (RuntimeException e) {
            LOG.warnf("[LORE QUOTA] расход не посчитан, запись пропущена без квоты: %s", e.getMessage());
        }
    }

    private long count(String sql, Map<String, Object> p) {
        List<Map<String, Object>> r = ingest.queryPublic(sql, p);
        return r.isEmpty() || !(r.get(0).get("n") instanceof Number n) ? 0 : n.longValue();
    }

    private static OptionalInt toInt(Optional<Integer> v) {
        return v.map(OptionalInt::of).orElse(OptionalInt.empty());
    }
}
