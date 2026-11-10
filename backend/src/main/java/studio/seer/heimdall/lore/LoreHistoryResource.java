package studio.seer.heimdall.lore;

import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-03 — {@code GET /lore/history?type=&id=}:
 * цепочка SCD2 любой сущности из карты {@link LoreSlices#HIST_PARENT} с автором
 * каждой правки (см. {@link LoreEntityHistory}).
 *
 * <p><b>Почему эндпоинт, а не слайс.</b> Таблица цепочки зависит от {@code type},
 * а атрибуция — это сопоставление двух выборок (история + журнал действий) по
 * времени; ни то ни другое срез с фиксированным SQL не выражает.
 *
 * <p><b>Честность ответа.</b> Неизвестный тип — 400, а не пустой список. Скоуп
 * вызывающего пуст — 403 {@code SCOPE_EMPTY}, как у слайсов. Строки есть, но все
 * вне проектов вызывающего — {@code outside_scope}, а не «истории нет». Журнал
 * действий не прочитался — строки отдаются, но {@code attribution.ok=false} с
 * причиной: «автор не установлен» не выдаётся за «автора нет».
 */
@Path("/lore")
public class LoreHistoryResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreHistoryResource.class);

    /** Проектный read-скоуп — тот же резолвер, что у слайсов (один источник правды). */
    @Inject
    AidaLoreResource slices;

    @GET
    @Path("history")
    @Produces(MediaType.APPLICATION_JSON)
    public Response history(@QueryParam("type") String type, @QueryParam("id") String id,
                            @QueryParam("author_kind") String authorKind, @QueryParam("author") String author,
                            @QueryParam("field") String field, @QueryParam("collapse") String collapse,
                            @QueryParam("order") String order, @QueryParam("offset") Integer offset,
                            @QueryParam("limit") Integer limit,
                            @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        // S9-09: страница, фильтры и порядок — необязательны; без них ответ прежний.
        String pageErr = LoreEntityHistory.pageError(authorKind, author, field, collapse, order, offset, limit);
        if (pageErr != null) return badParams(pageErr);
        if (type == null || type.isBlank()) return badParams("type required (known: " + LoreEntityHistory.types() + ")");
        if (!LoreEntityHistory.types().contains(type))
            return badParams("unknown history type: " + type + " (known: " + LoreEntityHistory.types() + ")");
        if (id == null || id.isBlank()) return badParams("id required");
        if (!SAFE_ID.matcher(id).matches()) return badParams("id contains illegal characters");

        Set<String> allowed = LoreEntityHistory.isGlobal(type) ? null : slices.allowedProjectsOrNull(role);
        if (allowed != null && allowed.isEmpty()) {
            return noStore(Response.status(Response.Status.FORBIDDEN)
                .entity(new LoreError("SCOPE_EMPTY", "проектный скоуп: у вызывающего нет ни одного разрешённого "
                    + "проекта — история не отдаётся пустой")));
        }

        List<Map<String, Object>> raw;
        try {
            raw = ingestService.queryPublic(LoreEntityHistory.sql(type), Map.of("id", id));
        } catch (RuntimeException e) {
            LOG.warnf("[LORE HISTORY] %s/%s: %s", type, id, e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(LoreUpstream.error(e)));
        }
        List<Map<String, Object>> rows = LoreEntityHistory.scope(type, raw, allowed);

        Map<String, Object> attribution = new LinkedHashMap<>();
        attribution.put("source", "changed_by версии (S2-12); у версий без автора — journal lore.action (AO-01) ± valid_from");
        List<Map<String, Object>> journal = List.of();
        if (!rows.isEmpty()) {
            try {
                journal = ingestService.queryPublic(LoreEntityHistory.JOURNAL_SQL, Map.of("id", id));
                attribution.put("ok", true);
            } catch (RuntimeException e) {
                LOG.warnf("[LORE HISTORY] журнал %s/%s: %s", type, id, e.getMessage());
                attribution.put("ok", false);
                attribution.put("reason", "журнал действий не прочитался — автор правок не установлен: "
                    + e.getMessage());
            }
        } else {
            attribution.put("ok", true);
        }
        List<Map<String, Object>> out = LoreEntityHistory.attribute(rows, journal);
        Map<String, Object> paged = LoreEntityHistory.page(out, authorKind, author, field, collapse, order, offset, limit);
        @SuppressWarnings("unchecked") List<Map<String, Object>> pageRows = (List<Map<String, Object>>) paged.get("rows");

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("type", type);
        body.put("id", id);
        body.put("rows", LoreTimeFormat.isoUtc(pageRows));
        body.put("page", paged.get("page"));
        body.put("attribution", attribution);
        if (allowed != null) {
            Map<String, Object> scope = new LinkedHashMap<>();
            scope.put("applied", true);
            scope.put("projects", allowed.size());
            body.put("scope", scope);
            if (rows.isEmpty() && !raw.isEmpty()) body.put("outside_scope", AidaLoreResource.outsideScopeMarker(id, true));
        }
        return noStore(Response.ok(body));
    }
}
