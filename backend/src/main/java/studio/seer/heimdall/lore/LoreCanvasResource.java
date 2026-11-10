package studio.seer.heimdall.lore;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * SPRINT_UXR_S7C_WHY_CANVAS/S7C-01 — хранение холста «зачем»: холст, стикеры/рамки,
 * стрелки. Логика проверок — {@link LoreCanvas}. Запись идёт под семейством
 * {@code canvas} матрицы {@link AgentScopeFilter}.
 *
 * <pre>
 * GET  /lore/canvas                       список холстов
 * GET  /lore/canvas/{uid}                 холст целиком: canvas, items, links (404 — нет такого)
 * POST /lore/canvas                       создать / переименовать {canvas_uid?, title, template, project?}
 * POST /lore/canvas/{uid}/items           UPSERT элементов {items:[…]} (по item_uid)
 * POST /lore/canvas/{uid}/items/delete    удалить элементы {item_uids:[…]} вместе с их стрелками
 * POST /lore/canvas/{uid}/links           UPSERT стрелок {links:[…]} (концы — элементы этого холста)
 * POST /lore/canvas/{uid}/links/delete    удалить стрелки {link_uids:[…]}
 * </pre>
 *
 * <p><b>S7C-05 — стрелка как ребро графа.</b> Если оба стикера привязаны к сущностям
 * ({@code ref_type}/{@code ref_id}), стрелка пишется типизированным ребром {@code edge}
 * между ними; пары и типы — каталог «Связать» ({@link LoreLinkTypes}, S2-06),
 * {@code REFERENCES} — запасной. Все отказы ДО записи пакета. Ребро несёт
 * {@code origin='canvas'} и {@code canvas_ref='<canvas>/<link>'}; удаление стрелки или
 * её стикера снимает только своё ребро. У стрелки {@code graph}: {@code created} —
 * ребро поставлено ею, {@code existing} — уже было, чужое, {@code drawing} — только рисунок.
 * Не сделано: перепривязка стикера к другой сущности не переносит рёбра его стрелок —
 * клиент переставляет стрелку (повторный UPSERT того же {@code link_uid}).
 */
