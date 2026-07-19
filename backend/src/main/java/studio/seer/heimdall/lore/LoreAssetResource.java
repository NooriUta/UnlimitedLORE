package studio.seer.heimdall.lore;

import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;
import org.jboss.resteasy.reactive.RestForm;
import org.jboss.resteasy.reactive.multipart.FileUpload;

import java.io.InputStream;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Generic-ассеты для MD-полей ЛЮБОЙ сущности (ADR-LORE-031, PL-21).
 *
 * Анти-бардак by construction:
 * - ключ = контент-адрес {entity_type}/{entity_id}/{sha256-16}.{ext} — по ключу
 *   видно чей файл, повторная загрузка того же содержимого = тот же ключ (дедуп);
 * - upload ОБЯЗАН нести entity_type+entity_id существующей вершины — вершина
 *   KnowAsset + ребро ATTACHED_TO создаются тем же запросом, что и файл:
 *   сирота невозможен на записи (чистота — слайс asset_orphans + GC, не каскад);
 * - включение и лимит — настройки Админки (словарь app_setting, AL-38):
 *   md_images_enabled (default true), md_image_max_mb (default 5).
 *
 * S3-слой — тот же BragiS3Service/бакет, что у Bragi (второй механизм не
 * заводится, §3 ADR-031); легаси-ключи bragi/{uuid} продолжают жить рядом.
 */
