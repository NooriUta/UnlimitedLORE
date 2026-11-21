package studio.seer.heimdall.lore;

import jakarta.inject.Inject;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.util.Map;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MD-05 · {@code POST /lore/admin/pr-backfill} — дотянуть данные PR из git-хоста.
 *
 * <p>Для KnowPR без заголовка, адреса или состояния (и влитых без даты мержа) читает PR через мост Forgejo
 * (токен моста — из SecretProvider, как у мержа) и дописывает только недостающие поля. Чужой или недоступный
 * репозиторий — пропуск с причиной. Порция — {@code limit} (по умолчанию 200, не больше 1000) после курсора
 * {@code after} (pr_uid); ответ несёт {@code next_after} и {@code done}. {@code dry_run=true} — только посчитать.
 * Повтор по дотянутому — 0 изменений. Только super-admin; вызывает шаг переноса {@code lore-migrate pr-backfill}.
 */
@Path("/lore/admin/pr-backfill")
public class LorePrBackfillResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LorePrBackfillResource.class);

    @Inject
    ForgejoBridge forgejo;

    @POST
    @Produces(MediaType.APPLICATION_JSON)
    public Response run(@QueryParam("after") String after, @QueryParam("limit") Integer limit,
                        @QueryParam("dry_run") Boolean dryRun, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireSuperAdmin(role);
        if (!forgejo.configured())
            return noStore(Response.status(503).entity(new LoreError("FORGEJO_NOT_CONFIGURED",
                "мост Forgejo не сконфигурирован (" + ForgejoBridge.FORGEJO_TOKEN_KEY
                    + " не задан) — данные PR дотянуть неоткуда; ничего не менялось")));
        int lim = limit == null ? PrBackfill.DEFAULT_LIMIT : limit;
        if (lim < 1 || lim > PrBackfill.MAX_LIMIT) return badParams("limit: 1.." + PrBackfill.MAX_LIMIT);
        try {
            Map<String, Object> out = PrBackfill.run(prStore(), forgejo.prHost(), after, lim, Boolean.TRUE.equals(dryRun));
            LOG.infof("[PR BACKFILL] after=%s scanned=%s updated=%s skipped=%s done=%s",
                after, out.get("scanned"), out.get("updated"), out.get("skipped"), out.get("done"));
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[PR BACKFILL] %s", e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }
}