@Path("/lore/canvas")
public class LoreCanvasResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreCanvasResource.class);

    public record CanvasRequest(String canvas_uid, String title, String template, String project) {}
    public record ItemsRequest(List<Map<String, Object>> items) {}
    public record LinksRequest(List<Map<String, Object>> links) {}
    public record UidsRequest(List<String> item_uids, List<String> link_uids) {}

    private void exec(String sql, Map<String, Object> params) {
        writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql, params))
            .await().indefinitely();
    }

    private static Response upstream(String what, Exception e) {
        LOG.warnf("[LORE CANVAS] %s: %s", what, e.getMessage());
        return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
    }

    private static Response notFound(String uid) {
        return noStore(Response.status(Response.Status.NOT_FOUND)
            .entity(new LoreError("NOT_FOUND", "холст '" + uid + "' не найден")));
    }

    private boolean exists(String uid) {
        return !ingestService.queryPublic("SELECT canvas_uid FROM KnowCanvas WHERE canvas_uid = :u",
            Map.of("u", uid)).isEmpty();
    }

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Response list() {
        if (!enabled) return disabled();
        try {
            List<Map<String, Object>> rows = ingestService.queryPublic(
                "SELECT canvas_uid, title, template, project, updated_at FROM KnowCanvas ORDER BY updated_at DESC",
                Map.of());
            return noStore(Response.ok(Map.of("ok", true, "canvases", rows, "count", rows.size())));
        } catch (Exception e) {
            return upstream("list", e);
        }
    }

    @GET
    @Path("{uid}")
    @Produces(MediaType.APPLICATION_JSON)
    public Response get(@PathParam("uid") String uid) {
        if (!enabled) return disabled();
        if (LoreCanvas.uidError("canvas_uid", uid) != null) return badParams(LoreCanvas.uidError("canvas_uid", uid));
        try {
            List<Map<String, Object>> c = ingestService.queryPublic(
                "SELECT canvas_uid, title, template, project, row_version, created_at, updated_at FROM KnowCanvas "
                + "WHERE canvas_uid = :u", Map.of("u", uid));
            if (c.isEmpty()) return notFound(uid);
            List<Map<String, Object>> items = ingestService.queryPublic(
                "SELECT item_uid, kind, text, x, y, w, h, color, slot, ref_type, ref_id, updated_at FROM KnowCanvasItem "
                + "WHERE canvas_uid = :u ORDER BY item_uid", Map.of("u", uid));
            List<Map<String, Object>> links = ingestService.queryPublic(
                "SELECT link_uid, from_uid, to_uid, edge, ifnull(graph_state, 'drawing') AS graph FROM KnowCanvasLink "
                + "WHERE canvas_uid = :u ORDER BY link_uid",
                Map.of("u", uid));
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("ok", true);
            body.put("canvas", c.get(0));
            body.put("items", items);
            body.put("links", links);
            return noStore(Response.ok(body));
        } catch (Exception e) {
            return upstream("get", e);
        }
    }

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response save(CanvasRequest req) {
        if (!enabled) return disabled();
        if (req == null) return badParams("body required");
        String err = LoreCanvas.canvasError(req.title(), req.template());
        if (err != null) return badParams(err);
        String uid = req.canvas_uid() == null || req.canvas_uid().isBlank()
            ? "cv-" + UUID.randomUUID() : req.canvas_uid();
        if (LoreCanvas.uidError("canvas_uid", uid) != null) return badParams(LoreCanvas.uidError("canvas_uid", uid));
        if (req.project() != null && req.project().length() > 200) return badParams("project longer than 200");
        String now = Instant.now().toString();
        try {
            boolean existed = exists(uid);
            Map<String, Object> p = new HashMap<>();
            p.put("u", uid); p.put("t", req.title()); p.put("tpl", req.template());
            p.put("pr", req.project()); p.put("now", now);
            if (existed) {
                exec("UPDATE KnowCanvas SET title = :t, template = :tpl, project = :pr, updated_at = :now, "
                    + "row_version = ifnull(row_version, 0) + 1 WHERE canvas_uid = :u", p);
            } else {
                exec("INSERT INTO KnowCanvas SET canvas_uid = :u, title = :t, template = :tpl, project = :pr, "
                    + "row_version = 1, created_at = :now, updated_at = :now", p);
            }
            return noStore(Response.ok(Map.of("ok", true, "canvas_uid", uid,
                "outcome", existed ? LoreOutcome.UPDATED : LoreOutcome.CREATED)));
        } catch (Exception e) {
            return upstream("save", e);
        }
    }

    @POST
    @Path("{uid}/items")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response putItems(@PathParam("uid") String uid, ItemsRequest req) {
        if (!enabled) return disabled();
        if (req == null || req.items() == null || req.items().isEmpty()) return badParams("items required");
        if (req.items().size() > LoreCanvas.BATCH_MAX) return badParams("more than " + LoreCanvas.BATCH_MAX + " items per call");
        for (int i = 0; i < req.items().size(); i++) {
            String err = LoreCanvas.itemError(req.items().get(i));
            if (err != null) return badParams("items[" + i + "]: " + err);
        }
        String now = Instant.now().toString();
        try {
            if (!exists(uid)) return notFound(uid);
            long count = ((Number) ingestService.queryPublic(
                "SELECT count(*) AS n FROM KnowCanvasItem WHERE canvas_uid = :u", Map.of("u", uid))
                .get(0).get("n")).longValue();
            if (count + req.items().size() > LoreCanvas.ITEMS_PER_CANVAS_MAX)
                return badParams("canvas would exceed " + LoreCanvas.ITEMS_PER_CANVAS_MAX + " items");
            for (Map<String, Object> it : req.items()) {
                Map<String, Object> p = new HashMap<>();
                p.put("u", uid); p.put("i", it.get("item_uid")); p.put("k", it.get("kind"));
                p.put("txt", it.get("text")); p.put("x", it.get("x")); p.put("y", it.get("y"));
                p.put("w", it.get("w")); p.put("h", it.get("h")); p.put("c", it.get("color"));
                p.put("s", it.get("slot")); p.put("rt", it.get("ref_type")); p.put("ri", it.get("ref_id"));
                p.put("now", now);
                exec("UPDATE KnowCanvasItem SET canvas_uid = :u, item_uid = :i, kind = :k, text = :txt, "
                    + "x = :x, y = :y, w = :w, h = :h, color = :c, slot = :s, ref_type = :rt, ref_id = :ri, "
                    + "updated_at = :now UPSERT WHERE canvas_uid = :u AND item_uid = :i", p);
            }
            exec("UPDATE KnowCanvas SET updated_at = :now WHERE canvas_uid = :u", Map.of("u", uid, "now", now));
            return noStore(Response.ok(Map.of("ok", true, "saved", req.items().size(), "outcome", LoreOutcome.UPDATED)));
        } catch (Exception e) {
            return upstream("items", e);
        }
    }

    @POST
    @Path("{uid}/items/delete")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response deleteItems(@PathParam("uid") String uid, UidsRequest req) {
        if (!enabled) return disabled();
        if (req == null || req.item_uids() == null || req.item_uids().isEmpty()) return badParams("item_uids required");
        for (String i : req.item_uids())
            if (LoreCanvas.uidError("item_uid", i) != null) return badParams(LoreCanvas.uidError("item_uid", i));
        try {
            if (!exists(uid)) return notFound(uid);
            Map<String, Object> p = Map.of("u", uid, "ids", new ArrayList<>(req.item_uids()));
            // Стрелки удалённых элементов не должны висеть — сносятся вместе с ними,
            // а их рёбра графа (S7C-05) — до самих стрелок, пока метка ещё читается.
            dropOwnedEdges(uid, null, req.item_uids());
            exec("DELETE FROM KnowCanvasLink WHERE canvas_uid = :u AND (from_uid IN :ids OR to_uid IN :ids)", p);
            exec("DELETE FROM KnowCanvasItem WHERE canvas_uid = :u AND item_uid IN :ids", p);
            return noStore(Response.ok(Map.of("ok", true, "outcome", LoreOutcome.DELETED)));
        } catch (Exception e) {
            return upstream("items delete", e);
        }
    }

    @POST
    @Path("{uid}/links")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response putLinks(@PathParam("uid") String uid, LinksRequest req) {
        if (!enabled) return disabled();
        if (req == null || req.links() == null || req.links().isEmpty()) return badParams("links required");
        if (req.links().size() > LoreCanvas.BATCH_MAX) return badParams("more than " + LoreCanvas.BATCH_MAX + " links per call");
        for (int i = 0; i < req.links().size(); i++) {
            String err = LoreCanvas.linkError(req.links().get(i));
            if (err != null) return badParams("links[" + i + "]: " + err);
        }
        if (LoreCanvas.uidError("canvas_uid", uid) != null) return badParams(LoreCanvas.uidError("canvas_uid", uid));
        try {
            if (!exists(uid)) return notFound(uid);
            // Фаза 1 — все проверки пакета ДО записи: отказ не оставляет полупакета.
            List<PlannedLink> plans = new ArrayList<>();
            for (int i = 0; i < req.links().size(); i++) {
                Map<String, Object> l = req.links().get(i);
                Map<String, Map<String, Object>> ends = new HashMap<>();
                // Концы — элементы ЭТОГО холста; стрелка в никуда не сохраняется.
                for (String end : List.of("from_uid", "to_uid")) {
                    List<Map<String, Object>> rows = ingestService.queryPublic(
                        "SELECT item_uid, ref_type, ref_id FROM KnowCanvasItem WHERE canvas_uid = :u AND item_uid = :i",
                        Map.of("u", uid, "i", l.get(end)));
                    if (rows.isEmpty()) return badParams(end + " '" + l.get(end) + "' is not an item of this canvas");
                    ends.put(end, rows.get(0));
                }
                Map<String, Object> f = ends.get("from_uid"), t = ends.get("to_uid");
                LoreCanvas.GraphPlan gp = LoreCanvas.graphPlan(f.get("ref_type"), t.get("ref_type"), (String) l.get("edge"));
                if (gp.error() != null)
                    return noStore(Response.status(Response.Status.BAD_REQUEST)
                        .entity(new LoreError("EDGE_NOT_ALLOWED", "links[" + i + "]: " + gp.error())));
                String fromRid = null, toRid = null;
                if (!gp.drawing()) {
                    // S7C-05: обе привязки есть — стрелка станет ребром графа. Права агента —
                    // по семейству исходной сущности, той же матрицей, что у «Связать».
                    String scope = identity == null ? null : AgentScopeFilter.agentScopeOf(identity);
                    if (scope != null) {
                        AgentScopeFilter.Denial d = AgentScopeFilter.decide(scope, "/lore/" + gp.from().family() + "/link");
                        if (d != null)
                            return agentScopeForbidden("agent-" + scope + " не ставит связи от '" + gp.from().type()
                                + "' (семейство " + d.what() + ": " + d.why() + ")");
                    }
                    String fromId = String.valueOf(f.get("ref_id")), toId = String.valueOf(t.get("ref_id"));
                    fromRid = LoreGraphLinks.resolveRid(ingestService, gp.from(), fromId);
                    toRid = LoreGraphLinks.resolveRid(ingestService, gp.to(), toId);
                    if (fromRid == null) return targetNotFound("links[" + i + "]: " + gp.from().type() + " " + fromId);
                    if (toRid == null) return targetNotFound("links[" + i + "]: " + gp.to().type() + " " + toId);
                    if (fromRid.isEmpty() || toRid.isEmpty())
                        return noStore(Response.status(Response.Status.CONFLICT).entity(new LoreError("AMBIGUOUS_TARGET",
                            "links[" + i + "]: id " + (fromRid.isEmpty() ? fromId : toId)
                            + " принадлежит нескольким записям — уточните (например, релиз — в каком проекте)")));
                }
                plans.add(new PlannedLink(l, gp, fromRid, toRid));
            }
            // Фаза 2 — запись.
            String now = Instant.now().toString();
            String by = LoreGraphLinks.sqlSafe(callerLabel());
            List<Map<String, Object>> graph = new ArrayList<>();
            for (PlannedLink pl : plans) {
                String linkUid = (String) pl.link().get("link_uid");
                String edge = (String) pl.link().get("edge");
                // Переставленная стрелка (тот же link_uid) сначала снимает своё прежнее ребро.
                dropOwnedEdges(uid, List.of(linkUid), null);
                String state = LoreCanvas.GRAPH_DRAWING;
                if (!pl.plan().drawing()) {
                    if (LoreGraphLinks.edgeBetween(ingestService, edge, pl.fromRid(), pl.toRid())) {
                        // Ребро уже стоит (поставлено другим путём) — стрелка его показывает, но не владеет им.
                        state = LoreCanvas.GRAPH_EXISTING;
                    } else {
                        // SET — String.format: CREATE EDGE не принимает именованные параметры в SET.
                        exec(String.format("CREATE EDGE %s FROM %s TO %s IF NOT EXISTS SET origin='%s', "
                                + "canvas_ref='%s', created_at='%s', created_by='%s'",
                            edge, pl.fromRid(), pl.toRid(), LoreCanvas.ORIGIN_CANVAS,
                            LoreGraphLinks.sqlSafe(LoreCanvas.canvasRef(uid, linkUid)), now, by), Map.of());
                        if (!LoreGraphLinks.edgeBetween(ingestService, edge, pl.fromRid(), pl.toRid()))
                            throw new IllegalStateException("ребро " + edge + " не встало после CREATE EDGE");
                        state = LoreCanvas.GRAPH_CREATED;
                    }
                }
                Map<String, Object> p = new HashMap<>();
                p.put("u", uid); p.put("l", linkUid); p.put("f", pl.link().get("from_uid"));
                p.put("t", pl.link().get("to_uid")); p.put("e", edge); p.put("g", state);
                exec("UPDATE KnowCanvasLink SET canvas_uid = :u, link_uid = :l, from_uid = :f, to_uid = :t, edge = :e, "
                    + "graph_state = :g UPSERT WHERE canvas_uid = :u AND link_uid = :l", p);
                Map<String, Object> g = new LinkedHashMap<>();
                g.put("link_uid", linkUid);
                g.put("edge_type", edge);
                g.put("state", state);
                graph.add(g);
                LOG.infof("[LORE CANVAS] link %s/%s %s — %s", uid, linkUid, edge, state);
            }
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("ok", true);
            body.put("saved", req.links().size());
            body.put("outcome", LoreOutcome.UPDATED);
            body.put("graph", graph);
            return noStore(Response.ok(body));
        } catch (Exception e) {
            return upstream("links", e);
        }
    }

    private record PlannedLink(Map<String, Object> link, LoreCanvas.GraphPlan plan, String fromRid, String toRid) {}

    /**
     * S7C-05: снять рёбра графа, которые поставили ЭТИ стрелки ({@code graph_state='created'},
     * метка {@code canvas_ref}). Чужие рёбра ({@code existing}) не трогаются.
     * {@code itemUids} задан — стрелки, касающиеся этих элементов.
     */
    private void dropOwnedEdges(String uid, List<String> linkUids, List<String> itemUids) {
        List<Map<String, Object>> owned = itemUids == null
            ? ingestService.queryPublic("SELECT link_uid, edge FROM KnowCanvasLink WHERE canvas_uid = :u "
                + "AND link_uid IN :ids AND graph_state = :g",
                Map.of("u", uid, "ids", new ArrayList<>(linkUids), "g", LoreCanvas.GRAPH_CREATED))
            : ingestService.queryPublic("SELECT link_uid, edge FROM KnowCanvasLink WHERE canvas_uid = :u "
                + "AND (from_uid IN :ids OR to_uid IN :ids) AND graph_state = :g",
                Map.of("u", uid, "ids", new ArrayList<>(itemUids), "g", LoreCanvas.GRAPH_CREATED));
        for (Map<String, Object> o : owned) {
            String edge = String.valueOf(o.get("edge"));
            if (!LoreCanvas.EDGE.matcher(edge).matches()) continue;
            exec("DELETE FROM " + edge + " WHERE canvas_ref = :r",
                Map.of("r", LoreCanvas.canvasRef(uid, String.valueOf(o.get("link_uid")))));
        }
    }

    @POST
    @Path("{uid}/links/delete")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response deleteLinks(@PathParam("uid") String uid, UidsRequest req) {
        if (!enabled) return disabled();
        if (req == null || req.link_uids() == null || req.link_uids().isEmpty()) return badParams("link_uids required");
        for (String l : req.link_uids())
            if (LoreCanvas.uidError("link_uid", l) != null) return badParams(LoreCanvas.uidError("link_uid", l));
        try {
            if (!exists(uid)) return notFound(uid);
            dropOwnedEdges(uid, req.link_uids(), null);
            exec("DELETE FROM KnowCanvasLink WHERE canvas_uid = :u AND link_uid IN :ids",
                Map.of("u", uid, "ids", new ArrayList<>(req.link_uids())));
            return noStore(Response.ok(Map.of("ok", true, "outcome", LoreOutcome.DELETED)));
        } catch (Exception e) {
            return upstream("links delete", e);
        }
    }
}
