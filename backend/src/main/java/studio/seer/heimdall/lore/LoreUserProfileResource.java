package studio.seer.heimdall.lore;

import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;
import org.jboss.resteasy.reactive.RestForm;
import org.jboss.resteasy.reactive.multipart.FileUpload;

import java.io.InputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * SPRINT_LORE_ADMIN_POLISH/AP-07 — профиль автора: имя и аватар человека.
 *
 * <ul>
 *   <li>{@code GET /lore/users?ids=} — дверь для miniLORE и самого LORE: голый массив строк
 *       {@code {kc_sub, login, display_name, avatar_url, found}}; почты и ролей нет.</li>
 *   <li>{@code GET /lore/users/{sub}/avatar} — байты аватара с ETag (304 на If-None-Match).</li>
 *   <li>{@code POST /lore/users/{sub}/profile} — имя: свой — сам, чужой — админ.</li>
 *   <li>{@code POST /lore/users/{sub}/avatar} — картинка (png/jpeg/webp, до 2 МБ): те же права.</li>
 * </ul>
 * Правила — в {@link UserProfiles}, здесь только связь с базой и хранилищем ассетов.
 */
@Path("/lore/users")
public class LoreUserProfileResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreUserProfileResource.class);

    @Inject
    BragiS3Service s3;

    public record ProfileRequest(String display_name) {}

    public static class AvatarForm {
        @RestForm("file")
        public FileUpload file;
    }

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Response list(@QueryParam("ids") String ids) {
        if (!enabled) return disabled();
        List<String> want = UserProfiles.parseIds(ids);
        if (want.isEmpty()) return badParams("ids required — kc_sub или логины через запятую");
        List<Map<String, Object>> rows = ingestService.queryPublic(
            "SELECT kc_sub, coalesce(login, display_name) AS login, display_name, avatar_ref FROM KnowUser " +
            "WHERE kc_sub IN :ids OR coalesce(login, display_name) IN :ids",
            Map.of("ids", want));
        List<Map<String, Object>> out = new ArrayList<>();
        for (String id : want) {
            Map<String, Object> hit = null;
            for (Map<String, Object> r : rows)
                if (id.equals(r.get("kc_sub")) || id.equals(r.get("login"))) { hit = r; break; }
            out.add(UserProfiles.row(id, hit));
        }
        return noStore(Response.ok(out));
    }

    @GET
    @Path("{sub}/avatar")
    public Response avatar(@PathParam("sub") String sub, @HeaderParam("If-None-Match") String ifNoneMatch) {
        if (!enabled) return disabled();
        String ref = avatarRefOf(sub);
        if (ref == null)
            return noStore(Response.status(Response.Status.NOT_FOUND)
                .entity(new LoreError("NO_AVATAR", "у человека " + sub + " нет аватара — рисуйте инициалы")));
        // MIG-04: установка «без файлов» (S3 не задан) — 503 словами, а не 500/пустота.
        if (!s3.configured()) return BragiS3Service.notConfigured();
        String etag = UserProfiles.etagOf(ref);
        if (LoreEtag.matches(ifNoneMatch, etag))
            return Response.notModified().header("ETag", etag).build();
        try {
            byte[] data = s3.get(ref);
            return Response.ok(data)
                .type(s3.contentType(ref))
                .header("ETag", etag)
                .header("Cache-Control", "private, max-age=300")
                .build();
        } catch (Exception e) {
            LOG.warnf("[LORE PROFILE] аватар %s: %s", sub, e.getMessage());
            return OptionalUpstream.failure(OptionalUpstream.Service.S3, e, "аватар не прочитан из хранилища");
        }
    }

    @POST
    @Path("{sub}/profile")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response setProfile(@PathParam("sub") String sub, ProfileRequest req,
                               @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response refused = editRefusal(sub, role);
        if (refused != null) return refused;
        String name = req == null ? null : req.display_name();
        String why = UserProfiles.nameRefusal(name);
        if (why != null) return badParams(why);
        if (!userExists(sub)) return notFound(sub);
        writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
            // У записи до V92 логин живёт в display_name: фиксируем его в login ДО смены имени, иначе он потеряется.
            // Пакет 1.18: name_source = 'manual' — имя задано в профиле, сверка с KC (KcUserNames) его не перетирает.
            "UPDATE KnowUser SET login = coalesce(login, display_name), display_name = :n, name_source = 'manual' WHERE kc_sub = :s", Map.of("n", name.strip(), "s", sub)))
            .await().indefinitely();
        return noStore(Response.ok(profileOf(sub)));
    }

    @POST
    @Path("{sub}/avatar")
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    @Produces(MediaType.APPLICATION_JSON)
    public Response setAvatar(@PathParam("sub") String sub, AvatarForm form,
                              @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Response refused = editRefusal(sub, role);
        if (refused != null) return refused;
        if (form == null || form.file == null) return badParams("file required");
        // MIG-04: установка «без файлов» (S3 не задан) — 503 словами, а не 500/пустота.
        if (!s3.configured()) return BragiS3Service.notConfigured();

        try {
            long size = java.nio.file.Files.size(form.file.uploadedFile());
            String mime = String.valueOf(form.file.contentType()).toLowerCase();
            String why = UserProfiles.imageRefusal(mime, size);
            if (why != null) return badParams(why);
            if (!userExists(sub)) return notFound(sub);
            byte[] bytes = java.nio.file.Files.readAllBytes(form.file.uploadedFile());
            String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)).substring(0, 16);
            String key = "user/" + sub + "/" + hash + "." + UserProfiles.AVATAR_MIME_EXT.get(mime);
            try (InputStream in = new java.io.ByteArrayInputStream(bytes)) {
                s3.put(key, in, size, mime);
            }
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE KnowUser SET avatar_ref = :k WHERE kc_sub = :s", Map.of("k", key, "s", sub)))
                .await().indefinitely();
            return noStore(Response.ok(profileOf(sub)));
        } catch (Exception e) {
            LOG.warnf("[LORE PROFILE] загрузка аватара %s: %s", sub, e.getMessage());
            return OptionalUpstream.failure(OptionalUpstream.Service.S3, e, "аватар не сохранён");
        }
    }

    /** Свой — сам, чужой — админ; иначе 403 словами. */
    private Response editRefusal(String sub, String role) {
        if (UserProfiles.canEdit(callerKcSub(), role, sub)) return null;
        return noStore(Response.status(Response.Status.FORBIDDEN).entity(new LoreError("FORBIDDEN",
            "чужой профиль меняет только админ; свой — сам, со своим входом")));
    }

    private boolean userExists(String sub) {
        return !ingestService.queryPublic("SELECT kc_sub FROM KnowUser WHERE kc_sub = :s", Map.of("s", sub)).isEmpty();
    }

    private String avatarRefOf(String sub) {
        List<Map<String, Object>> r = ingestService.queryPublic(
            "SELECT avatar_ref FROM KnowUser WHERE kc_sub = :s", Map.of("s", sub));
        if (r.isEmpty() || r.get(0).get("avatar_ref") == null) return null;
        String ref = String.valueOf(r.get(0).get("avatar_ref"));
        return ref.isBlank() ? null : ref;
    }

    private Map<String, Object> profileOf(String sub) {
        List<Map<String, Object>> r = ingestService.queryPublic(
            "SELECT kc_sub, coalesce(login, display_name) AS login, display_name, avatar_ref FROM KnowUser WHERE kc_sub = :s", Map.of("s", sub));
        Map<String, Object> out = new LinkedHashMap<>(UserProfiles.row(sub, r.isEmpty() ? null : r.get(0)));
        out.put("ok", true);
        return out;
    }

    private Response notFound(String sub) {
        return noStore(Response.status(Response.Status.NOT_FOUND)
            .entity(new LoreError("USER_NOT_FOUND", "человека " + sub + " в LORE нет")));
    }
}
