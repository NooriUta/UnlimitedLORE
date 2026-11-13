package studio.seer.heimdall.lore;

import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * SPRINT_LORE_MODEL_AS_CONFIG/MC-05 — SPEC-LORE-MODEL-CONFIG-STORE §4–§5: модель LORE записью в LORE.
 * <ul>
 *   <li>{@code GET /lore/model/config} — действующая версия: источник, hash, расхождение с файлом, тело;</li>
 *   <li>{@code GET /lore/model/config/{state_uid}} — тело версии (дифф и откат, MC-06);</li>
 *   <li>{@code PUT /lore/model/config} — правка: только человек с ролью admin/superadmin, проверка
 *       согласованности до записи, оптимистичная блокировка по hash, {@code dry_run}.</li>
 * </ul>
 * История версий — срез {@code model_config_history}.
 */
@Path("/lore/model/config")
public class LoreModelConfigResource extends LoreResourceBase {

    private static final Pattern STATE_UID = Pattern.compile("[0-9a-fA-F-]{36}");

    @Inject
    LoreModelStore store;

    /** Тело правки модели. */
    public record SaveRequest(String content, String reason, String expected_hash, Boolean dry_run) {}

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    @io.smallrye.common.annotation.Blocking
    public Response current() {
        if (!enabled) return disabled();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("config_id", LoreModelStore.CONFIG_ID);
        out.put("source", store.source());
        out.put("hash", store.hash());
        out.put("seed_drift", store.seedDrift());
        out.put("warning", store.warning());
        out.put("content", LoreModelFile.render(LoreModelFile.content()));
        return noStore(Response.ok(out));
    }

    @GET
    @Path("{state_uid}")
    @Produces(MediaType.APPLICATION_JSON)
    @io.smallrye.common.annotation.Blocking
    public Response version(@PathParam("state_uid") String stateUid) {
        if (!enabled) return disabled();
        if (!STATE_UID.matcher(stateUid).matches()) return badParams("state_uid — UUID версии из model_config_history");
        String content = store.versionContent(stateUid);
        if (content == null)
            return noStore(Response.status(Response.Status.NOT_FOUND).entity(new LoreError("NOT_FOUND", "версии " + stateUid + " нет")));
        return noStore(Response.ok(Map.of("state_uid", stateUid, "content", content)));
    }

    @PUT
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    @io.smallrye.common.annotation.Blocking
    public Response save(SaveRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        // Модель меняет поверхности всем — правит её человек, не агент (SPEC §4).
        if (callerAgentScope() != null)
            return noStore(Response.status(Response.Status.FORBIDDEN)
                .entity(new LoreError("HUMAN_ONLY", "модель LORE правит человек с ролью admin; агентам — только чтение")));
        if (req == null) return badParams("тело запроса пусто");
        LoreModelStore.Result r = store.save(req.content(), req.reason(), req.expected_hash(),
            Boolean.TRUE.equals(req.dry_run()), changeAuthor());
        return noStore(Response.status(r.status()).entity(r.body()));
    }
}
