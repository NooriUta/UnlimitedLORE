package studio.seer.heimdall.lore;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Путь записи организации (D-2026-MIG-REPOSITORY-ORGANIZATION; решение владелицы 19.11.2026: «организацию пока
 * с проектами, продуктами и людьми в админке связи и всё, и в админку её минимально»).
 *
 * <p>Два действия, оба под super-admin — тот же человеческий порог, что у создания проекта
 * ({@link LoreResourceBase#requireSuperAdmin}): организация, как и проект, — единица, к которой привязываются чужие
 * записи. Агентам путь закрыт (семейство organization — HUMAN_ONLY в AgentScopeFilter). Новых MCP-инструментов нет: пишет админка (паспорт организации через
 * {@code POST /lore/record/organization/{id}/relation} и форма создания).
 * <ul>
 *   <li>{@code POST /lore/organization} — завести или переименовать {@code {org_id, name}} (UPSERT по org_id);</li>
 *   <li>{@code POST /lore/organization/link} — привязать или снять проект, продукт, человека.</li>
 * </ul>
 *
 * <p><b>Схема.</b> Организация есть только в схеме, собранной из модели (перенос 1.18). На старой схеме (журнал
 * шагов V) вершины KnowOrganization нет — запись отказывает 409 словами, а не 502 и не заведением типа на проде.
 * Рёбра связей ({@link LoreModelConsistency#MODEL_SCHEMA_EDGES}) заводятся при создании организации
 * ({@code CREATE EDGE TYPE … IF NOT EXISTS}) — только там, где вершина организации уже есть.
 */
@Path("/lore")
public class LoreOrganizationResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreOrganizationResource.class);

    /** Ребро организации → вершина и деловой ключ цели. Порядок — порядок групп вкладки «Связи». */
    static final Map<String, List<String>> TARGETS;
    static {
        Map<String, List<String>> m = new LinkedHashMap<>();
        m.put("ORG_HAS_PROJECT", List.of("KnowGitProject", "slug"));
        m.put("ORG_HAS_PRODUCT", List.of("KnowDictEntry", "code"));
        m.put("ORG_MEMBER", List.of("KnowUser", "kc_sub"));
        // владелица 21.11.2026: «в админке кроме организации должен быть и срез репозиториев к ней»
        m.put("ORG_HAS_REPOSITORY", List.of("KnowRepository", "url"));
        TARGETS = java.util.Collections.unmodifiableMap(m);
    }

    /** Вершина и ключ цели ребра; {@code null} — ребро не путь организации. */
    static List<String> target(String rel) {
        return rel == null ? null : TARGETS.get(rel);
    }

    static final String NO_SCHEMA = "в схеме базы нет организаций (KnowOrganization): они появляются с переносом 1.18 "
        + "(схема из модели); на старой схеме организацию завести нельзя";

    public record OrgCreateRequest(String org_id, String name) {}

    public record OrgLinkRequest(String org_id, String rel, String target, String action) {}

    @POST
    @Path("organization")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response createOrganization(OrgCreateRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireSuperAdmin(role);
        if (req == null || req.org_id() == null || req.org_id().isBlank()) return badParams("org_id required");
        if (!SAFE_ID.matcher(req.org_id()).matches()) return badParams("org_id contains illegal characters");
        try {
            if (!hasOrganizationType()) return noSchema();
            boolean existed = exists("KnowOrganization", "org_id", req.org_id());
            // Заведение или переименование. UPSERT ArcadeDB требует уникального индекса по org_id, а есть ли он в схеме
            // из модели — не гарантировано: поэтому «есть — UPDATE, нет — INSERT». Вызов без имени не стирает прежнее.
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("id", req.org_id());
            String name = req.name() == null ? null : req.name().trim();
            if (name != null) p.put("name", name);
            String sql = existed
                ? (name != null ? "UPDATE KnowOrganization SET name=:name WHERE org_id=:id" : null)
                : (name != null ? "INSERT INTO KnowOrganization SET org_id=:id, name=:name" : "INSERT INTO KnowOrganization SET org_id=:id");
            if (sql != null)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql, p)).await().indefinitely();
            for (String e : TARGETS.keySet())
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE TYPE " + e + " IF NOT EXISTS", Map.of())).await().indefinitely();
            if (!exists("KnowOrganization", "org_id", req.org_id()))   // DBR-17: исход из факта
                return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(new LoreError("NOT_WRITTEN",
                    "организация " + req.org_id() + " не появилась после записи")));
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("org_id", req.org_id());
            out.put("outcome", existed ? LoreOutcome.UPDATED : LoreOutcome.CREATED);
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE ORG CREATE] %s: %s", req.org_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }

    @POST
    @Path("organization/link")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkOrganization(OrgLinkRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireSuperAdmin(role);
        if (req == null || req.org_id() == null || req.org_id().isBlank() || req.target() == null || req.target().isBlank())
            return badParams("org_id, rel, target required");
        List<String> t = target(req.rel());
        if (t == null) return badParams("rel must be one of " + TARGETS.keySet());
        if (!SAFE_ID.matcher(req.org_id()).matches()) return badParams("org_id contains illegal characters");
        if (!SAFE_READ_ID.matcher(req.target()).matches()) return badParams("target contains illegal characters");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        String rel = req.rel(), vertex = t.get(0), key = t.get(1);
        try {
            if (!hasOrganizationType()) return noSchema();
            boolean had = edgeExists(rel, "org_id", req.org_id(), key, req.target());
            Map<String, Object> base = new LinkedHashMap<>();
            base.put("ok", true);
            base.put("org_id", req.org_id());
            base.put("rel", rel);
            base.put("target", req.target());
            if (remove) {
                if (had) writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM (SELECT expand(outE('" + rel + "')) FROM KnowOrganization WHERE org_id=:id) WHERE @in." + key + " = :t",
                    Map.of("id", req.org_id(), "t", req.target()))).await().indefinitely();
                base.put("action", "removed");
                return unlinkOutcome(base, had);
            }
            // Отказ ДО записи: отсутствующий конец не оставляет полузаписи.
            if (!exists("KnowOrganization", "org_id", req.org_id())) return targetNotFound("организации " + req.org_id() + " нет");
            if (!exists(vertex, key, req.target())) return targetNotFound(vertex + " " + req.target() + " нет");
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> created = (List<Map<String, Object>>) writeClient.command(db, basicAuth(),
                new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE " + rel + " FROM (SELECT FROM KnowOrganization WHERE org_id = :id) "
                    + "TO (SELECT FROM " + vertex + " WHERE " + key + " = :t) IF NOT EXISTS",
                    Map.of("id", req.org_id(), "t", req.target()))).await().indefinitely().result();
            base.put("action", "added");
            return linkOutcome(had, base, created != null && !created.isEmpty(), rel, "org_id", req.org_id(), key, req.target(),
                "организация " + req.org_id() + " или " + vertex + " " + req.target());
        } catch (Exception e) {
            LOG.warnf("[LORE ORG LINK] %s %s %s: %s", req.org_id(), rel, req.target(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }

    /** Есть ли в схеме вершина организации. Сбой чтения летит наверх: «не смогли проверить» ≠ «нет». */
    boolean hasOrganizationType() {
        return !ingestService.queryPublic("SELECT name FROM schema:types WHERE name = 'KnowOrganization'", Map.of()).isEmpty();
    }

    private Response noSchema() {
        return noStore(Response.status(Response.Status.CONFLICT).entity(new LoreError("NO_ORGANIZATION_SCHEMA", NO_SCHEMA)));
    }
}
