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
        // S4-MODEL-TYPES: свойства типов из схемы графа. Не прочиталась — раздела types
        // нет и он остаётся в missing (честная неполнота), а не пустой раздел.
        Map<String, List<String>> schema = null;
        // Аудит времени 10.11: объявленный тип свойства (DATETIME / DATE / STRING) — в поле
        // property_type; схема — у всех вершин модели (LoreComponent тоже), не только Know*.
        Map<String, Map<String, String>> declared = new java.util.HashMap<>();
        try {
            schema = new java.util.HashMap<>();
            for (Map<String, Object> t : ingestService.queryPublic("SELECT name, properties FROM schema:types", Map.of())) {
                String name = t.get("name") == null ? null : String.valueOf(t.get("name"));
                if (!LoreModelTypes.wantsSchemaOf(name)) continue;
                List<String> props = new java.util.ArrayList<>();
                Map<String, String> types = new java.util.HashMap<>();
                if (t.get("properties") instanceof List<?> l)
                    for (Object p : l)
                        if (p instanceof Map<?, ?> pm && pm.get("name") != null) {
                            props.add(String.valueOf(pm.get("name")));
                            if (pm.get("type") != null) types.put(String.valueOf(pm.get("name")), String.valueOf(pm.get("type")));
                        }
                schema.put(name, props);
                declared.put(name, types);
            }
        } catch (Exception e) {
            LOG.warnf("[LORE MODEL] схема типов не прочитана — раздел types не отдаю: %s", e.getMessage());
            schema = null;
        }
        Map<String, Object> doc = LoreModel.build(dict, schema, declared);
        String version = String.valueOf(doc.get("version"));
        EntityTag tag = new EntityTag(version);
        if (ifNoneMatch != null && ifNoneMatch.replace("\"", "").trim().equals(version)) {
            return Response.notModified(tag).header("Cache-Control", "no-cache").build();
        }
        return Response.ok(doc).tag(tag).header("Cache-Control", "no-cache").build();
    }
}
