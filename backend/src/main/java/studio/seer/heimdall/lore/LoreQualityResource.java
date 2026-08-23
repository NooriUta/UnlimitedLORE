package studio.seer.heimdall.lore;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Проверка полноты БЕЗ записи, пачкой (QUAL-7, ADR-LORE-039).
 *
 * <p>Линтер {@link WorkQuality} — чистая функция, и ему безразлично, зовут его
 * из write-пути или отдельно. Этот эндпоинт даёт второй способ вызова: спросить
 * вердикт по уже существующим объектам, ничего не меняя. Прецедент в корпусе —
 * {@code uc_quality} (re-lint UC без записи).
 *
 * <p><b>Только по списку id, режима «весь слой» нет</b> (решение владельца
 * 2026-08-23: «сессии не будут проверять всё, иначе просто протянет — будут
 * запрашивать кусками»). Пустой список и превышение потолка — 400 с явным
 * текстом, а не тихое усечение: молча укоротить пачку значит отдать неполный
 * ответ под видом полного.
 *
 * <p>Один запрос к графу на всю пачку ({@code WHERE … IN [...]}), а не N
 * обходов: сотня объектов иначе стала бы сотней round-trip'ов.
 */
@Path("/lore")
public class LoreQualityResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreQualityResource.class);

    /** Потолок пачки. «Кусок» не должен превращаться во весь слой обходным путём. */
    static final int MAX_BATCH = 200;

    // Проекции фактов живут в LoreQualityFacts — там же, откуда их берёт путь
    // записи. Собственной копии здесь нет намеренно: судья один, и разойтись
    // могли только факты (за один день это случилось трижды).
    @jakarta.inject.Inject
    LoreQualityFacts facts;

    public record QualityRequest(String type, List<String> ids) {}

    @POST
    @Path("quality")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response checkQuality(QualityRequest req) {
        if (!enabled) return disabled();
        if (req == null || req.type() == null || req.type().isBlank())
            return badParams("type required: " + LoreQualityFacts.Kind.names());
        LoreQualityFacts.Kind kind = LoreQualityFacts.Kind.of(req.type());
        if (kind == null)
            return badParams("unknown type \"" + req.type() + "\"; expected one of " + LoreQualityFacts.Kind.names());
        if (req.ids() == null || req.ids().isEmpty())
            return badParams("ids required — режима «весь слой» нет намеренно, спрашивайте кусками");
        if (req.ids().size() > MAX_BATCH)
            return badParams("batch too large: " + req.ids().size() + " > " + MAX_BATCH
                + " — разбейте на куски (усечение молча не делаем: неполный ответ под видом полного хуже отказа)");

        List<String> ids = new ArrayList<>();
        for (String id : req.ids()) {
            if (id == null || id.isBlank()) continue;
            if (!SAFE_ID.matcher(id).matches())
                return badParams("id contains illegal characters: " + id);
            if (!ids.contains(id)) ids.add(id);   // дубликаты в запросе не должны двоить ответ
        }
        if (ids.isEmpty()) return badParams("ids required — все переданные значения пусты");

        try {
            // Найденное судим, ненайденное называем отдельно: «нет вердикта» и
            // «объекта нет» — разные ответы, и молчать про второе нельзя.
            Map<String, WorkQuality.Result> byId = facts.forBatch(kind, ids);

            List<Map<String, Object>> failed = new ArrayList<>();
            List<String> missing = new ArrayList<>();
            int passed = 0;
            for (String id : ids) {
                WorkQuality.Result q = byId.get(id);
                if (q == null) { missing.add(id); continue; }
                List<Map<String, Object>> bad = new ArrayList<>();
                for (WorkQuality.Finding f : q.findings()) {
                    if (f.required() && !f.ok())
                        bad.add(Map.of("code", f.code(), "message", f.message()));
                }
                if (bad.isEmpty()) { passed++; continue; }
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("id", id);
                item.put("score", q.score());
                item.put("max", q.max());
                item.put("findings", bad);
                failed.add(item);
            }
            // Худшие сверху: список, где проблемное перемешано со «слегка
            // неполным», читают до первого экрана и бросают.
            failed.sort(Comparator.comparingDouble(m -> {
                int mx = (int) m.get("max");
                return mx == 0 ? 1.0 : ((int) m.get("score")) / (double) mx;
            }));

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("kind", kind.name);
            out.put("checked", ids.size() - missing.size());
            out.put("passed", passed);
            out.put("failed", failed);
            if (!missing.isEmpty()) out.put("missing", missing);
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE QUALITY BATCH] %s ×%d: %s", kind.name, ids.size(), LoreUpstream.detail(e));
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

}
