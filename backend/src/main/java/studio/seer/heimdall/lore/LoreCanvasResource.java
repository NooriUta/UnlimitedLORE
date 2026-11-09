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
                "SELECT link_uid, from_uid, to_uid, edge FROM KnowCanvasLink WHERE canvas_uid = :u ORDER BY link_uid",
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
            // Стрелки удалённых элементов не должны висеть — сносятся вместе с ними.
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
        try {
            if (!exists(uid)) return notFound(uid);
            for (Map<String, Object> l : req.links()) {
                // Концы — элементы ЭТОГО холста; стрелка в никуда не сохраняется.
                for (String end : List.of("from_uid", "to_uid"))
                    if (ingestService.queryPublic("SELECT item_uid FROM KnowCanvasItem WHERE canvas_uid = :u AND item_uid = :i",
                            Map.of("u", uid, "i", l.get(end))).isEmpty())
                        return badParams(end + " '" + l.get(end) + "' is not an item of this canvas");
                Map<String, Object> p = new HashMap<>();
                p.put("u", uid); p.put("l", l.get("link_uid")); p.put("f", l.get("from_uid"));
                p.put("t", l.get("to_uid")); p.put("e", l.get("edge"));
                exec("UPDATE KnowCanvasLink SET canvas_uid = :u, link_uid = :l, from_uid = :f, to_uid = :t, edge = :e "
                    + "UPSERT WHERE canvas_uid = :u AND link_uid = :l", p);
            }
            return noStore(Response.ok(Map.of("ok", true, "saved", req.links().size(), "outcome", LoreOutcome.UPDATED)));
        } catch (Exception e) {
            return upstream("links", e);
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
            exec("DELETE FROM KnowCanvasLink WHERE canvas_uid = :u AND link_uid IN :ids",
                Map.of("u", uid, "ids", new ArrayList<>(req.link_uids())));
            return noStore(Response.ok(Map.of("ok", true, "outcome", LoreOutcome.DELETED)));
        } catch (Exception e) {
            return upstream("links delete", e);
        }
    }
}
