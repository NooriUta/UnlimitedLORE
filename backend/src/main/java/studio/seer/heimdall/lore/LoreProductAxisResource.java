package studio.seer.heimdall.lore;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.util.List;
import java.util.Map;

/**
 * Продуктовая ось: рёбра продукта (RM-P6, решение D-2026-LORE-PRODUCT-IS-OWN-ENTITY).
 *
 * <p><b>Почему отдельный класс, а не {@code LoreProductResource}.</b> Тот файл — это
 * продуктовый СЛОЙ ADR-LORE-022: Feature → UseCase → Actor → Pain/Gain/Job, то есть
 * «что и кому даёт ценность». Здесь — продуктовая ОСЬ: «что мы делаем и продаём»,
 * носитель дорожной карты. Два разных понятия на одном слове; держать их в одном
 * файле значит гарантировать, что через месяц кто-то поправит не то.
 *
 * <p><b>Сам продукт — запись справочника</b> {@code KnowDictEntry} с
 * {@code dict_type='product'}, заводится существующим {@code POST /lore/dict/entry}.
 * Отдельного write-эндпоинта для вершины здесь нет намеренно — второй способ
 * создать ту же запись и есть тот класс ошибок, который мы весь спринт разбираем.
 *
 * <p>Эндпоинт один, тип связи параметром {@code rel} — конвенция ADR-LORE-014
 * (link-collapse: {@code adr_link}, {@code sprint_link}, {@code task_link}).
 */
