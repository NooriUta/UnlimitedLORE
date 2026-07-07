package studio.seer.heimdall.lore;

import io.smallrye.mutiny.Uni;
import jakarta.inject.Inject;
import jakarta.ws.rs.BeanParam;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import org.jboss.logging.Logger;
import org.jboss.resteasy.reactive.RestForm;
import org.jboss.resteasy.reactive.multipart.FileUpload;
import studio.seer.heimdall.bench.MartQuery;
import studio.seer.heimdall.bench.MartResult;

import java.io.InputStream;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * BRAGI content-archive write endpoints, split out of AidaLoreResource (B2).
 * Shares the ArcadeDB clients + helpers via LoreResourceBase.
 */
@Path("/lore")
public class LoreBragiResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreBragiResource.class);

    @Inject
    BragiS3Service bragiS3;

    @Inject
    LoreIngestService ingestService;

    // ── BRAGI content archive write — MCP-01: publications, variants, assets ──
    // Flat vertices (no SCD2/Hist twin, see LoreSchemaInitializer Phase 7) — LH-44
    // partial-upsert still applies (re-calling with fewer fields must not wipe
    // existing content), edges are idempotent CREATE ... IF NOT EXISTS.
    // source_file_path: where the full draft actually lives on disk (e.g.
    // "C:\Маркетинг\habr-h1-sql-dedup.md") — was only ever embedded as plain
    // text inside main_text_md ("Черновик — полный текст: <path>"), with no
    // real attribute to query/display it separately from the rendered body.
    // annotation_md/todo_md (V2-02): main_text_md is the article body ONLY —
    // editorial metadata used to leak into it (master-source pointers, "final
    // replaces this before publish", teaser-vs-longread notes). annotation_md
    // is permanent context (source of the master, replacement rule, release
    // context); todo_md is a transient markdown checklist ("- [ ] ..."). Both
    // are deliberately excluded from whatever feeds BragiSkinPreview — they're
    // editor-only, never rendered into a platform skin.
    public record BragiPublicationRequest(
        String publication_id, String title, String topic, String main_text_md,
        String type, String status_general, java.util.List<String> keyword_ids, String rubric_id,
        String source_file_path, String annotation_md, String todo_md) {}

    @POST
    @Path("bragi/publication")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertBragiPublication(BragiPublicationRequest req,
                                           @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.publication_id() == null || req.publication_id().isBlank())
            return badParams("publication_id required");
        if (!SAFE_ID.matcher(req.publication_id()).matches())
            return badParams("publication_id contains illegal characters");
        try {
            StringBuilder sql = new StringBuilder("UPDATE BragiPublication SET publication_id=:id");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("id", req.publication_id());
            if (req.title() != null)          { sql.append(", title=:title");         p.put("title", req.title()); }
            if (req.topic() != null)          { sql.append(", topic=:topic");         p.put("topic", req.topic()); }
            if (req.main_text_md() != null)   { sql.append(", main_text_md=:mt");     p.put("mt", req.main_text_md()); }
            if (req.type() != null)           { sql.append(", type=:type");           p.put("type", req.type()); }
            if (req.status_general() != null) { sql.append(", status_general=:sg");   p.put("sg", req.status_general()); }
            if (req.source_file_path() != null) { sql.append(", source_file_path=:sfp"); p.put("sfp", req.source_file_path()); }
            if (req.annotation_md() != null)  { sql.append(", annotation_md=:ann");   p.put("ann", req.annotation_md()); }
            if (req.todo_md() != null)        { sql.append(", todo_md=:todo");        p.put("todo", req.todo_md()); }
            sql.append(" UPSERT WHERE publication_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                sql.toString(), p)).await().indefinitely();
            int keysLinked = 0;
            if (req.keyword_ids() != null) {
                for (String kid : req.keyword_ids()) {
                    if (kid == null || kid.isBlank()) continue;
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "CREATE EDGE TARGETS_KEY FROM (SELECT FROM BragiPublication WHERE publication_id=:pid) " +
                        "TO (SELECT FROM BragiKeyword WHERE keyword_id=:kid) IF NOT EXISTS",
                        Map.of("pid", req.publication_id(), "kid", kid))).await().indefinitely();
                    keysLinked++;
                }
            }
            if (req.rubric_id() != null && !req.rubric_id().isBlank()) {
                assignRubric("BragiPublication", "publication_id", req.publication_id(), req.rubric_id());
            }
            return noStore(Response.ok(Map.of("ok", true, "publication_id", req.publication_id(), "keys_linked", keysLinked)));
        } catch (Exception e) {
            LOG.warnf("[BRAGI PUBLICATION] %s: %s", req.publication_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    public record BragiVariantRequest(
        String variant_id, String publication_id, String channel_id, String text_md,
        String status, String url, String published_at, String asset_id,
        String annotation_md, String todo_md) {}

    @POST
    @Path("bragi/variant")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertBragiVariant(BragiVariantRequest req,
                                       @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.variant_id() == null || req.variant_id().isBlank())
            return badParams("variant_id required");
        if (!SAFE_ID.matcher(req.variant_id()).matches())
            return badParams("variant_id contains illegal characters");
        try {
            StringBuilder sql = new StringBuilder("UPDATE BragiVariant SET variant_id=:id");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("id", req.variant_id());
            if (req.text_md() != null)      { sql.append(", text_md=:tm");    p.put("tm", req.text_md()); }
            if (req.status() != null)       { sql.append(", status=:st");     p.put("st", req.status()); }
            if (req.url() != null)          { sql.append(", url=:url");      p.put("url", req.url()); }
            if (req.published_at() != null) { sql.append(", published_at=:pa"); p.put("pa", req.published_at()); }
            if (req.annotation_md() != null) { sql.append(", annotation_md=:ann"); p.put("ann", req.annotation_md()); }
            if (req.todo_md() != null)      { sql.append(", todo_md=:todo");  p.put("todo", req.todo_md()); }
            sql.append(" UPSERT WHERE variant_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                sql.toString(), p)).await().indefinitely();
            boolean linkedPub = false, linkedChannel = false, linkedAsset = false;
            if (req.publication_id() != null && !req.publication_id().isBlank()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE HAS_VARIANT FROM (SELECT FROM BragiPublication WHERE publication_id=:pid) " +
                    "TO (SELECT FROM BragiVariant WHERE variant_id=:vid) IF NOT EXISTS",
                    Map.of("pid", req.publication_id(), "vid", req.variant_id()))).await().indefinitely();
                linkedPub = true;
            }
            if (req.channel_id() != null && !req.channel_id().isBlank()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE IN_CHANNEL FROM (SELECT FROM BragiVariant WHERE variant_id=:vid) " +
                    "TO (SELECT FROM BragiChannel WHERE channel_id=:cid) IF NOT EXISTS",
                    Map.of("vid", req.variant_id(), "cid", req.channel_id()))).await().indefinitely();
                linkedChannel = true;
            }
            if (req.asset_id() != null && !req.asset_id().isBlank()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE HAS_ASSET FROM (SELECT FROM BragiVariant WHERE variant_id=:vid) " +
                    "TO (SELECT FROM BragiAsset WHERE asset_id=:aid) IF NOT EXISTS",
                    Map.of("vid", req.variant_id(), "aid", req.asset_id()))).await().indefinitely();
                linkedAsset = true;
            }
            return noStore(Response.ok(Map.of("ok", true, "variant_id", req.variant_id(),
                "linked_publication", linkedPub, "linked_channel", linkedChannel, "linked_asset", linkedAsset)));
        } catch (Exception e) {
            LOG.warnf("[BRAGI VARIANT] %s: %s", req.variant_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    public record BragiAssetRequest(
        String asset_id, String asset_type, String file_url, String alt, Long size_bytes,
        String attach_to_publication_id, String attach_to_variant_id) {}

    @POST
    @Path("bragi/asset")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertBragiAsset(BragiAssetRequest req,
                                     @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.asset_id() == null || req.asset_id().isBlank())
            return badParams("asset_id required");
        if (!SAFE_ID.matcher(req.asset_id()).matches())
            return badParams("asset_id contains illegal characters");
        try {
            StringBuilder sql = new StringBuilder("UPDATE BragiAsset SET asset_id=:id");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("id", req.asset_id());
            if (req.asset_type() != null) { sql.append(", asset_type=:at");  p.put("at", req.asset_type()); }
            if (req.file_url() != null)   { sql.append(", file_url=:fu");    p.put("fu", req.file_url()); }
            if (req.alt() != null)        { sql.append(", alt=:alt");        p.put("alt", req.alt()); }
            if (req.size_bytes() != null) { sql.append(", size_bytes=:sz");  p.put("sz", req.size_bytes()); }
            sql.append(" UPSERT WHERE asset_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                sql.toString(), p)).await().indefinitely();
            String attachedTo = null;
            if (req.attach_to_publication_id() != null && !req.attach_to_publication_id().isBlank()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE HAS_ASSET FROM (SELECT FROM BragiPublication WHERE publication_id=:pid) " +
                    "TO (SELECT FROM BragiAsset WHERE asset_id=:aid) IF NOT EXISTS",
                    Map.of("pid", req.attach_to_publication_id(), "aid", req.asset_id()))).await().indefinitely();
                attachedTo = "publication:" + req.attach_to_publication_id();
            } else if (req.attach_to_variant_id() != null && !req.attach_to_variant_id().isBlank()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE HAS_ASSET FROM (SELECT FROM BragiVariant WHERE variant_id=:vid) " +
                    "TO (SELECT FROM BragiAsset WHERE asset_id=:aid) IF NOT EXISTS",
                    Map.of("vid", req.attach_to_variant_id(), "aid", req.asset_id()))).await().indefinitely();
                attachedTo = "variant:" + req.attach_to_variant_id();
            }
            return noStore(Response.ok(Map.of("ok", true, "asset_id", req.asset_id(),
                "attached_to", attachedTo == null ? "" : attachedTo)));
        } catch (Exception e) {
            LOG.warnf("[BRAGI ASSET] %s: %s", req.asset_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── BRAGI asset upload — IMG-01/02: real image storage via S3 (MinIO) ─────
    public static class BragiAssetUploadForm {
        @RestForm("file")
        public FileUpload file;
    }

    private static final Pattern SAFE_UPLOAD_NAME = Pattern.compile("[A-Za-z0-9_.\\-]{1,150}");

    @POST
    @Path("bragi/asset/upload")
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    @Produces(MediaType.APPLICATION_JSON)
    public Response uploadBragiAsset(@BeanParam BragiAssetUploadForm form,
                                      @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (form == null || form.file == null || form.file.fileName() == null)
            return badParams("file required");
        String original = form.file.fileName();
        String ext = original.contains(".") ? original.substring(original.lastIndexOf('.')) : "";
        if (ext.length() > 10) ext = ""; // reject implausible/garbage extensions rather than fail
        String name = UUID.randomUUID() + ext.replaceAll("[^A-Za-z0-9.]", "");
        try (InputStream in = java.nio.file.Files.newInputStream(form.file.uploadedFile())) {
            long size = java.nio.file.Files.size(form.file.uploadedFile());
            bragiS3.put("bragi/" + name, in, size, form.file.contentType());
            return noStore(Response.ok(Map.of(
                "ok", true, "file_url", "/lore/bragi/asset/file/" + name, "size_bytes", size)));
        } catch (Exception e) {
            LOG.warnf("[BRAGI UPLOAD] %s: %s", original, e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("S3_UPSTREAM", e.getMessage())));
        }
    }

    @GET
    @Path("bragi/asset/file/{name}")
    public Response serveBragiAssetFile(@PathParam("name") String name) {
        if (!enabled) return disabled();
        if (!SAFE_UPLOAD_NAME.matcher(name).matches()) return badParams("invalid file name");
        try {
            byte[] data = bragiS3.get("bragi/" + name);
            String contentType = bragiS3.contentType("bragi/" + name);
            return Response.ok(data)
                .type(contentType != null && !contentType.isBlank() ? contentType : "application/octet-stream")
                .header("Cache-Control", "public, max-age=31536000, immutable")
                .build();
        } catch (Exception e) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }
    }

    // ── BRAGI content archive write — MCP-02: keywords, pages, campaigns ──────
    public record BragiKeywordRequest(
        String keyword_id, String phrase, String cluster, Integer freq_exact, Integer freq_broad,
        String source, String intent, String region_engine, String measured_at, String page_id, String rubric_id) {}

    @POST
    @Path("bragi/keyword")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertBragiKeyword(BragiKeywordRequest req,
                                       @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.keyword_id() == null || req.keyword_id().isBlank())
            return badParams("keyword_id required");
        if (!SAFE_ID.matcher(req.keyword_id()).matches())
            return badParams("keyword_id contains illegal characters");
        try {
            StringBuilder sql = new StringBuilder("UPDATE BragiKeyword SET keyword_id=:id");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("id", req.keyword_id());
            if (req.phrase() != null)        { sql.append(", phrase=:ph");         p.put("ph", req.phrase()); }
            if (req.cluster() != null)       { sql.append(", cluster=:cl");        p.put("cl", req.cluster()); }
            if (req.freq_exact() != null)    { sql.append(", freq_exact=:fe");     p.put("fe", req.freq_exact()); }
            if (req.freq_broad() != null)    { sql.append(", freq_broad=:fb");     p.put("fb", req.freq_broad()); }
            if (req.source() != null)        { sql.append(", source=:src");       p.put("src", req.source()); }
            if (req.intent() != null)        { sql.append(", intent=:in");        p.put("in", req.intent()); }
            if (req.region_engine() != null) { sql.append(", region_engine=:re"); p.put("re", req.region_engine()); }
            if (req.measured_at() != null)   { sql.append(", measured_at=:ma");   p.put("ma", req.measured_at()); }
            sql.append(" UPSERT WHERE keyword_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                sql.toString(), p)).await().indefinitely();
            boolean linkedPage = false;
            if (req.page_id() != null && !req.page_id().isBlank()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE TARGETS_PAGE FROM (SELECT FROM BragiKeyword WHERE keyword_id=:kid) " +
                    "TO (SELECT FROM BragiPage WHERE page_id=:pgid) IF NOT EXISTS",
                    Map.of("kid", req.keyword_id(), "pgid", req.page_id()))).await().indefinitely();
                linkedPage = true;
            }
            if (req.rubric_id() != null && !req.rubric_id().isBlank()) {
                assignRubric("BragiKeyword", "keyword_id", req.keyword_id(), req.rubric_id());
            }
            return noStore(Response.ok(Map.of("ok", true, "keyword_id", req.keyword_id(), "linked_page", linkedPage)));
        } catch (Exception e) {
            LOG.warnf("[BRAGI KEYWORD] %s: %s", req.keyword_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Рубрикатор — фиксированный список рубрик, ручное присвоение публикациям
    // и ключевым словам (assignRubric, вызывается из upsertBragiPublication /
    // upsertBragiKeyword). CRUD самих рубрик — отдельный эндпоинт.
    // Gap found 2026-07-03: BragiChannel (bragi_channels slice) had no write path —
    // CH-TG's seed url_handle "t.me/seidr" was stale (real channel is t.me/SampleofOne,
    // per INT-TG-BOT) and there was no tool to fix it. Same flat-vertex upsert shape
    // as BragiRubric above (no SCD2 hist — channels are reference data, not versioned).
    public record BragiChannelRequest(String channel_id, String channel_type, String url_handle,
                                      String funnel_role, String rules_md) {}

    @POST
    @Path("bragi/channel")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertBragiChannel(BragiChannelRequest req,
                                       @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.channel_id() == null || req.channel_id().isBlank())
            return badParams("channel_id required");
        if (!SAFE_ID.matcher(req.channel_id()).matches())
            return badParams("channel_id contains illegal characters");
        try {
            StringBuilder sql = new StringBuilder("UPDATE BragiChannel SET channel_id=:id");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("id", req.channel_id());
            if (req.channel_type() != null) { sql.append(", channel_type=:ct"); p.put("ct", req.channel_type()); }
            if (req.url_handle() != null)   { sql.append(", url_handle=:uh");   p.put("uh", req.url_handle()); }
            if (req.funnel_role() != null)  { sql.append(", funnel_role=:fr");  p.put("fr", req.funnel_role()); }
            if (req.rules_md() != null)     { sql.append(", rules_md=:rm");     p.put("rm", req.rules_md()); }
            sql.append(" UPSERT WHERE channel_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                sql.toString(), p)).await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "channel_id", req.channel_id())));
        } catch (Exception e) {
            LOG.warnf("[BRAGI CHANNEL] %s: %s", req.channel_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    public record BragiRubricRequest(String rubric_id, String name, String description, Integer order_index) {}

    @POST
    @Path("bragi/rubric")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertBragiRubric(BragiRubricRequest req,
                                      @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.rubric_id() == null || req.rubric_id().isBlank())
            return badParams("rubric_id required");
        if (!SAFE_ID.matcher(req.rubric_id()).matches())
            return badParams("rubric_id contains illegal characters");
        try {
            StringBuilder sql = new StringBuilder("UPDATE BragiRubric SET rubric_id=:id");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("id", req.rubric_id());
            if (req.name() != null)        { sql.append(", name=:nm");         p.put("nm", req.name()); }
            if (req.description() != null) { sql.append(", description=:ds"); p.put("ds", req.description()); }
            if (req.order_index() != null) { sql.append(", order_index=:oi"); p.put("oi", req.order_index()); }
            sql.append(" UPSERT WHERE rubric_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                sql.toString(), p)).await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "rubric_id", req.rubric_id())));
        } catch (Exception e) {
            LOG.warnf("[BRAGI RUBRIC] %s: %s", req.rubric_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // Standalone assignment — lets a caller attach/replace a rubric without
    // re-supplying every other field of the target publication/keyword
    // (unlike rubric_id on the full upsert endpoints).
    public record BragiRubricLinkRequest(String entity_type, String entity_id, String rubric_id) {}

    @POST
    @Path("bragi/rubric/link")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkBragiRubric(BragiRubricLinkRequest req,
                                    @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.entity_id() == null || req.entity_id().isBlank())
            return badParams("entity_id required");
        if (req.rubric_id() == null || req.rubric_id().isBlank())
            return badParams("rubric_id required");
        String entityType, idField;
        if ("publication".equals(req.entity_type())) { entityType = "BragiPublication"; idField = "publication_id"; }
        else if ("keyword".equals(req.entity_type())) { entityType = "BragiKeyword"; idField = "keyword_id"; }
        else return badParams("entity_type must be \"publication\" or \"keyword\"");
        try {
            assignRubric(entityType, idField, req.entity_id(), req.rubric_id());
            return noStore(Response.ok(Map.of("ok", true, "entity_id", req.entity_id(), "rubric_id", req.rubric_id())));
        } catch (Exception e) {
            LOG.warnf("[BRAGI RUBRIC LINK] %s: %s", req.entity_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // Search-then-update helper for agent callers — the write endpoints all
    // require an already-known keyword_id; without this there's no way to
    // resolve one from a phrase substring first.
    @GET
    @Path("bragi/keyword/search")
    @Produces(MediaType.APPLICATION_JSON)
    public Response searchBragiKeyword(@QueryParam("q") String q) {
        if (!enabled) return disabled();
        if (q == null || q.isBlank()) return badParams("q required");
        try {
            java.util.List<Map<String, Object>> rows = ingestService.queryPublic(
                "SELECT keyword_id, phrase, cluster FROM BragiKeyword WHERE phrase.toLowerCase() LIKE :q LIMIT 20",
                Map.of("q", "%" + q.toLowerCase() + "%"));
            return noStore(Response.ok(Map.of("rows", rows)));
        } catch (Exception e) {
            LOG.warnf("[BRAGI KEYWORD SEARCH] %s: %s", q, e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    public record BragiPageRequest(
        String page_id, String url, String title, String description, String page_type, String deployed_at) {}

    @POST
    @Path("bragi/page")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertBragiPage(BragiPageRequest req,
                                    @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.page_id() == null || req.page_id().isBlank())
            return badParams("page_id required");
        if (!SAFE_ID.matcher(req.page_id()).matches())
            return badParams("page_id contains illegal characters");
        try {
            StringBuilder sql = new StringBuilder("UPDATE BragiPage SET page_id=:id");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("id", req.page_id());
            if (req.url() != null)         { sql.append(", url=:url");         p.put("url", req.url()); }
            if (req.title() != null)       { sql.append(", title=:title");     p.put("title", req.title()); }
            if (req.description() != null) { sql.append(", description=:d");   p.put("d", req.description()); }
            if (req.page_type() != null)   { sql.append(", page_type=:pt");    p.put("pt", req.page_type()); }
            if (req.deployed_at() != null) { sql.append(", deployed_at=:da");  p.put("da", req.deployed_at()); }
            sql.append(" UPSERT WHERE page_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                sql.toString(), p)).await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "page_id", req.page_id())));
        } catch (Exception e) {
            LOG.warnf("[BRAGI PAGE] %s: %s", req.page_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    public record BragiCampaignRequest(
        String campaign_id, String utm_source, String utm_medium, String utm_campaign,
        String target_url, String period, String variant_id) {}

    @POST
    @Path("bragi/campaign")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertBragiCampaign(BragiCampaignRequest req,
                                        @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.campaign_id() == null || req.campaign_id().isBlank())
            return badParams("campaign_id required");
        if (!SAFE_ID.matcher(req.campaign_id()).matches())
            return badParams("campaign_id contains illegal characters");
        try {
            StringBuilder sql = new StringBuilder("UPDATE BragiCampaign SET campaign_id=:id");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("id", req.campaign_id());
            if (req.utm_source() != null)   { sql.append(", utm_source=:us");   p.put("us", req.utm_source()); }
            if (req.utm_medium() != null)   { sql.append(", utm_medium=:um");   p.put("um", req.utm_medium()); }
            if (req.utm_campaign() != null) { sql.append(", utm_campaign=:uc"); p.put("uc", req.utm_campaign()); }
            if (req.target_url() != null)   { sql.append(", target_url=:tu");   p.put("tu", req.target_url()); }
            if (req.period() != null)       { sql.append(", period=:pe");       p.put("pe", req.period()); }
            sql.append(" UPSERT WHERE campaign_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                sql.toString(), p)).await().indefinitely();
            boolean linkedVariant = false;
            if (req.variant_id() != null && !req.variant_id().isBlank()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE FOR_VARIANT FROM (SELECT FROM BragiCampaign WHERE campaign_id=:cid) " +
                    "TO (SELECT FROM BragiVariant WHERE variant_id=:vid) IF NOT EXISTS",
                    Map.of("cid", req.campaign_id(), "vid", req.variant_id()))).await().indefinitely();
                linkedVariant = true;
            }
            return noStore(Response.ok(Map.of("ok", true, "campaign_id", req.campaign_id(), "linked_variant", linkedVariant)));
        } catch (Exception e) {
            LOG.warnf("[BRAGI CAMPAIGN] %s: %s", req.campaign_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── EDIT-05: BRAGI ↔ Forseti graph edges ────────────────────────────────
    // PRODUCED_BY (publication|variant → task|sprint) and SHIPPED_IN
    // (publication|variant → release) both already exist as edge types in the
    // schema but had no write path — publications lived disconnected from the
    // work graph. Release target resolves release_uid the same way ADR/PR
    // linking does (git_project#release_id when known, bare release_id else).
    public record BragiLinkRequest(String entity_type, String entity_id, String edge_type,
                                   String target_type, String target_id, String git_project, String action) {}

    @POST
    @Path("bragi/link")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkBragiEntity(BragiLinkRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.entity_id() == null || req.entity_id().isBlank())
            return badParams("entity_id required");
        if (req.target_id() == null || req.target_id().isBlank())
            return badParams("target_id required");
        String sourceType = "variant".equals(req.entity_type()) ? "BragiVariant"
            : "publication".equals(req.entity_type()) ? "BragiPublication" : null;
        if (sourceType == null) return badParams("entity_type must be 'publication' or 'variant'");
        String sourceField = "variant".equals(req.entity_type()) ? "variant_id" : "publication_id";

        boolean isProducedBy = "PRODUCED_BY".equals(req.edge_type());
        boolean isShippedIn  = "SHIPPED_IN".equals(req.edge_type());
        if (!isProducedBy && !isShippedIn) return badParams("edge_type must be 'PRODUCED_BY' or 'SHIPPED_IN'");

        String targetType, targetField, targetKey = req.target_id();
        if (isProducedBy) {
            if ("task".equals(req.target_type()))        { targetType = "KnowTask";   targetField = "task_uid"; }
            else if ("sprint".equals(req.target_type()))  { targetType = "KnowSprint"; targetField = "sprint_id"; }
            else return badParams("PRODUCED_BY target_type must be 'task' or 'sprint'");
        } else {
            if (!"release".equals(req.target_type())) return badParams("SHIPPED_IN target_type must be 'release'");
            targetType = "KnowRelease";
            if (req.git_project() != null && !req.git_project().isBlank()) {
                targetField = "release_uid";
                targetKey = req.git_project() + "#" + req.target_id();
            } else {
                targetField = "release_id";
            }
        }

        boolean remove = "remove".equals(req.action());
        try {
            if (remove) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM (SELECT expand(outE('" + req.edge_type() + "')) FROM " + sourceType +
                    " WHERE " + sourceField + "=:sid) WHERE @in." + targetField + "=:tkey",
                    Map.of("sid", req.entity_id(), "tkey", targetKey))).await().indefinitely();
                return noStore(Response.ok(Map.of("ok", true, "entity_id", req.entity_id(),
                    "target_id", req.target_id(), "action", "removed")));
            }
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "CREATE EDGE " + req.edge_type() + " FROM (SELECT FROM " + sourceType +
                " WHERE " + sourceField + "=:sid) TO (SELECT FROM " + targetType +
                " WHERE " + targetField + "=:tkey) IF NOT EXISTS",
                Map.of("sid", req.entity_id(), "tkey", targetKey))).await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "entity_id", req.entity_id(),
                "target_id", req.target_id(), "action", "added")));
        } catch (Exception e) {
            LOG.warnf("[BRAGI LINK] %s -%s-> %s: %s", req.entity_id(), req.edge_type(), req.target_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── BRAGI content archive write/read — MCP-03: MetricSnapshot (TIMESERIES) ─
    public record BragiMetricRequest(
        String object_type, String object_id, String metric, Double value,
        String ts, String source, String segment) {}

    @POST
    @Path("bragi/metric")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response recordBragiMetric(BragiMetricRequest req,
                                      @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.object_type() == null || req.object_type().isBlank())
            return badParams("object_type required");
        if (req.object_id() == null || req.object_id().isBlank())
            return badParams("object_id required");
        if (req.metric() == null || req.metric().isBlank())
            return badParams("metric required");
        if (req.value() == null)
            return badParams("value required");
        try {
            // TIMESERIES ts field is epoch millis (LONG) — accept ISO-8601 or bare millis.
            long tsMillis;
            if (req.ts() == null || req.ts().isBlank()) {
                tsMillis = System.currentTimeMillis();
            } else {
                try {
                    tsMillis = Long.parseLong(req.ts());
                } catch (NumberFormatException nfe) {
                    tsMillis = java.time.Instant.parse(req.ts()).toEpochMilli();
                }
            }
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "INSERT INTO MetricSnapshot SET ts=:ts, object_type=:ot, object_id=:oid, " +
                "metric=:m, value=:v, source=:src, segment=:seg",
                mapOfNullable("ts", tsMillis, "ot", req.object_type(), "oid", req.object_id(),
                    "m", req.metric(), "v", req.value(), "src", req.source(), "seg", req.segment())))
                .await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "object_id", req.object_id(),
                "metric", req.metric(), "ts", tsMillis)));
        } catch (Exception e) {
            LOG.warnf("[BRAGI METRIC] %s/%s: %s", req.object_id(), req.metric(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    @GET
    @Path("bragi/metric/query")
    @Produces(MediaType.APPLICATION_JSON)
    public Response queryBragiMetric(
            @QueryParam("object_type") String objectType,
            @QueryParam("object_id")   String objectId,
            @QueryParam("metric")      String metric,
            @QueryParam("from")        String from,
            @QueryParam("to")          String to,
            @QueryParam("agg")         String agg,
            @QueryParam("limit")       Integer limit) {
        if (!enabled) return disabled();
        try {
            StringBuilder where = new StringBuilder(" WHERE 1=1");
            Map<String, Object> p = new java.util.HashMap<>();
            if (objectType != null && !objectType.isBlank()) { where.append(" AND object_type=:ot"); p.put("ot", objectType); }
            if (objectId != null && !objectId.isBlank())     { where.append(" AND object_id=:oid");  p.put("oid", objectId); }
            if (metric != null && !metric.isBlank())         { where.append(" AND metric=:m");       p.put("m", metric); }
            if (from != null && !from.isBlank())             { where.append(" AND ts >= :from");     p.put("from", Long.parseLong(from)); }
            if (to != null && !to.isBlank())                 { where.append(" AND ts <= :to");       p.put("to", Long.parseLong(to)); }
            // object_type='probe' is a one-off schema-verification artifact (ARC-02/ARC-03) —
            // never a real BRAGI measurement, always excluded.
            where.append(" AND object_type != 'probe'");
            // V2-01 (SPRINT_BRAGI_ARCHIVE_V2): pre-policy seed/test artifacts, filtered at
            // read time — MetricSnapshot is TIMESERIES (sealed storage): DELETE reports
            // success but the row physically stays, so there is no real purge path.
            // qa-e2e/test-mcp03/PUB-QA-E2E are test-only labels, safe to exclude outright.
            // The 27.06 demo package and the 02.07 ai_share/KW-08 batch used real ongoing
            // source labels (yandex-metrika/tg-stats/habr-stats/ai-tracker-3549/yandex-serp)
            // that WILL carry real future data too, so those are pinned to their exact
            // whole-second seed timestamp instead — a real capture always has sub-second
            // precision, so this can never collide with genuine future measurements.
            where.append(" AND object_id != 'PUB-QA-E2E'");
            where.append(" AND source NOT IN ['qa-e2e', 'test-mcp03']");
            where.append(" AND NOT (ts = '2026-06-27 12:00:00' AND object_id IN ['PUB-04', 'PUB-04-VC', 'PUB-04-TG', 'PUB-05', 'PUB-05-HABR'])");
            where.append(" AND NOT (ts = '2026-07-02 09:00:00' AND (object_type = 'competitor' OR object_id = 'KW-08'))");

            String sql;
            if (agg != null && !agg.isBlank()) {
                String fn = switch (agg.toLowerCase()) {
                    case "avg" -> "avg(value)";
                    case "sum" -> "sum(value)";
                    case "min" -> "min(value)";
                    case "max" -> "max(value)";
                    case "count" -> "count(*)";
                    default -> null;
                };
                if (fn == null) return badParams("agg must be one of avg|sum|min|max|count");
                sql = "SELECT object_type, object_id, metric, " + fn + " AS agg_value, count(*) AS n " +
                    "FROM MetricSnapshot" + where + " GROUP BY object_type, object_id, metric";
            } else {
                sql = "SELECT object_type, object_id, metric, value, ts, source, segment " +
                    "FROM MetricSnapshot" + where + " ORDER BY ts DESC LIMIT " + (limit != null ? Math.min(limit, 1000) : 200);
            }
            List<Map<String, Object>> rows = ingestService.queryPublic(sql, p);
            return noStore(Response.ok(Map.of("ok", true, "rows", rows)));
        } catch (Exception e) {
            LOG.warnf("[BRAGI METRIC QUERY] %s", e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── BRAGI content archive write — MCP-04: integrations + insights ─────────
    private static final Pattern SECRET_REF = Pattern.compile("^(env|vault|oauth|secret):.+");

    public record BragiIntegrationRequest(
        String integration_id, String service, String purpose, String endpoint,
        String scope, String secret_ref, String status, String last_called_at) {}

    @POST
    @Path("bragi/integration")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertBragiIntegration(BragiIntegrationRequest req,
                                           @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.integration_id() == null || req.integration_id().isBlank())
            return badParams("integration_id required");
        if (!SAFE_ID.matcher(req.integration_id()).matches())
            return badParams("integration_id contains illegal characters");
        // Spec-mandated guard: secret_ref must be a reference (env:/vault:/oauth:/secret:
        // prefix), never a raw token value — this is the one field in the whole BRAGI
        // module the spec explicitly forbids storing as plain content.
        if (req.secret_ref() != null && !req.secret_ref().isBlank() && !SECRET_REF.matcher(req.secret_ref()).matches())
            return badParams("secret_ref must be a reference, e.g. \"env:METRIKA_TOKEN\" or \"vault:seidr-telegraph\" — not a raw secret value");
        try {
            StringBuilder sql = new StringBuilder("UPDATE BragiIntegration SET integration_id=:id");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("id", req.integration_id());
            if (req.service() != null)       { sql.append(", service=:sv");        p.put("sv", req.service()); }
            if (req.purpose() != null)       { sql.append(", purpose=:pu");        p.put("pu", req.purpose()); }
            if (req.endpoint() != null)      { sql.append(", endpoint=:ep");       p.put("ep", req.endpoint()); }
            if (req.scope() != null)         { sql.append(", scope=:sc");         p.put("sc", req.scope()); }
            if (req.secret_ref() != null)    { sql.append(", secret_ref=:sr");    p.put("sr", req.secret_ref()); }
            if (req.status() != null)        { sql.append(", status=:st");        p.put("st", req.status()); }
            if (req.last_called_at() != null){ sql.append(", last_called_at=:lc"); p.put("lc", req.last_called_at()); }
            sql.append(" UPSERT WHERE integration_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                sql.toString(), p)).await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "integration_id", req.integration_id())));
        } catch (Exception e) {
            LOG.warnf("[BRAGI INTEGRATION] %s: %s", req.integration_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    public record BragiInsightRequest(
        String insight_id, String statement_md, String insight_date, String evidence_ref) {}

    @POST
    @Path("bragi/insight")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertBragiInsight(BragiInsightRequest req,
                                       @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.insight_id() == null || req.insight_id().isBlank())
            return badParams("insight_id required");
        if (!SAFE_ID.matcher(req.insight_id()).matches())
            return badParams("insight_id contains illegal characters");
        try {
            StringBuilder sql = new StringBuilder("UPDATE BragiInsight SET insight_id=:id");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("id", req.insight_id());
            if (req.statement_md() != null) { sql.append(", statement_md=:sm"); p.put("sm", req.statement_md()); }
            if (req.insight_date() != null) { sql.append(", insight_date=:idt"); p.put("idt", req.insight_date()); }
            if (req.evidence_ref() != null) { sql.append(", evidence_ref=:er"); p.put("er", req.evidence_ref()); }
            sql.append(" UPSERT WHERE insight_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                sql.toString(), p)).await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "insight_id", req.insight_id())));
        } catch (Exception e) {
            LOG.warnf("[BRAGI INSIGHT] %s: %s", req.insight_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    public record BragiInsightLinkRequest(String insight_id, String target_type, String target_id) {}

    @POST
    @Path("bragi/insight/link")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkBragiInsight(BragiInsightLinkRequest req,
                                     @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.insight_id() == null || req.insight_id().isBlank())
            return badParams("insight_id required");
        if (req.target_type() == null || (!req.target_type().equals("task") && !req.target_type().equals("adr")))
            return badParams("target_type must be \"task\" or \"adr\"");
        if (req.target_id() == null || req.target_id().isBlank())
            return badParams("target_id required");
        try {
            String targetType = req.target_type().equals("task") ? "KnowTask" : "KnowADR";
            String targetField = req.target_type().equals("task") ? "task_uid" : "adr_id";
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "CREATE EDGE LED_TO FROM (SELECT FROM BragiInsight WHERE insight_id=:iid) " +
                "TO (SELECT FROM " + targetType + " WHERE " + targetField + "=:tid) IF NOT EXISTS",
                Map.of("iid", req.insight_id(), "tid", req.target_id()))).await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "insight_id", req.insight_id(),
                "target_type", req.target_type(), "target_id", req.target_id())));
        } catch (Exception e) {
            LOG.warnf("[BRAGI INSIGHT LINK] %s -> %s: %s", req.insight_id(), req.target_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── BRAGI content archive — INT-01/02: manual integration sync (scaffold) ──
    // No real cron/scheduled polling here — that needs live credentials for
    // Яндекс.Метрика/Keys.so/GSC/Telegram, which don't exist anywhere in this
    // repo (SPRINT_BRAGI_ARCHIVE_IMPL/INT-01,INT-02 — deferred pending real
    // secrets, per explicit user decision 2026-07-02). This endpoint is the
    // reusable ingestion interface a real scheduled connector would call: given
    // an integration_id and a batch of already-fetched metrics, write them to
    // MetricSnapshot and bump last_called_at. The source→metric mapping and the
    // actual HTTP calls to the third-party API are the caller's job.
    public record BragiSyncMetric(String object_type, String object_id, String metric, Double value, String ts, String segment) {}
    public record BragiIntegrationSyncRequest(String integration_id, java.util.List<BragiSyncMetric> metrics) {}

    @POST
    @Path("bragi/integration/sync")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response syncBragiIntegration(BragiIntegrationSyncRequest req,
                                         @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.integration_id() == null || req.integration_id().isBlank())
            return badParams("integration_id required");
        try {
            List<Map<String, Object>> found = ingestService.queryPublic(
                "SELECT integration_id, service, status FROM BragiIntegration WHERE integration_id=:id",
                Map.of("id", req.integration_id()));
            if (found.isEmpty())
                return noStore(Response.status(Response.Status.NOT_FOUND)
                    .entity(new LoreError("NOT_FOUND", "no BragiIntegration with integration_id=" + req.integration_id())));
            int written = 0;
            if (req.metrics() != null) {
                for (BragiSyncMetric m : req.metrics()) {
                    if (m.object_type() == null || m.object_id() == null || m.metric() == null || m.value() == null) continue;
                    long tsMillis;
                    if (m.ts() == null || m.ts().isBlank()) tsMillis = System.currentTimeMillis();
                    else {
                        try { tsMillis = Long.parseLong(m.ts()); }
                        catch (NumberFormatException nfe) { tsMillis = java.time.Instant.parse(m.ts()).toEpochMilli(); }
                    }
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "INSERT INTO MetricSnapshot SET ts=:ts, object_type=:ot, object_id=:oid, " +
                        "metric=:m, value=:v, source=:src, segment=:seg",
                        mapOfNullable("ts", tsMillis, "ot", m.object_type(), "oid", m.object_id(),
                            "m", m.metric(), "v", m.value(), "src", (String) found.get(0).get("service"), "seg", m.segment())))
                        .await().indefinitely();
                    written++;
                }
            }
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE BragiIntegration SET last_called_at=:lc UPSERT WHERE integration_id=:id",
                Map.of("lc", java.time.Instant.now().toString(), "id", req.integration_id())))
                .await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "integration_id", req.integration_id(), "metrics_written", written)));
        } catch (Exception e) {
            LOG.warnf("[BRAGI INTEGRATION SYNC] %s: %s", req.integration_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    private void assignRubric(String entityType, String entityIdField, String entityId, String rubricId) {
        writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
            "DELETE FROM IN_RUBRIC WHERE @out." + entityIdField + " = :id",
            Map.of("id", entityId))).await().indefinitely();
        writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
            "CREATE EDGE IN_RUBRIC FROM (SELECT FROM " + entityType + " WHERE " + entityIdField + "=:id) " +
            "TO (SELECT FROM BragiRubric WHERE rubric_id=:rid) IF NOT EXISTS",
            Map.of("id", entityId, "rid", rubricId))).await().indefinitely();
    }
}
