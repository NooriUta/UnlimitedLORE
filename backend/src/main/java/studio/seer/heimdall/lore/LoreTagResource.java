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
import java.util.Map;
import java.util.TreeSet;
import java.util.regex.Pattern;

/**
 * SPRINT_LORE_PRODUCT_BACKLOG/SUPERTAGS-SPIKE · Тег со свободными полями на ребре TAGGED_WITH.
 *
 * <ul>
 *   <li>{@code POST /lore/tag/apply} — поставить тег записи (типы — владельцы связи по модели), записать или
 *       поправить поля на ребре (patch: значение перезаписывает, пустое снимает, истории нет), снять тег;</li>
 *   <li>{@code GET /lore/tag/entities?tag=&type=} — срез «сущности по тегу с полями»: строки, колонки из ключей
 *       рёбер, фасеты ({@link LoreEdgeFreeFields#table}); пусто — {@code state: empty}, сбой чтения — 502, а не пусто;</li>
 *   <li>{@code GET /lore/tag/suggest?q=} — подсказка «#тег» в редакторе: теги, сколько записей их несут, какие
 *       поля на их рёбрах встречаются.</li>
 * </ul>
 * Та же дверь у MCP: {@code entity_link rel=tag} с {@code fields} ведёт сюда.
 */
@Path("/lore")
public class LoreTagResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreTagResource.class);

    static final String EDGE = "TAGGED_WITH";
    /** Тег — свободное слово: буквы любого алфавита, цифры, «-», «_», «.»; до 64. */
    static final Pattern TAG = Pattern.compile("[\\p{L}\\p{N}][\\p{L}\\p{N}_.\\-]{0,63}");

    public record TagApplyRequest(String type, String id, String tag_id, Map<String, Object> fields, String action) {}

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> sql(String sql, Map<String, Object> params) {
        Object r = writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql, params))
            .await().indefinitely().result();
        return r instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
    }

    @POST
    @Path("tag/apply")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response apply(TagApplyRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.type() == null || req.id() == null || req.tag_id() == null)
            return badParams("type, id и tag_id обязательны");
        List<String> owners = LoreEdgeFreeFields.owners(EDGE);
        if (!owners.contains(req.type()))
            return badParams("тег с полями ставится типам " + owners + ", а не «" + req.type() + "»");
        if (!SAFE_ID.matcher(req.id()).matches()) return badParams("id: недопустимые символы");
        if (!TAG.matcher(req.tag_id()).matches()) return badParams("tag_id: буквы, цифры, «-», «_», «.», до 64");
        String action = req.action() == null ? "add" : req.action().toLowerCase(java.util.Locale.ROOT);
        if (!action.equals("add") && !action.equals("remove")) return badParams("action: add | remove");
        Map<String, String> patch;
        try {
            patch = LoreEdgeFreeFields.clean(req.fields());
        } catch (IllegalArgumentException e) {
            return badParams(e.getMessage());
        }
        LoreEdgeFreeFields.Spec spec = LoreEdgeFreeFields.spec(EDGE);
        LoreModelTypes.Graph g = LoreModelFile.content().graph().get(req.type());
        String vertex = g.vertex(), key = g.key();
        ChangeAuthor author = changeAuthor();
        String now = Instant.now().toString();
        try {
            if (sql("SELECT @rid AS r FROM " + vertex + " WHERE " + key + " = :id LIMIT 1", Map.of("id", req.id())).isEmpty())
                return noStore(Response.status(Response.Status.NOT_FOUND)
                    .entity(Map.of("error", "NOT_FOUND", "detail", req.type() + " " + req.id() + " не найдена")));
            String find = "SELECT @rid AS r, " + spec.property() + " AS f FROM " + EDGE +
                " WHERE @out.@type = '" + vertex + "' AND @out." + key + " = :id AND @in.@type = '" + spec.vertex() +
                "' AND @in." + spec.key() + " = :tag";
            Map<String, Object> p = Map.of("id", req.id(), "tag", req.tag_id());
            List<Map<String, Object>> have = sql(find, p);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("type", req.type());
            out.put("id", req.id());
            out.put("tag_id", req.tag_id());
            if (action.equals("remove")) {
                for (Map<String, Object> e : have) sql("DELETE FROM " + EDGE + " WHERE @rid = " + rid(e.get("r")), null);
                out.put("action", have.isEmpty() ? "absent" : "removed");
                return noStore(Response.ok(out));
            }
            sql("UPDATE " + spec.vertex() + " SET " + spec.key() + " = :tag UPSERT WHERE " + spec.key() + " = :tag", Map.of("tag", req.tag_id()));
            Map<String, Object> current = have.isEmpty() ? null : asMap(have.get(0).get("f"));
            Map<String, String> merged = LoreEdgeFreeFields.merge(current, patch);
            if (have.isEmpty()) {
                Map<String, Object> c = new LinkedHashMap<>();
                if (!merged.isEmpty()) c.put(spec.property(), merged);
                c.put("tagged_at", now);
                c.put("tagged_by", author.by());
                sql("CREATE EDGE " + EDGE + " FROM (SELECT FROM " + vertex + " WHERE " + key + " = :id) " +
                    "TO (SELECT FROM " + spec.vertex() + " WHERE " + spec.key() + " = :tag) CONTENT :c",
                    Map.of("id", req.id(), "tag", req.tag_id(), "c", c));
                out.put("action", "added");
            } else if (!merged.equals(LoreEdgeFreeFields.merge(current, Map.of()))) {
                // истории нет: прежнее значение перезаписывается; отметка «кто и когда правил» — на ребре
                String edgeRid = rid(have.get(0).get("r"));
                if (merged.isEmpty()) sql("UPDATE " + edgeRid + " REMOVE " + spec.property(), null);
                else sql("UPDATE " + edgeRid + " SET " + spec.property() + " = :f", Map.of("f", merged));
                sql("UPDATE " + edgeRid + " SET changed_at = :at, changed_by = :by", mapOfNullable("at", now, "by", author.by()));
                out.put("action", "updated");
            } else {
                out.put("action", "unchanged");
            }
            out.put("fields", merged);
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE TAG APPLY] %s %s #%s: %s", req.type(), req.id(), req.tag_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }

    @GET
    @Path("tag/entities")
    @Produces(MediaType.APPLICATION_JSON)
    public Response entities(@QueryParam("tag") String tag, @QueryParam("type") String type) {
        if (!enabled) return disabled();
        if (tag == null || !TAG.matcher(tag).matches()) return badParams("tag обязателен: буквы, цифры, «-», «_», «.»");
        try {
            Map<String, String> byVertex = LoreEdgeFreeFields.ownerVertices(EDGE);
            List<Map<String, Object>> rows = new ArrayList<>();
            for (Map<String, Object> r : sql(LoreEdgeFreeFields.entitiesSql(EDGE) + " ORDER BY tagged_at DESC", Map.of("tag", tag))) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("type", byVertex.get(String.valueOf(r.get("vertex"))));
                row.put("id", r.get("id"));
                row.put("title", r.get("title"));
                row.put("fields", asMap(r.get("fields")));
                row.put("tagged_at", r.get("tagged_at"));
                row.put("tagged_by", r.get("tagged_by"));
                row.put("changed_at", r.get("changed_at"));
                row.put("changed_by", r.get("changed_by"));
                if (type == null || type.isBlank() || type.equals(row.get("type"))) rows.add(row);
            }
            return noStore(Response.ok(LoreEdgeFreeFields.table(tag, rows)));
        } catch (Exception e) {
            LOG.warnf("[LORE TAG ENTITIES] #%s: %s", tag, e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }

    @GET
    @Path("tag/suggest")
    @Produces(MediaType.APPLICATION_JSON)
    public Response suggest(@QueryParam("q") String q) {
        if (!enabled) return disabled();
        String needle = q == null ? "" : q.strip().toLowerCase(java.util.Locale.ROOT);
        if (!needle.isEmpty() && !TAG.matcher(needle).matches()) return badParams("q: буквы, цифры, «-», «_», «.»");
        LoreEdgeFreeFields.Spec spec = LoreEdgeFreeFields.spec(EDGE);
        try {
            List<Map<String, Object>> rows = sql("SELECT " + spec.key() + " AS tag_id, in('" + EDGE + "').size() AS uses, " +
                "inE('" + EDGE + "')." + spec.property() + " AS fl FROM " + spec.vertex() +
                (needle.isEmpty() ? "" : " WHERE " + spec.key() + ".toLowerCase() LIKE :q") +
                " ORDER BY uses DESC, tag_id LIMIT 20", needle.isEmpty() ? null : Map.of("q", "%" + needle + "%"));
            List<Map<String, Object>> tags = new ArrayList<>();
            for (Map<String, Object> r : rows) {
                TreeSet<String> keys = new TreeSet<>();
                if (r.get("fl") instanceof List<?> l) for (Object o : l) if (o instanceof Map<?, ?> m) for (Object k : m.keySet()) keys.add(String.valueOf(k));
                Map<String, Object> t = new LinkedHashMap<>();
                t.put("tag_id", r.get("tag_id"));
                t.put("uses", r.get("uses"));
                t.put("keys", List.copyOf(keys));
                tags.add(t);
            }
            return noStore(Response.ok(Map.of("q", needle, "state", tags.isEmpty() ? "empty" : "ok", "tags", tags)));
        } catch (Exception e) {
            LOG.warnf("[LORE TAG SUGGEST] %s: %s", needle, e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }

    private static String rid(Object r) {
        String s = String.valueOf(r);
        if (!s.matches("#\\d+:\\d+")) throw new IllegalStateException("не адрес записи: " + s);
        return s;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object o) {
        if (o instanceof Map<?, ?> m) return new LinkedHashMap<>((Map<String, Object>) m);
        if (o instanceof io.vertx.core.json.JsonObject j) return j.getMap();
        return Map.of();
    }
}
