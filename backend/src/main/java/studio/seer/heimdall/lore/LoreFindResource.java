package studio.seer.heimdall.lore;

import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.util.Map;
import java.util.Set;

/**
 * SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-05 (SPEC-LORE-GRAPH-SEARCH §6) — {@code POST /lore/find}: структурный
 * запрос «тип + поля + связь». ЧТЕНИЕ: POST — потому что дерево условий (И/ИЛИ/НЕ, списки) не укладывается в
 * строку запроса, как у {@code quality}. Семейство {@code find} открыто всем профилям в матрице
 * {@link AgentScopeFilter} — строкой, а не пропуском «неизвестного семейства».
 *
 * <p>Логика — {@link LoreFind}; здесь — скоуп вызывающего (тот же резолвер, что у слайсов и графа,
 * fail-closed: не посчитан — 502) и время ответа.
 */
@Path("/lore/find")
public class LoreFindResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreFindResource.class);

    @Inject
    AidaLoreResource sliceScope;

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    @io.smallrye.common.annotation.Blocking
    public Response find(Map<String, Object> body, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        long t0 = System.nanoTime();
        Set<String> allowed;
        try {
            allowed = sliceScope.allowedProjectsOrNull(role);
        } catch (RuntimeException e) {
            LOG.warnf("[LORE FIND] скоуп не посчитан: %s", e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(LoreUpstream.error(e, "проектный скоуп не посчитан: " + LoreUpstream.detail(e))));
        }
        Map<String, Object> out;
        try {
            out = LoreFind.run(body, ingestService::queryPublic, allowed, Instant.now());
        } catch (LoreGraphBuilder.GraphException e) {
            return noStore(Response.status(e.status()).entity(new LoreError(e.code(), e.getMessage())));
        } catch (Exception e) {
            LOG.warnf("[LORE FIND] %s: %s", body == null ? null : body.get("type"), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(LoreUpstream.error(e, LoreUpstream.detail(e))));
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> meta = (Map<String, Object>) out.get("meta");
        if (allowed != null) meta.put("caller_scope", Map.of("applied", true, "projects", allowed.size()));
        meta.put("took_ms", (System.nanoTime() - t0) / 1_000_000);
        return noStore(Response.ok(out));
    }
}
