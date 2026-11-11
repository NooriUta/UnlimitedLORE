package studio.seer.heimdall.lore;

import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import org.jboss.logging.Logger;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-MCP-CHANGED-RANGE (остаток, v1.17.14) — {@code GET /lore/changed?types=&from=&to=
 * &project=&status_category=&actor=&limit=&offset=}: что изменилось за период по многим типам одной выдачей.
 * Логика — {@link LoreChanged}; здесь только чтение: срезы типа под проектным скоупом вызывающего
 * (тот же {@code allowedProjectsOrNull}, что у {@code /lore/slice}) и версии истории изменённых записей.
 *
 * <p>Сбой чтения типа не роняет ответ и не прячется: тип уходит в {@code errors[]} со стадией
 * ({@code list} | {@code history}) и причиной, ответ — {@code complete:false}. Пустой скоуп — 403
 * {@code SCOPE_EMPTY}, как у срезов: «нет прав» не выглядит как «ничего не изменилось».
 *
 * <p>Возвращает {@link Response} (не Uni) — RESTEasy Reactive исполняет на рабочей нити, блокирующий
 * {@code queryPublic} безопасен (тот же приём, что {@code /lore/news} и {@code /lore/history}).
 */
@Path("/lore")
public class LoreChangedResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreChangedResource.class);

    /** Список id в одном запросе истории — ограничен, чтобы запрос не рос без меры. */
    static final int HIST_CHUNK = 300;

    /** Проектный read-скоуп — тот же резолвер, что у слайсов (один источник правды). */
    @Inject
    AidaLoreResource slices;

    @GET
    @Path("changed")
    @Produces(MediaType.APPLICATION_JSON)
    public Response changed(@Context UriInfo uriInfo, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Map<String, String> given = new LinkedHashMap<>();
        uriInfo.getQueryParameters().forEach((k, v) -> {
            if (v != null && !v.isEmpty()) given.put(k, v.get(0));
        });
        LoreChanged.Query q;
        try {
            q = LoreChanged.parse(given);
        } catch (IllegalArgumentException e) {
            return badParams(e.getMessage());
        }
        Set<String> allowed = slices.allowedProjectsOrNull(role);
        if (allowed != null && allowed.isEmpty()) {
            return noStore(Response.status(Response.Status.FORBIDDEN)
                .entity(new LoreError("SCOPE_EMPTY", "проектный скоуп: у вызывающего нет ни одного разрешённого "
                    + "проекта — «что изменилось» не отдаётся пустым")));
        }

        List<Map<String, Object>> items = new ArrayList<>();
        List<Map<String, Object>> errors = new ArrayList<>();
        for (String type : q.types()) {
            LoreChanged.Source src = LoreChanged.SOURCES.get(type);
            String unsupported = LoreChanged.projectUnsupported(src, q.project());
            if (unsupported != null) { errors.add(error(type, "project", unsupported)); continue; }
            List<Map<String, Object>> rows = new ArrayList<>();
            try {
                for (String slice : LoreChanged.slicesFor(src, q.statusCategory())) {
                    LoreSlices.Composed c = LoreSlices.compose(slice, LoreChanged.sliceParams(src, q.project()), allowed);
                    rows.addAll(ingestService.queryPublic(c.sql(), c.params()));
                }
            } catch (RuntimeException e) {
                LOG.warnf("[LORE CHANGED] %s list: %s", type, e.getMessage());
                errors.add(error(type, "list", e.getMessage()));
                continue;
            }
            List<Map<String, Object>> hist = null;
            String histSql = LoreChanged.histSql(src);
            if (histSql != null) {
                List<String> ids = LoreChanged.changedIds(src, rows, q);
                try {
                    hist = new ArrayList<>();
                    for (int i = 0; i < ids.size(); i += HIST_CHUNK) {
                        List<String> chunk = ids.subList(i, Math.min(ids.size(), i + HIST_CHUNK));
                        hist.addAll(ingestService.queryPublic(histSql, Map.of("ids", new ArrayList<>(chunk))));
                    }
                } catch (RuntimeException e) {
                    // Строки типа отдаются, но «было → стало» и автор не установлены — это сказано.
                    LOG.warnf("[LORE CHANGED] %s history: %s", type, e.getMessage());
                    errors.add(error(type, "history", e.getMessage()));
                    hist = null;
                }
            }
            items.addAll(LoreChanged.items(src, rows, hist, q));
        }

        Map<String, Object> body = LoreChanged.assemble(q, items, errors);
        if (allowed != null) {
            Map<String, Object> scope = new LinkedHashMap<>();
            scope.put("applied", true);
            scope.put("projects", allowed.size());
            body.put("scope", scope);
        }
        return noStore(Response.ok(body));
    }

    private static Map<String, Object> error(String type, String stage, String reason) {
        Map<String, Object> e = new LinkedHashMap<>();
        e.put("type", type);
        e.put("stage", stage);
        e.put("reason", reason);
        return e;
    }
}
