package studio.seer.heimdall.lore;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-06 · decision:D-2026-UXR-LINK-MENTION-EDGE —
 * «Связать» из панели «упоминания без связи».
 *
 * <ul>
 *   <li>{@code GET /lore/link/types?from_type&to_type} — варианты для пары:
 *       типизированные рёбра из {@link LoreLinkTypes} (с явными концами,
 *       включая развёрнутые), последним — запасной {@code REFERENCES}. Без
 *       параметров — весь каталог (типы и таблица пар) для UI.</li>
 *   <li>{@code POST /lore/link/mention} — поставить выбранное ребро. Все отказы
 *       ДО записи: неизвестный тип, петля, недопустимая пара/направление,
 *       отсутствующий или неоднозначный конец, права агента по семейству
 *       исходной записи. Повтор — {@code outcome:"unchanged"}, а не второе ребро.</li>
 * </ul>
 *
 * <p><b>Аудит.</b> Две оси, обе без новых типов вершин: (1) строка
 * {@code lore.audit} — её пишет {@link LoreAuditLogFilter} на каждую запись
 * под /lore, (2) провенанс на самом ребре — {@code origin='mention'},
 * {@code created_at}, {@code created_by} (ось и идентичность вызывающего из
 * токена, не из тела запроса). Типизированное ребро несёт те же поля: так
 * отличимо, что связь поставлена из упоминания, а не основным путём записи.
 */