@Path("/lore")
public class LoreProductAxisResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreProductAxisResource.class);

    /** Роли компонента в продукте. Пусто = owner (кто делает). */
    private static final List<String> ROLES = List.of("owner", "consumer");

    public record ProductLinkRequest(
        String product_code,
        String rel,        // component | project | parent
        String target_id,
        String role,       // только для rel=component: owner (умолчание) | consumer
        String action      // add (умолчание) | remove
    ) {}

    @POST
    @Path("product/link")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response productLink(ProductLinkRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.product_code() == null || req.rel() == null || req.target_id() == null)
            return badParams("product_code, rel and target_id required");

        final String rel = req.rel().trim().toLowerCase();
        final String action = req.action() == null || req.action().isBlank()
            ? "add" : req.action().trim().toLowerCase();
        if (!List.of("component", "project", "parent").contains(rel))
            return badParams("rel must be one of: component, project, parent");
        if (!List.of("add", "remove").contains(action))
            return badParams("action must be add or remove");

        final String code = req.product_code().trim();
        final String target = req.target_id().trim();
        if (!SAFE_ID.matcher(code).matches() || !SAFE_ID.matcher(target).matches())
            return badParams("product_code/target_id contain illegal characters");

        final String edgeType = switch (rel) {
            case "component" -> "IN_PRODUCT";
            case "parent"    -> "PARENT_PRODUCT";
            default          -> "BELONGS_TO_PROJECT";
        };
        // Направление рёбер выбрано по образцу уже существующих, чтобы обход
        // читался одинаково: IN_AREA идёт компонент → справочник, PARENT_OF идёт
        // ребёнок → родитель. Значит и здесь «принадлежащее» указывает на «того,
        // кому принадлежит», а состав читается через in().
        final String fromSql, toSql;
        switch (rel) {
            case "component" -> {
                fromSql = String.format(
                    "SELECT FROM LoreComponent WHERE component_id='%s'", target);
                toSql = productSelect(code);
            }
            case "parent" -> {
                if (code.equals(target))
                    return badParams("product cannot be its own parent");
                fromSql = productSelect(code);
                toSql = productSelect(target);
            }
            default -> {
                fromSql = productSelect(code);
                toSql = String.format(
                    "SELECT FROM KnowGitProject WHERE slug='%s'", target);
            }
        }

        try {
            // Обе стороны обязаны существовать. Пустая выборка в CREATE EDGE ...
            // TO (SELECT ...) НЕ падает — она молча не создаёт ребра, и вызывающий
            // получает ok:true на несделанной работе. Это записанный класс ошибок
            // (project_new/linked:false, spec_link), поэтому проверяем явно.
            if (countOf(productSelect(code)) == 0)
                return badParams("product '" + code + "' not found (dict_type='product')");
            final String targetSelect = "component".equals(rel)
                ? String.format("SELECT FROM LoreComponent WHERE component_id='%s'", target)
                : "parent".equals(rel)
                    ? productSelect(target)
                    : String.format("SELECT FROM KnowGitProject WHERE slug='%s'", target);
            if (countOf(targetSelect) == 0)
                return badParams("target '" + target + "' not found for rel=" + rel);

            // Снимаем существующее ребро в любом случае: для add это делает вызов
            // идемпотентным (иначе повтор плодит дубли — CREATE EDGE их не гасит),
            // для remove это и есть работа. DELETE EDGE в грамматике ArcadeDB
            // отсутствует, поэтому удаляем строки самого типа ребра по @rid.
            int removed = dropEdges(edgeType, rel, code, target);

            if ("remove".equals(action)) {
                return noStore(Response.ok(Map.of(
                    "ok", true, "product_code", code, "rel", rel,
                    "target_id", target, "action", "removed", "edges_removed", removed)));
            }

            final String roleValue = req.role() == null || req.role().isBlank()
                ? "owner" : req.role().trim().toLowerCase();
            if ("component".equals(rel) && !ROLES.contains(roleValue))
                return badParams("role must be one of: " + String.join(", ", ROLES));

            final String set = "component".equals(rel)
                ? String.format(" SET role='%s'", roleValue) : "";
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                String.format("CREATE EDGE %s FROM (%s) TO (%s)%s", edgeType, fromSql, toSql, set),
                Map.of())).await().indefinitely();

            Map<String, Object> body = new java.util.LinkedHashMap<>();
            body.put("ok", true);
            body.put("product_code", code);
            body.put("rel", rel);
            body.put("target_id", target);
            body.put("action", "added");
            if ("component".equals(rel)) body.put("role", roleValue);
            return noStore(Response.ok(body));
        } catch (Exception e) {
            LOG.warnf("[LORE PRODUCT LINK] %s %s %s→%s: %s", action, rel, code, target, e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    private static String productSelect(String code) {
        return String.format(
            "SELECT FROM KnowDictEntry WHERE dict_type='product' AND code='%s'", code);
    }

    private long countOf(String selectSql) {
        List<Map<String, Object>> rows = ingestService.queryPublic(
            "SELECT count(*) AS n FROM (" + selectSql + ")", Map.of());
        if (rows.isEmpty()) return 0;
        Object n = rows.get(0).get("n");
        return n instanceof Number num ? num.longValue() : 0;
    }

    /**
     * Снять рёбра между конкретной парой. Фильтр по {@code @out}/{@code @in} —
     * запрос ПО ТИПУ РЕБРА, а не обходом: обход отдал бы список и сравнение с
     * ним через [0] показало бы многосвязное под одним случайным значением.
     */
    private int dropEdges(String edgeType, String rel, String code, String target) {
        String where = switch (rel) {
            case "component" -> String.format(
                "@out.component_id='%s' AND @in.code='%s' AND @in.dict_type='product'", target, code);
            case "parent" -> String.format(
                "@out.code='%s' AND @out.dict_type='product' AND @in.code='%s'", code, target);
            default -> String.format(
                "@out.code='%s' AND @out.dict_type='product' AND @in.slug='%s'", code, target);
        };
        int n = 0;
        try {
            List<Map<String, Object>> rows = ingestService.queryPublic(
                "SELECT @rid AS rid FROM " + edgeType + " WHERE " + where, Map.of());
            for (Map<String, Object> row : rows) {
                Object rid = row.get("rid");
                if (rid == null) continue;
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM " + edgeType + " WHERE @rid=" + rid)).await().indefinitely();
                n++;
            }
        } catch (Exception e) {
            LOG.warnf("[LORE PRODUCT LINK] drop %s %s→%s: %s", edgeType, code, target, e.getMessage());
        }
        return n;
    }
}
