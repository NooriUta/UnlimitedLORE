package studio.seer.heimdall.lore;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * SPRINT_LORE_AGENT_OBSERVABILITY/AO-02 — {@code POST /lore/sources}: след источников к только что
 * созданной записи ({@link AgentSourceTrail}). Зовётся MCP-сервером ПОСЛЕ успешного создания:
 * сбой или выключенный флаг создание не трогают.
 *
 * <p>Тело: {@code {"target":{"type":"adr","id":"ADR-X"},"sources":[{"type":"spec","id":"SPEC-Y","via":"spec_by_id"}]}},
 * {@code sources} — по времени, старые первыми. Ответ честно говорит, что сделано: флаг
 * выключен ({@code enabled:false}, ничего не записано), сколько рёбер записано и что пропущено
 * с причиной (нет вершины, неизвестный вид).
 */
@Path("/lore/sources")
public class LoreSourceTrailResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreSourceTrailResource.class);

    @ConfigProperty(name = AgentSourceTrail.FLAG, defaultValue = "false")
    boolean trailEnabled;

    @ConfigProperty(name = AgentSourceTrail.MAX, defaultValue = "10")
    int trailMax;

    public record RefBody(String type, String id, String via) {}
    public record TrailBody(RefBody target, List<RefBody> sources) {}

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    @io.smallrye.common.annotation.Blocking
    public Response trail(TrailBody body) {
        if (!enabled) return disabled();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("enabled", trailEnabled);
        if (!trailEnabled) {
            out.put("written", 0);
            out.put("reason", "след источников выключен (" + AgentSourceTrail.FLAG + "=false) — включает владелица");
            return noStore(Response.ok(out));
        }
        if (body == null || body.target() == null || body.target().type() == null || body.target().id() == null
                || !AgentSourceTrail.TRAIL_TYPES.contains(body.target().type())
                || LoreModelTypes.GRAPH.get(body.target().type()) == null)
            return noStore(Response.status(Response.Status.BAD_REQUEST).entity(new LoreError("BAD_PARAMS",
                "target.type — один из " + new java.util.TreeSet<>(AgentSourceTrail.TRAIL_TYPES) + ", target.id обязателен")));

        AgentSourceTrail.Ref target = new AgentSourceTrail.Ref(body.target().type(), body.target().id(), null);
        List<AgentSourceTrail.Ref> reads = new ArrayList<>();
        if (body.sources() != null)
            for (RefBody r : body.sources()) if (r != null) reads.add(new AgentSourceTrail.Ref(r.type(), r.id(), r.via()));
        List<AgentSourceTrail.Ref> plan = AgentSourceTrail.plan(target, reads, AgentSourceTrail.TRAIL_TYPES,
            AgentSourceTrail.ceiling(trailMax));

        LoreModelTypes.Graph from = LoreModelTypes.GRAPH.get(target.type());
        String at = Instant.now().toString();
        int written = 0;
        List<Map<String, Object>> skipped = new ArrayList<>();
        for (AgentSourceTrail.Ref s : plan) {
            LoreModelTypes.Graph to = LoreModelTypes.GRAPH.get(s.type());
            if (to == null) { skipped.add(skip(s, "вида нет в модели")); continue; }
            try {
                Object r = writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    AgentSourceTrail.edgeSql(from, to),
                    Map.of("tid", target.id(), "sid", s.id(), "at", at, "via", s.via() == null ? "" : s.via())))
                    .await().indefinitely().result();
                // Нет вершины цели или источника — ArcadeDB молча не создаёт ребро (пустой ответ,
                // проверено живым тестом): это «пропущено», а не «записано».
                if (r instanceof List<?> l && !l.isEmpty()) written++;
                else skipped.add(skip(s, "нет вершины цели или источника — ребро не создано"));
            } catch (RuntimeException e) {
                // Нет вершины цели или источника — ребро не пишется; остальной след пишется.
                skipped.add(skip(s, "ребро не записано: " + LoreUpstream.detail(e)));
            }
        }
        if (!skipped.isEmpty())
            LOG.infof("[LORE SOURCES] %s %s: записано %d, пропущено %d", target.type(), target.id(), written, skipped.size());
        out.put("target", Map.of("type", target.type(), "id", target.id()));
        out.put("offered", reads.size());
        out.put("written", written);
        out.put("skipped", skipped);
        return noStore(Response.ok(out));
    }

    private static Map<String, Object> skip(AgentSourceTrail.Ref s, String why) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("type", s.type());
        m.put("id", s.id());
        m.put("reason", why);
        return m;
    }
}
