package studio.seer.heimdall.lore;

import io.smallrye.mutiny.Uni;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;
import studio.seer.heimdall.bench.MartQuery;
import studio.seer.heimdall.bench.MartResult;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * KnowDoc write endpoints (upsert, delete, parent tree, component/sprint links),
 * split out of AidaLoreResource (B2). Shares infra via LoreResourceBase.
 */
@Path("/lore")
public class LoreDocResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreDocResource.class);

    // ── KnowDoc write ────────────────────────────────────────────────────────
    // content_html is legacy (pre-existing HTML-fragment docs, rendered sandboxed);
    // content_md_en/content_md_ru are the current authoring path — clean Markdown
    // per language, rendered in-DOM (inherits app font, supports mermaid fences).
    // parent_doc_id/sort_order: DeepWiki-style page tree. parent_doc_id here is
    // a convenience for the common "create + place in the tree in one call"
    // case — it replaces any existing DOC_CHILD_OF edge (single parent), same
    // as the dedicated doc/parent endpoint below. Pass "" (empty string, not
    // omitted) to detach from a parent via this endpoint; omit entirely to
    // leave the current parent untouched.
    public record DocUpsertRequest(String doc_id, String title, String kind,
        Boolean has_ext_deps, String component_id, String file_path, String content_html,
        String content_md_en, String content_md_ru, String parent_doc_id, Integer sort_order) {}

    @POST
    @Path("doc")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertDoc(DocUpsertRequest req,
                              @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.doc_id() == null || req.doc_id().isBlank())
            return badParams("doc_id required");
        if (!SAFE_ID.matcher(req.doc_id()).matches())
            return badParams("doc_id contains illegal characters");
        try {
            // LH-44: only SET provided fields — a metadata-only re-call must not wipe
            // content_html (up to 100 KB of page content) or the other attributes.
            StringBuilder dcsql = new StringBuilder("UPDATE KnowDoc SET doc_id=:id");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("id", req.doc_id());
            if (req.title() != null)        { dcsql.append(", title=:title");           p.put("title",    req.title()); }
            if (req.kind() != null)         { dcsql.append(", kind=:kind");             p.put("kind",     req.kind()); }
            if (req.has_ext_deps() != null) { dcsql.append(", has_ext_deps=:ext_deps"); p.put("ext_deps", req.has_ext_deps()); }
            if (req.component_id() != null) { dcsql.append(", component_id=:cid");      p.put("cid",      req.component_id()); }
            if (req.file_path() != null)    { dcsql.append(", file_path=:fp");          p.put("fp",       req.file_path()); }
            if (req.content_html() != null) { dcsql.append(", content_html=:content");  p.put("content",  req.content_html()); }
            if (req.content_md_en() != null) { dcsql.append(", content_md_en=:md_en");  p.put("md_en",    req.content_md_en()); }
            if (req.content_md_ru() != null) { dcsql.append(", content_md_ru=:md_ru");  p.put("md_ru",    req.content_md_ru()); }
            if (req.sort_order() != null)    { dcsql.append(", sort_order=:sort_order"); p.put("sort_order", req.sort_order()); }
            dcsql.append(" UPSERT WHERE doc_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                dcsql.toString(), p)).await().indefinitely();
            if (req.parent_doc_id() != null) {
                if (!req.parent_doc_id().isBlank() && !SAFE_ID.matcher(req.parent_doc_id()).matches())
                    return badParams("parent_doc_id contains illegal characters");
                if (req.parent_doc_id().equals(req.doc_id()))
                    return badParams("parent_doc_id cannot equal doc_id");
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM (SELECT expand(outE('DOC_CHILD_OF')) FROM KnowDoc WHERE doc_id=:id)",
                    Map.of("id", req.doc_id()))).await().indefinitely();
                if (!req.parent_doc_id().isBlank()) {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "CREATE EDGE DOC_CHILD_OF " +
                        "FROM (SELECT FROM KnowDoc WHERE doc_id = :id) " +
                        "TO   (SELECT FROM KnowDoc WHERE doc_id = :pid) IF NOT EXISTS",
                        Map.of("id", req.doc_id(), "pid", req.parent_doc_id()))).await().indefinitely();
                }
            }
            return noStore(Response.ok(Map.of("ok", true, "doc_id", req.doc_id())));
        } catch (Exception e) {
            LOG.warnf("[LORE DOC UPSERT] %s: %s", req.doc_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    public record DocDeleteRequest(String doc_id) {}

    @POST
    @Path("doc/delete")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response deleteDoc(DocDeleteRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.doc_id() == null || req.doc_id().isBlank())
            return badParams("doc_id required");
        try {
            // KnowDoc has no SCD2 write path today (flat vertex, see upsertDoc's
            // comment) — no HAS_STATE edge is ever created, so unlike adr/delete
            // there are normally no KnowDocHist rows to clean up. Still check
            // defensively (cheap, and harmless if the schema grows real history
            // later) before dropping edges/vertex — same cascade order as ADR:
            // ArcadeDB has no DELETE VERTEX cascade, so edges must go first.
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> histRids = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "SELECT @rid as rid FROM KnowDocHist WHERE in('HAS_STATE').doc_id[0]=:id",
                    Map.of("id", req.doc_id()))).await().indefinitely().result();
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "DELETE FROM (SELECT expand(bothE()) FROM KnowDoc WHERE doc_id=:id)",
                Map.of("id", req.doc_id()))).await().indefinitely();
            int histDeleted = 0;
            if (histRids != null) {
                for (Map<String, Object> r : histRids) {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM KnowDocHist WHERE @rid=:rid",
                        Map.of("rid", r.get("rid")))).await().indefinitely();
                    histDeleted++;
                }
            }
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "DELETE FROM KnowDoc WHERE doc_id=:id",
                Map.of("id", req.doc_id()))).await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "doc_id", req.doc_id(),
                "hist_deleted", histDeleted)));
        } catch (Exception e) {
            LOG.warnf("[LORE DOC DELETE] %s: %s", req.doc_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── KnowDoc page tree: standalone reparent/detach ────────────────────────
    // DeepWiki-style hierarchy. A doc has at most one parent — 'add' always
    // clears any existing DOC_CHILD_OF edge first, then links the new one (so
    // moving a page to a different parent is one call, not detach-then-attach).
    // Use action="remove" to detach entirely (move the page to the top level).
    public record DocParentLinkRequest(String doc_id, String parent_doc_id, String action) {}

    @POST
    @Path("doc/parent")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkDocParent(DocParentLinkRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.doc_id() == null || req.doc_id().isBlank())
            return badParams("doc_id required");
        if (!SAFE_ID.matcher(req.doc_id()).matches())
            return badParams("doc_id contains illegal characters");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        if (!remove && (req.parent_doc_id() == null || req.parent_doc_id().isBlank()))
            return badParams("parent_doc_id required unless action=remove");
        if (!remove) {
            if (!SAFE_ID.matcher(req.parent_doc_id()).matches())
                return badParams("parent_doc_id contains illegal characters");
            if (req.parent_doc_id().equals(req.doc_id()))
                return badParams("parent_doc_id cannot equal doc_id");
        }
        try {
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "DELETE FROM (SELECT expand(outE('DOC_CHILD_OF')) FROM KnowDoc WHERE doc_id=:id)",
                Map.of("id", req.doc_id()))).await().indefinitely();
            if (remove) {
                return noStore(Response.ok(Map.of("ok", true, "doc_id", req.doc_id(), "action", "removed")));
            }
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> created = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE DOC_CHILD_OF " +
                    "FROM (SELECT FROM KnowDoc WHERE doc_id = :id) " +
                    "TO   (SELECT FROM KnowDoc WHERE doc_id = :pid) IF NOT EXISTS",
                    Map.of("id", req.doc_id(), "pid", req.parent_doc_id())))
                .await().indefinitely().result();
            boolean linked = created != null && !created.isEmpty();
            return noStore(Response.ok(Map.of("ok", true, "doc_id", req.doc_id(),
                "parent_doc_id", req.parent_doc_id(), "action", "added", "linked", linked,
                "hint", linked ? "" : "no edge created — check both doc_id values exist")));
        } catch (Exception e) {
            LOG.warnf("[LORE DOC PARENT] %s: %s", req.doc_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── KnowDoc ↔ component/sprint links — same edges/pattern as ADR's
    // adr/component and adr/link (sprint branch): BELONGS_TO for component,
    // IMPLEMENTED_IN for sprint. component_id also lives as a plain field on
    // KnowDoc (legacy) — the docs/doc_by_id slices already prefer the real
    // BELONGS_TO edge via COALESCE, so linking here is additive, not a
    // breaking migration of existing plain-field data.
    public record DocComponentLinkRequest(String doc_id, String component_id, String action) {}
    public record DocSprintLinkRequest(String doc_id, String sprint_id, String action) {}

    @POST
    @Path("doc/component")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkDocComponent(DocComponentLinkRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.doc_id() == null || req.doc_id().isBlank()
                || req.component_id() == null || req.component_id().isBlank())
            return badParams("doc_id and component_id required");
        if (!SAFE_ID.matcher(req.doc_id()).matches())
            return badParams("doc_id contains illegal characters");
        if (!SAFE_ID.matcher(req.component_id()).matches())
            return badParams("component_id contains illegal characters");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            if (remove) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM (SELECT expand(outE('BELONGS_TO')) FROM KnowDoc WHERE doc_id=:id) " +
                    "WHERE @in.component_id = :cid",
                    Map.of("id", req.doc_id(), "cid", req.component_id()))).await().indefinitely();
                return noStore(Response.ok(Map.of("ok", true, "doc_id", req.doc_id(),
                    "component_id", req.component_id(), "action", "removed")));
            }
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> created = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE BELONGS_TO " +
                    "FROM (SELECT FROM KnowDoc       WHERE doc_id       = :id) " +
                    "TO   (SELECT FROM LoreComponent WHERE component_id = :cid) IF NOT EXISTS",
                    Map.of("id", req.doc_id(), "cid", req.component_id())))
                .await().indefinitely().result();
            boolean linked = created != null && !created.isEmpty();
            return noStore(Response.ok(Map.of("ok", true, "doc_id", req.doc_id(),
                "component_id", req.component_id(), "action", "added", "linked", linked,
                "hint", linked ? "" : "no edge created — check doc_id/component_id exist")));
        } catch (Exception e) {
            LOG.warnf("[LORE DOC COMPONENT] %s: %s", req.doc_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    @POST
    @Path("doc/sprint")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkDocSprint(DocSprintLinkRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.doc_id() == null || req.doc_id().isBlank()
                || req.sprint_id() == null || req.sprint_id().isBlank())
            return badParams("doc_id and sprint_id required");
        if (!SAFE_ID.matcher(req.doc_id()).matches())
            return badParams("doc_id contains illegal characters");
        if (!SAFE_ID.matcher(req.sprint_id()).matches())
            return badParams("sprint_id contains illegal characters");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            if (remove) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM (SELECT expand(outE('IMPLEMENTED_IN')) FROM KnowDoc WHERE doc_id=:id) " +
                    "WHERE @in.sprint_id = :sid",
                    Map.of("id", req.doc_id(), "sid", req.sprint_id()))).await().indefinitely();
                return noStore(Response.ok(Map.of("ok", true, "doc_id", req.doc_id(),
                    "sprint_id", req.sprint_id(), "action", "removed")));
            }
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> created = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE IMPLEMENTED_IN " +
                    "FROM (SELECT FROM KnowDoc    WHERE doc_id    = :id) " +
                    "TO   (SELECT FROM KnowSprint WHERE sprint_id = :sid) IF NOT EXISTS",
                    Map.of("id", req.doc_id(), "sid", req.sprint_id())))
                .await().indefinitely().result();
            boolean linked = created != null && !created.isEmpty();
            return noStore(Response.ok(Map.of("ok", true, "doc_id", req.doc_id(),
                "sprint_id", req.sprint_id(), "action", "added", "linked", linked,
                "hint", linked ? "" : "no edge created — check doc_id/sprint_id exist")));
        } catch (Exception e) {
            LOG.warnf("[LORE DOC SPRINT] %s: %s", req.doc_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }
}
