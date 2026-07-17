package studio.seer.heimdall.lore;

import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * ADR-LORE-022 (ACCEPTED): продуктовый слой — KnowFeature ⊃ KnowUseCase.
 * Vertex-only (без Hist, как KnowDecision/KnowQuestion). Статус Feature
 * «фича целиком» — ВЫЧИСЛЯЕМЫЙ факт (D4: shipped ⇔ все UC shipped), поэтому
 * запись не принимает status='shipped' на фиче — его выводит слайс.
 * Все link-пути с linked-валидацией: CREATE EDGE в пустой FROM/TO — тихий
 * no-op (правило корпуса), мост честно отдаёт linked:false + hint.
 */
@Path("/lore")
public class LoreProductResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreProductResource.class);

    private static final List<String> PRODUCT_STATUSES = List.of("proposed", "active", "shipped", "dropped");

    @Inject
    @RestClient
    LoreCommandClient writeClient;

    @Inject
    LoreIngestService ingest;

    // ── Feature ──────────────────────────────────────────────────────────────

    public record FeatureRequest(String feature_id, String title, String body_md,
                                 String context_md, String status, String component_id) {}

    @POST
    @Path("feature")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertFeature(FeatureRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.feature_id() == null || req.feature_id().isBlank())
            return badParams("feature_id required");
        if (!SAFE_ID.matcher(req.feature_id()).matches())
            return badParams("feature_id contains illegal characters");
        if (req.status() != null && !PRODUCT_STATUSES.contains(req.status()))
            return badParams("status must be one of: " + PRODUCT_STATUSES);
        // D4: shipped у фичи не назначается рукой — он выводится из UC.
        if ("shipped".equals(req.status()))
            return badParams("feature 'shipped' is computed from its UCs (D4), not set directly");
        try {
            StringBuilder sql = new StringBuilder("UPDATE KnowFeature SET feature_id=:id");
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("id", req.feature_id());
            if (req.title() != null)        { sql.append(", title=:t");        p.put("t", req.title()); }
            if (req.body_md() != null)      { sql.append(", body_md=:b");      p.put("b", req.body_md()); }
            if (req.context_md() != null)   { sql.append(", context_md=:cx");  p.put("cx", req.context_md()); } // D13
            if (req.status() != null)       { sql.append(", status=:s");       p.put("s", req.status()); }
            if (req.component_id() != null) { sql.append(", component_id=:c"); p.put("c", req.component_id()); }
            sql.append(", date_created = ifnull(date_created, :d)");
            p.put("d", LocalDate.now().toString());
            sql.append(" UPSERT WHERE feature_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql.toString(), p))
                .await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "feature_id", req.feature_id())));
        } catch (Exception e) {
            LOG.warnf("[LORE FEATURE] %s: %s", req.feature_id(), e.getMessage());
            return upstream(e);
        }
    }

    // ── UseCase ──────────────────────────────────────────────────────────────

    // actor-строки нет (D12): акторы — вершины KnowActor, связь HAS_ACTOR через uc/link.
    public record UcRequest(String uc_id, String title, String scenario_md,
                            String acceptance_md, String status, String feature_id) {}

    @POST
    @Path("uc")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertUc(UcRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.uc_id() == null || req.uc_id().isBlank())
            return badParams("uc_id required");
        if (!SAFE_ID.matcher(req.uc_id()).matches())
            return badParams("uc_id contains illegal characters");
        if (req.status() != null && !PRODUCT_STATUSES.contains(req.status()))
            return badParams("status must be one of: " + PRODUCT_STATUSES);
        try {
            StringBuilder sql = new StringBuilder("UPDATE KnowUseCase SET uc_id=:id");
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("id", req.uc_id());
            if (req.title() != null)         { sql.append(", title=:t");          p.put("t", req.title()); }
            if (req.scenario_md() != null)   { sql.append(", scenario_md=:sc");   p.put("sc", req.scenario_md()); }
            if (req.acceptance_md() != null) { sql.append(", acceptance_md=:ac"); p.put("ac", req.acceptance_md()); }
            if (req.status() != null)        { sql.append(", status=:s");         p.put("s", req.status()); }
            if (req.feature_id() != null)    { sql.append(", feature_id=:f");     p.put("f", req.feature_id()); }
            sql.append(", date_created = ifnull(date_created, :d)");
            p.put("d", LocalDate.now().toString());
            sql.append(" UPSERT WHERE uc_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql.toString(), p))
                .await().indefinitely();

            // feature_id — поле-родитель; ребро DECOMPOSES_INTO держим в синхроне
            // (класс багов «поле есть — ребра нет», relinkParentEdge/SpecComponentEdge).
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("uc_id", req.uc_id());
            if (req.feature_id() != null && !req.feature_id().isBlank()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM (SELECT expand(inE('DECOMPOSES_INTO')) FROM KnowUseCase WHERE uc_id=:id)",
                    Map.of("id", req.uc_id()))).await().indefinitely();
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> created = (List<Map<String, Object>>)
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "CREATE EDGE DECOMPOSES_INTO " +
                        "FROM (SELECT FROM KnowFeature WHERE feature_id=:f) " +
                        "TO   (SELECT FROM KnowUseCase WHERE uc_id=:id) IF NOT EXISTS",
                        Map.of("f", req.feature_id(), "id", req.uc_id())))
                    .await().indefinitely().result();
                boolean linked = created != null && !created.isEmpty();
                out.put("feature_linked", linked);
                if (!linked) out.put("hint", "фича «" + req.feature_id() + "» не найдена — создайте её через /lore/feature");
            }
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE UC] %s: %s", req.uc_id(), e.getMessage());
            return upstream(e);
        }
    }

    // ── Actor (D12): проектируемая роль приложения ───────────────────────────

    public record ActorRequest(String actor_id, String name, String kind, String body_md) {}

    @POST
    @Path("actor")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertActor(ActorRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.actor_id() == null || req.actor_id().isBlank())
            return badParams("actor_id required");
        if (!SAFE_ID.matcher(req.actor_id()).matches())
            return badParams("actor_id contains illegal characters");
        if (req.kind() != null && !List.of("human-role", "system", "agent").contains(req.kind()))
            return badParams("kind must be human-role|system|agent");
        try {
            StringBuilder sql = new StringBuilder("UPDATE KnowActor SET actor_id=:id");
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("id", req.actor_id());
            if (req.name() != null)    { sql.append(", name=:n");    p.put("n", req.name()); }
            if (req.kind() != null)    { sql.append(", kind=:k");    p.put("k", req.kind()); }
            if (req.body_md() != null) { sql.append(", body_md=:b"); p.put("b", req.body_md()); }
            sql.append(" UPSERT WHERE actor_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql.toString(), p))
                .await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "actor_id", req.actor_id())));
        } catch (Exception e) {
            LOG.warnf("[LORE ACTOR] %s: %s", req.actor_id(), e.getMessage());
            return upstream(e);
        }
    }

    // ── UC links: REALIZES (task→uc) и TRACED_TO (uc→adr|decision) ──────────

    public record UcLinkRequest(String uc_id, String rel, String target_id, String action) {}

    @POST
    @Path("uc/link")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkUc(UcLinkRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.uc_id() == null || req.uc_id().isBlank()
                || req.rel() == null || req.target_id() == null || req.target_id().isBlank())
            return badParams("uc_id, rel (task|adr|decision|actor|includes|extends), target_id required");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            String edge, fromSql, toSql;
            Map<String, Object> p = Map.of("uid", req.uc_id(), "tid", req.target_id());
            switch (req.rel()) {
                case "task" -> { // REALIZES: KnowTask -> KnowUseCase (target = task_uid)
                    edge = "REALIZES";
                    fromSql = "(SELECT FROM KnowTask WHERE task_uid=:tid)";
                    toSql   = "(SELECT FROM KnowUseCase WHERE uc_id=:uid)";
                }
                case "adr" -> { // TRACED_TO: KnowUseCase -> KnowADR (опционально, D9)
                    edge = "TRACED_TO";
                    fromSql = "(SELECT FROM KnowUseCase WHERE uc_id=:uid)";
                    toSql   = "(SELECT FROM KnowADR WHERE adr_id=:tid)";
                }
                case "decision" -> {
                    edge = "TRACED_TO";
                    fromSql = "(SELECT FROM KnowUseCase WHERE uc_id=:uid)";
                    toSql   = "(SELECT FROM KnowDecision WHERE decision_id=:tid)";
                }
                case "actor" -> { // D12: HAS_ACTOR — multi, UC -> KnowActor
                    edge = "HAS_ACTOR";
                    fromSql = "(SELECT FROM KnowUseCase WHERE uc_id=:uid)";
                    toSql   = "(SELECT FROM KnowActor WHERE actor_id=:tid)";
                }
                case "includes" -> { // D13: UC_INCLUDES — обязательный под-сценарий
                    edge = "UC_INCLUDES";
                    fromSql = "(SELECT FROM KnowUseCase WHERE uc_id=:uid)";
                    toSql   = "(SELECT FROM KnowUseCase WHERE uc_id=:tid)";
                }
                case "extends" -> { // D13: UC_EXTENDS — вариант-расширение
                    edge = "UC_EXTENDS";
                    fromSql = "(SELECT FROM KnowUseCase WHERE uc_id=:uid)";
                    toSql   = "(SELECT FROM KnowUseCase WHERE uc_id=:tid)";
                }
                default -> { return badParams("rel must be task|adr|decision|actor|includes|extends"); }
            }
            if (remove) {
                boolean fromUc = !"task".equals(req.rel());
                String delSql = fromUc
                    ? "DELETE FROM (SELECT expand(outE('" + edge + "')) FROM KnowUseCase WHERE uc_id=:uid) " +
                      "WHERE @in.adr_id=:tid OR @in.decision_id=:tid OR @in.actor_id=:tid OR @in.uc_id=:tid"
                    : "DELETE FROM (SELECT expand(inE('" + edge + "')) FROM KnowUseCase WHERE uc_id=:uid) WHERE @out.task_uid=:tid";
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", delSql, p))
                    .await().indefinitely();
                return noStore(Response.ok(Map.of("ok", true, "uc_id", req.uc_id(),
                    "rel", req.rel(), "target_id", req.target_id(), "action", "removed")));
            }
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> created = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE " + edge + " FROM " + fromSql + " TO " + toSql + " IF NOT EXISTS", p))
                .await().indefinitely().result();
            boolean linked = created != null && !created.isEmpty();
            return noStore(Response.ok(Map.of("ok", true, "uc_id", req.uc_id(),
                "rel", req.rel(), "target_id", req.target_id(), "action", "added", "linked", linked,
                "hint", linked ? "" : "no edge created — проверьте, что uc_id и target существуют")));
        } catch (Exception e) {
            LOG.warnf("[LORE UC LINK] %s: %s", req.uc_id(), e.getMessage());
            return upstream(e);
        }
    }

    private Response upstream(Exception e) {
        return noStore(Response.status(Response.Status.BAD_GATEWAY)
            .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
    }
}