@Path("/lore/asset")
public class LoreAssetResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreAssetResource.class);

    /** mime → каноническое расширение; всё вне списка — 400 (ADR-031 §2). */
    static final Map<String, String> MIME_EXT = Map.of(
        "image/png", "png", "image/jpeg", "jpg", "image/webp", "webp",
        "image/gif", "gif", "image/svg+xml", "svg");

    /** entity_type → (vertex class, key field). Только реально существующие типы:
     *  неизвестный тип = 400, несуществующая вершина = 404 — файл не пишется. */
    static final Map<String, String[]> ENTITY_TYPES = Map.ofEntries(
        Map.entry("adr",       new String[]{"KnowADR", "adr_id"}),
        Map.entry("sprint",    new String[]{"KnowSprint", "sprint_id"}),
        Map.entry("task",      new String[]{"KnowTask", "task_uid"}),
        Map.entry("feature",   new String[]{"KnowFeature", "feature_id"}),
        Map.entry("uc",        new String[]{"KnowUseCase", "uc_id"}),
        Map.entry("actor",     new String[]{"KnowActor", "actor_id"}),
        Map.entry("component", new String[]{"LoreComponent", "component_id"}),
        Map.entry("spec",      new String[]{"KnowSpec", "spec_id"}),
        Map.entry("doc",       new String[]{"KnowDoc", "doc_id"}),
        Map.entry("runbook",   new String[]{"KnowRunbook", "runbook_id"}),
        Map.entry("question",  new String[]{"KnowQuestion", "question_id"}),
        Map.entry("decision",  new String[]{"KnowDecision", "decision_id"}),
        Map.entry("milestone", new String[]{"KnowMilestone", "milestone_id"}));

    @Inject
    BragiS3Service s3;

    public static class AssetUploadForm {
        @RestForm("file")
        public FileUpload file;
        @RestForm("entity_type")
        public String entityType;
        @RestForm("entity_id")
        public String entityId;
        @RestForm("alt")
        public String alt;
    }

    @POST
    @Path("upload")
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upload(AssetUploadForm form, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (form == null || form.file == null || form.file.fileName() == null)
            return badParams("file required");
        String type = str(form.entityType);
        String id = str(form.entityId);
        if (type.isEmpty() || id.isEmpty())
            return badParams("entity_type and entity_id required — ассет без привязки не принимается (ADR-031)");
        String[] target = ENTITY_TYPES.get(type);
        if (target == null)
            return badParams("unknown entity_type '" + type + "'; known: " + ENTITY_TYPES.keySet());
        if (!SAFE_ID.matcher(id).matches())
            return badParams("entity_id contains illegal characters");

        if (!settingBool("md_images_enabled", true))
            return noStore(Response.status(Response.Status.CONFLICT)
                .entity(new LoreError("MD_IMAGES_DISABLED",
                    "вставка картинок выключена настройкой md_images_enabled (Админка → Настройки)")));

        String mime = str(form.file.contentType()).toLowerCase();
        String ext = MIME_EXT.get(mime);
        if (ext == null)
            return badParams("mime '" + mime + "' не в whitelist: " + MIME_EXT.keySet());

        try {
            long size = java.nio.file.Files.size(form.file.uploadedFile());
            long maxMb = settingLong("md_image_max_mb", 5);
            if (size > maxMb * 1024 * 1024)
                return badParams("файл " + size + " байт превышает лимит md_image_max_mb=" + maxMb + " МБ");

            // Существование вершины — ДО записи файла (404 → в бакет ничего не попало).
            List<Map<String, Object>> found = ingestService.queryPublic(
                "SELECT " + target[1] + " FROM " + target[0] + " WHERE " + target[1] + "=:id",
                Map.of("id", id));
            if (found.isEmpty())
                return noStore(Response.status(Response.Status.NOT_FOUND)
                    .entity(new LoreError("ENTITY_NOT_FOUND", target[0] + " '" + id + "' не существует")));

            byte[] bytes = java.nio.file.Files.readAllBytes(form.file.uploadedFile());
            String hash = HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(bytes)).substring(0, 16);
            String key = type + "/" + id + "/" + hash + "." + ext;

            try (InputStream in = new java.io.ByteArrayInputStream(bytes)) {
                s3.put(key, in, size, mime);
            }
            // Вершина + ребро в том же запросе, что и файл. UPSERT по ключу:
            // повторная загрузка того же содержимого — не дубль, а тот же ассет.
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE KnowAsset SET asset_key=:k, entity_type=:t, entity_id=:id, mime=:m, " +
                "size_bytes=:s, alt=:alt, created_at=:ts UPSERT WHERE asset_key=:k",
                mapOfNullable("k", key, "t", type, "id", id, "m", mime, "s", size,
                    "alt", str(form.alt), "ts", Instant.now().toString()))).await().indefinitely();
            List<Map<String, Object>> hasEdge = ingestService.queryPublic(
                "SELECT @rid FROM ATTACHED_TO WHERE @in IN (SELECT @rid FROM KnowAsset WHERE asset_key=:k)",
                Map.of("k", key));
            if (hasEdge.isEmpty()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    String.format(
                    "CREATE EDGE ATTACHED_TO FROM (SELECT FROM %s WHERE %s='%s') " +
                    "TO (SELECT FROM KnowAsset WHERE asset_key='%s')",
                    target[0], target[1], id, key))).await().indefinitely();
            }
            String url = "/lore/asset/file/" + key;
            return noStore(Response.ok(Map.of(
                "ok", true, "asset_key", key, "file_url", url, "size_bytes", size,
                "md", "![" + str(form.alt) + "](" + url + ")")));
        } catch (Exception e) {
            LOG.warnf("[LORE ASSET] upload %s/%s: %s", type, id, e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("S3_UPSTREAM", e.getMessage())));
        }
    }

    /** Отдача файла — публичная, как у Bragi-серва: картинки в телах читают все читатели тел. */
    @GET
    @Path("file/{type}/{id}/{name}")
    public Response serve(@PathParam("type") String type, @PathParam("id") String id,
                          @PathParam("name") String name) {
        if (!enabled) return disabled();
        if (!SAFE_ID.matcher(str(type)).matches() || !SAFE_ID.matcher(str(id)).matches()
            || !SAFE_ID.matcher(str(name)).matches())
            return badParams("illegal path");
        try {
            String key = type + "/" + id + "/" + name;
            byte[] data = s3.get(key);
            String mime = s3.contentType(key);
            return Response.ok(data)
                .type(mime == null ? "application/octet-stream" : mime)
                .header("Cache-Control", "public, max-age=31536000, immutable") // контент-адрес: содержимое не меняется
                .build();
        } catch (Exception e) {
            return noStore(Response.status(Response.Status.NOT_FOUND)
                .entity(new LoreError("NOT_FOUND", "asset not found")));
        }
    }

    // ── настройки из словаря app_setting (значение — label_ru, AL-38) ────────

    private String setting(String code) {
        try {
            List<Map<String, Object>> rows = ingestService.queryPublic(
                "SELECT label_ru FROM KnowDictEntry WHERE dict_type='app_setting' AND code=:c AND is_active=true",
                Map.of("c", code));
            return rows.isEmpty() ? null : str(rows.get(0).get("label_ru"));
        } catch (Exception e) {
            return null; // настройки недоступны → работаем по дефолтам, не падаем
        }
    }

    boolean settingBool(String code, boolean def) {
        String v = setting(code);
        return v == null || v.isEmpty() ? def : !"false".equalsIgnoreCase(v);
    }

    long settingLong(String code, long def) {
        try {
            String v = setting(code);
            return v == null || v.isEmpty() ? def : Long.parseLong(v.trim());
        } catch (NumberFormatException e) {
            return def;
        }
    }
}