@Path("/lore/link")
public class LoreLinkResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreLinkResource.class);

    static final String ORIGIN_MENTION = "mention";

    private static final Pattern EDGE_NAME = Pattern.compile("[A-Z_]{2,40}");

    @GET
    @Path("types")
    @Produces(MediaType.APPLICATION_JSON)
    public Response types(@QueryParam("from_type") String fromType,
                          @QueryParam("to_type") String toType) {
        if (!enabled) return disabled();
        boolean hasFrom = fromType != null && !fromType.isBlank();
        boolean hasTo = toType != null && !toType.isBlank();
        Map<String, Object> out = new LinkedHashMap<>();
        if (!hasFrom && !hasTo) {
            List<Map<String, Object>> types = new ArrayList<>();
            LoreLinkTypes.ENTITIES.values().forEach(e -> {
                Map<String, Object> t = new LinkedHashMap<>();
                t.put("type", e.type());
                t.put("vertex_class", e.vertexClass());
                t.put("id_field", e.idField());
                types.add(t);
            });
            List<Map<String, Object>> pairs = new ArrayList<>();
            LoreLinkTypes.PAIRS.forEach(p -> {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("from_type", p.fromType());
                m.put("edge_type", p.edgeType());
                m.put("to_type", p.toType());
                pairs.add(m);
            });
            out.put("types", types);
            out.put("pairs", pairs);
            out.put("fallback", Map.of("edge_type", LoreLinkTypes.FALLBACK_EDGE));
            return noStore(Response.ok(out));
        }
        if (!hasFrom || !hasTo) return badParams("from_type и to_type задаются вместе (или оба опускаются — весь каталог)");
        if (LoreLinkTypes.entity(fromType) == null || LoreLinkTypes.entity(toType) == null)
            return badParams("неизвестный тип; допустимы: " + String.join(", ", LoreLinkTypes.ENTITIES.keySet()));

        List<Map<String, Object>> options = new ArrayList<>();
        for (LoreLinkTypes.Option o : LoreLinkTypes.optionsFor(fromType, toType)) options.add(optionJson(o));
        out.put("from_type", fromType);
        out.put("to_type", toType);
        out.put("options", options);
        out.put("fallback", optionJson(options.isEmpty() ? null
            : LoreLinkTypes.optionsFor(fromType, toType).get(options.size() - 1)));
        return noStore(Response.ok(out));
    }

    private static Map<String, Object> optionJson(LoreLinkTypes.Option o) {
        Map<String, Object> m = new LinkedHashMap<>();
        if (o == null) return m;
        m.put("edge_type", o.edgeType());
        m.put("from_type", o.fromType());
        m.put("to_type", o.toType());
        m.put("reversed", o.reversed());
        m.put("fallback", o.fallback());
        return m;
    }

    /**
     * Концы задаются в направлении РЕБРА: {@code from} — откуда оно выходит.
     * Для развёрнутого варианта UI передаёт концы так, как пришли в
     * {@code options[]}. {@code edge_type} не задан — {@code REFERENCES}.
     */
    public record MentionLinkRequest(String from_type, String from_id,
                                     String to_type, String to_id, String edge_type) {}

    @POST
    @Path("mention")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkFromMention(MentionLinkRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null) return badParams("тело запроса обязательно");
        LoreLinkTypes.Entity from = LoreLinkTypes.entity(req.from_type());
        LoreLinkTypes.Entity to = LoreLinkTypes.entity(req.to_type());
        if (from == null || to == null)
            return badParams("from_type/to_type: допустимы " + String.join(", ", LoreLinkTypes.ENTITIES.keySet()));
        if (req.from_id() == null || !SAFE_ID.matcher(req.from_id()).matches())
            return badParams("from_id обязателен и без недопустимых символов");
        if (req.to_id() == null || !SAFE_ID.matcher(req.to_id()).matches())
            return badParams("to_id обязателен и без недопустимых символов");
        if (from.type().equals(to.type()) && req.from_id().equals(req.to_id()))
            return badParams("запись не связывается сама с собой");

        String edge = req.edge_type() == null || req.edge_type().isBlank()
            ? LoreLinkTypes.FALLBACK_EDGE
            : req.edge_type().trim().toUpperCase(Locale.ROOT);
        if (!EDGE_NAME.matcher(edge).matches() || !LoreLinkTypes.isAllowed(from.type(), to.type(), edge)) {
            List<String> allowed = LoreLinkTypes.optionsFor(from.type(), to.type()).stream()
                .filter(o -> !o.reversed()).map(LoreLinkTypes.Option::edgeType).toList();
            return noStore(Response.status(Response.Status.BAD_REQUEST).entity(new LoreError("EDGE_NOT_ALLOWED",
                edge + " не ставится " + from.type() + " → " + to.type() + "; допустимо в этом направлении: "
                + String.join(", ", allowed) + " (варианты обоих направлений — GET /lore/link/types)")));
        }

        // Права агента — по семейству ИСХОДНОЙ записи и той же матрицей, что у фильтра.
        String scope = identity == null ? null : AgentScopeFilter.agentScopeOf(identity);
        if (scope != null) {
            AgentScopeFilter.Denial d = AgentScopeFilter.decide(scope, "/lore/" + from.family() + "/link");
            if (d != null)
                return agentScopeForbidden("agent-" + scope + " не ставит связи от '" + from.type()
                    + "' (семейство " + d.what() + ": " + d.why() + ")");
        }

        try {
            String fromRid = resolveRid(from, req.from_id());
            String toRid = resolveRid(to, req.to_id());
            if (fromRid == null) return targetNotFound(from.type() + " " + req.from_id());
            if (toRid == null) return targetNotFound(to.type() + " " + req.to_id());
            if (fromRid.isEmpty() || toRid.isEmpty())
                return noStore(Response.status(Response.Status.CONFLICT).entity(new LoreError("AMBIGUOUS_TARGET",
                    "id " + (fromRid.isEmpty() ? req.from_id() : req.to_id())
                    + " принадлежит нескольким записям — уточните (например, релиз — в каком проекте)")));

            String createdAt = Instant.now().toString();
            String createdBy = callerLabel();
            Map<String, Object> audit = new LinkedHashMap<>();
            audit.put("origin", ORIGIN_MENTION);
            audit.put("created_at", createdAt);
            audit.put("created_by", createdBy);

            Map<String, Object> base = new LinkedHashMap<>();
            base.put("ok", true);
            base.put("from_type", from.type());
            base.put("from_id", req.from_id());
            base.put("to_type", to.type());
            base.put("to_id", req.to_id());
            base.put("edge_type", edge);
            base.put("fallback", LoreLinkTypes.FALLBACK_EDGE.equals(edge));
            base.put("audit", audit);

            // Проба ДО записи (ADR-LORE-043): CREATE EDGE … IF NOT EXISTS на повторе
            // возвращает существующее ребро, и по результату «создано» не отличить.
            if (edgeBetween(edge, fromRid, toRid)) {
                return noStore(Response.ok(LoreOutcome.link(base, false, true, "")));
            }
            // SET — String.format, не именованные параметры: CREATE EDGE их в SET не принимает.
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                String.format("CREATE EDGE %s FROM %s TO %s IF NOT EXISTS SET origin='%s', created_at='%s', created_by='%s'",
                    edge, fromRid, toRid, ORIGIN_MENTION, createdAt, sqlSafe(createdBy)),
                Map.of())).await().indefinitely();
            boolean exists = edgeBetween(edge, fromRid, toRid);
            LOG.infof("[LORE LINK] mention %s %s:%s → %s:%s by %s — %s", edge, from.type(), req.from_id(),
                to.type(), req.to_id(), createdBy, exists ? "created" : "NOT created");
            return noStore(Response.ok(LoreOutcome.link(base, exists, false,
                from.type() + " " + req.from_id() + " или " + to.type() + " " + req.to_id())));
        } catch (Exception e) {
            LOG.warnf("[LORE LINK] mention %s %s → %s: %s", edge, req.from_id(), req.to_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }

    /** @see LoreGraphLinks#resolveRid */
    private String resolveRid(LoreLinkTypes.Entity e, String id) {
        return LoreGraphLinks.resolveRid(ingestService, e, id);
    }

    private boolean edgeBetween(String edge, String fromRid, String toRid) {
        return LoreGraphLinks.edgeBetween(ingestService, edge, fromRid, toRid);
    }

    private static String sqlSafe(String s) {
        return LoreGraphLinks.sqlSafe(s);
    }
}
