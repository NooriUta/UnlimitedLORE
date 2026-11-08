package studio.seer.heimdall.lore;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.EntityTag;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.util.List;
import java.util.Map;

/**
 * {@code GET /lore/model} — модель для поверхностей UI (ADR-LORE-048, черновик).
 * Первый срез: статусные статьи с category и allow, справочники, версия внутри
 * документа; {@code partial: true}, {@code missing} называет недостающие разделы.
 *
 * <p>Только чтение: агентам открыто, как любое чтение ({@link AgentScopeFilter} —
 * матрица только для записи). Системных полей нет: справочник читается явным
 * списком колонок, {@code @rid} в запрос не попадает.
 *
 * <p>ETag = версия документа; {@code If-None-Match} с той же версией → 304.
 */
@Path("/lore/model")
public class LoreModelResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreModelResource.class);

    static final String DICT_SQL =
        "SELECT dict_type, code, label_ru, label_en, color, icon, sort_order, " +
        "ifnull(is_active, true) AS is_active FROM KnowDictEntry ORDER BY dict_type, sort_order";

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    @io.smallrye.common.annotation.Blocking
    public Response model(@HeaderParam("If-None-Match") String ifNoneMatch) {
        if (!enabled) return disabled();
        List<Map<String, Object>> dict;
        try {
            dict = ingestService.queryPublic(DICT_SQL, Map.of());
        } catch (Exception e) {
            LOG.warnf("[LORE MODEL] справочник не прочитан: %s", e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
        Map<String, Object> doc = LoreModel.build(dict);
        String version = String.valueOf(doc.get("version"));
        EntityTag tag = new EntityTag(version);
        if (ifNoneMatch != null && ifNoneMatch.replace("\"", "").trim().equals(version)) {
            return Response.notModified(tag).header("Cache-Control", "no-cache").build();
        }
        return Response.ok(doc).tag(tag).header("Cache-Control", "no-cache").build();
    }
}
