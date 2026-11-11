package studio.seer.heimdall.lore;

import io.quarkus.security.identity.SecurityIdentity;
import io.smallrye.mutiny.infrastructure.Infrastructure;
import jakarta.annotation.Priority;
import jakarta.inject.Inject;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.container.ContainerResponseFilter;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.Provider;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * SPRINT_LORE_AGENT_OBSERVABILITY/AO-MACHINE-OBJ — машина на КАЖДОЙ мутации агента
 * в {@code /lore/*}, а не только на смене статуса: один фильтр вместо правки ~30
 * семейств записи (инвентаризация MCP-мутаций сводится к тому, что все они идут
 * сюда).
 *
 * <ul>
 *   <li><b>До записи</b> — жёсткий режим ({@value AgentMachine#FLAG_REQUIRED}=true):
 *       агент без машины получает {@code 400 MACHINE_REQUIRED}. По умолчанию выключен.</li>
 *   <li><b>После успешной записи</b> — вершина {@code KnowMachine} заводится при
 *       отсутствии, ребро {@code USES_MACHINE} от агента ставится, если его нет.
 *       Асинхронно на worker-пуле: привязка вторична и не имеет права ни задержать,
 *       ни уронить саму запись. Сбой — строка в логе.</li>
 *   <li>Без машины — заголовок ответа {@code X-Lore-Machine-Warning: missing|invalid}
 *       на любой мутации; status_set дополнительно пишет предупреждение в тело.</li>
 * </ul>
 */
@Provider
@Priority(Priorities.AUTHENTICATION + 300)
public class AgentMachineFilter implements ContainerRequestFilter, ContainerResponseFilter {

    private static final Logger LOG = Logger.getLogger(AgentMachineFilter.class);

    static final String WARNING_HEADER = "X-Lore-Machine-Warning";

    @Inject
    SecurityIdentity identity;

    @Inject
    MartCredentials mart;

    @Inject
    LoreIngestService ingest;

    /**
     * Лениво: фильтр — провайдер JAX-RS, его экземпляр строится при развёртывании, раньше
     * конфигурации REST-клиентов. Прямое внедрение клиента роняло старт Quarkus
     * (SRCFG00027: нет mapping для RestClientsConfig) — и вместе с ним все live-DB классы.
     * Клиент берётся только в момент записи, в рабочем потоке.
     */
    @Inject
    @RestClient
    jakarta.enterprise.inject.Instance<LoreCommandClient> writeClient;

    @ConfigProperty(name = "lore.enabled", defaultValue = "false")
    boolean loreEnabled;

    @ConfigProperty(name = "lore.db", defaultValue = "system_aida_lore")
    String db;

    @ConfigProperty(name = AgentMachine.FLAG_REQUIRED, defaultValue = "false")
    boolean required;

    /** Пары «клиент|машина», уже привязанные этим процессом, — чтобы не писать на каждый вызов. */
    private final Set<String> linked = ConcurrentHashMap.newKeySet();

    @Override
    public void filter(ContainerRequestContext req) {
        if (!applies(req)) return;
        AgentMachine.Verdict v = AgentMachine.judge(ChangeAuthor.of(identity),
            req.getHeaderString(AgentMachine.HEADER), required);
        if (!v.refuse()) return;
        req.abortWith(Response.status(Response.Status.BAD_REQUEST)
            .type(MediaType.APPLICATION_JSON)
            .entity(new LoreResourceBase.LoreError("MACHINE_REQUIRED", v.warning()))
            .build());
    }

    @Override
    public void filter(ContainerRequestContext req, ContainerResponseContext res) {
        if (!applies(req)) return;
        ChangeAuthor author = ChangeAuthor.of(identity);
        String raw = req.getHeaderString(AgentMachine.HEADER);
        AgentMachine.Verdict v = AgentMachine.judge(author, raw, false);
        if (v.warning() != null) {
            res.getHeaders().putSingle(WARNING_HEADER, raw == null || raw.isBlank() ? "missing" : "invalid");
        }
        if (v.machineId() == null || res.getStatus() >= 300) return;
        String client = author.by();
        String key = client + "|" + v.machineId();
        if (client == null || linked.contains(key)) return;
        Infrastructure.getDefaultWorkerPool().execute(() -> link(client, v.machineId(), key));
    }

    private boolean applies(ContainerRequestContext req) {
        return loreEnabled
            && !AgentScopeFilter.READ_METHODS.contains(req.getMethod())
            && AgentScopeFilter.familyOf(req.getUriInfo().getPath()) != null;
    }

    private void link(String client, String machine, String key) {
        try {
            String now = Instant.now().toString();
            Map<String, Object> p = Map.of("m", machine, "now", now);
            command(AgentMachine.ENSURE_MACHINE_SQL, p);
            command(AgentMachine.FIRST_SEEN_SQL, p);
            command(AgentMachine.LINK_SQL, Map.of("c", client, "m", machine));
            // Кешируем только подтверждённое ребро: пустой CREATE EDGE значит и «уже было»,
            // и «актора с этим client_id нет» — второй случай получит ребро при следующей
            // записи после заведения актора, а не останется навсегда без него.
            java.util.List<Map<String, Object>> rows = ingest.queryPublic(AgentMachine.LINKED_SQL,
                Map.of("c", client, "m", machine));
            Object n = rows.isEmpty() ? null : rows.get(0).get("n");
            if (n instanceof Number num && num.longValue() > 0) linked.add(key);
        } catch (Exception e) {
            LOG.warnf("[LORE MACHINE] %s -> %s не привязан (запись прошла): %s",
                client, machine, LoreUpstream.detail(e));
        }
    }

    private void command(String sql, Map<String, Object> params) {
        writeClient.get().command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql, params))
            .await().indefinitely();
    }

    private String basicAuth() {
        return "Basic " + Base64.getEncoder().encodeToString(
            (mart.user() + ":" + mart.password()).getBytes(StandardCharsets.UTF_8));
    }
}
