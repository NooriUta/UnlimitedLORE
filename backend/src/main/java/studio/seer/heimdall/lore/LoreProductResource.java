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

    /** Шкала целей Коберна — одна на весь слой (ADR-LORE-032 §1): фичи живут на
     *  cloud/kite, UC — на sea-level/subfunction. Канон, словарь uc_goal_level. */
    static final List<String> UC_GOAL_LEVELS = List.of("cloud", "kite", "sea-level", "subfunction");

    /** Два веса оформления по Коберну (ADR-LORE-027-D1), словарь uc_rigor. */
    static final List<String> UC_RIGORS = List.of("casual", "fully-dressed");

    /**
     * Дефолтный вес из уровня цели (ADR-027-D1): обзорные и пользовательские цели
     * пишутся полно, подфункции — легко. Автор вправе переопределить — поэтому это
     * дефолт, а не правило: явный rigor в запросе всегда сильнее.
     */
    static String defaultRigor(String goalLevel) {
        return "subfunction".equals(goalLevel) ? "casual" : "fully-dressed";
    }

    @Inject
    @RestClient
    LoreCommandClient writeClient;

    @Inject
    LoreIngestService ingest;

    // ── Feature ──────────────────────────────────────────────────────────────

    public record FeatureRequest(String feature_id, String title, String body_md,
                                 String context_md, String status, String component_id,
                                 String goal_level) {}

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
        // ADR-032 §1: фича — UC уровня стратегии, поэтому живёт на ВЕРХНИХ ступенях
        // той же шкалы Коберна; sea-level/subfunction — высота сценария, не фичи.
        if (req.goal_level() != null && !List.of("cloud", "kite").contains(req.goal_level()))
            return badParams("feature goal_level must be cloud|kite (☁ стратегия / 🪁 обзор); "
                + "sea-level и subfunction — уровни UC, не фичи (ADR-LORE-032 §1)");
        try {
            StringBuilder sql = new StringBuilder("UPDATE KnowFeature SET feature_id=:id");
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("id", req.feature_id());
            if (req.title() != null)        { sql.append(", title=:t");        p.put("t", req.title()); }
            if (req.body_md() != null)      { sql.append(", body_md=:b");      p.put("b", req.body_md()); }
            if (req.context_md() != null)   { sql.append(", context_md=:cx");  p.put("cx", req.context_md()); } // D13
            if (req.status() != null)       { sql.append(", status=:s");       p.put("s", req.status()); }
            if (req.component_id() != null) { sql.append(", component_id=:c"); p.put("c", req.component_id()); }
            if (req.goal_level() != null)   { sql.append(", goal_level=:gl");  p.put("gl", req.goal_level()); }
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
                            String acceptance_md, String status, String feature_id,
                            String goal_level, String rigor, String priority) {}

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
        // ADR-027 §2: классификация Коберна — канон словарей, свободных значений нет.
        if (req.goal_level() != null && !UC_GOAL_LEVELS.contains(req.goal_level()))
            return badParams("goal_level must be one of: " + UC_GOAL_LEVELS
                + " (☁ cloud/🪁 kite — уровень фичи, 🌊 sea-level/🐟 subfunction — уровень UC)");
        if (req.rigor() != null && !UC_RIGORS.contains(req.rigor()))
            return badParams("rigor must be one of: " + UC_RIGORS);
        try {
            StringBuilder sql = new StringBuilder("UPDATE KnowUseCase SET uc_id=:id");
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("id", req.uc_id());
            if (req.title() != null)         { sql.append(", title=:t");          p.put("t", req.title()); }
            if (req.scenario_md() != null)   { sql.append(", scenario_md=:sc");   p.put("sc", req.scenario_md()); }
            if (req.acceptance_md() != null) { sql.append(", acceptance_md=:ac"); p.put("ac", req.acceptance_md()); }
            if (req.status() != null)        { sql.append(", status=:s");         p.put("s", req.status()); }
            if (req.feature_id() != null)    { sql.append(", feature_id=:f");     p.put("f", req.feature_id()); }
            if (req.priority() != null)      { sql.append(", priority=:pr");      p.put("pr", req.priority()); }
            // Уровень цели задан — вес по умолчанию выводится из него (ADR-027-D1),
            // но явный rigor автора сильнее вычисленного дефолта.
            String goal = req.goal_level();
            if (goal != null) { sql.append(", goal_level=:gl"); p.put("gl", goal); }
            String rigor = req.rigor() != null ? req.rigor() : (goal != null ? defaultRigor(goal) : null);
            if (rigor != null) { sql.append(", rigor=:rg"); p.put("rg", rigor); }
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

    // ── Pain / Gain (ADR-LORE-032 §2, D5) ────────────────────────────────────
    // Боли и выгоды — ВЕРШИНЫ, а не проза в context_md: только тогда fit VP-канвы
    // считается рёбрами, боль переиспользуется несколькими фичами, и видно «самую
    // горячую боль» + дубль усилий. Проектные — как акторы (D18).

    public record PainRequest(String pain_id, String title, String body_md, String severity) {}

    @POST
    @Path("pain")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertPain(PainRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.pain_id() == null || req.pain_id().isBlank())
            return badParams("pain_id required");
        if (!SAFE_ID.matcher(req.pain_id()).matches())
            return badParams("pain_id contains illegal characters");
        if (req.severity() != null && !List.of("high", "normal", "low").contains(req.severity()))
            return badParams("severity must be high|normal|low");
        try {
            StringBuilder sql = new StringBuilder("UPDATE KnowPain SET pain_id=:id");
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("id", req.pain_id());
            if (req.title() != null)    { sql.append(", title=:t");    p.put("t", req.title()); }
            if (req.body_md() != null)  { sql.append(", body_md=:b");  p.put("b", req.body_md()); }
            if (req.severity() != null) { sql.append(", severity=:s"); p.put("s", req.severity()); }
            sql.append(", date_created = ifnull(date_created, :d)");
            p.put("d", LocalDate.now().toString());
            sql.append(" UPSERT WHERE pain_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql.toString(), p))
                .await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "pain_id", req.pain_id())));
        } catch (Exception e) {
            LOG.warnf("[LORE PAIN] %s: %s", req.pain_id(), e.getMessage());
            return upstream(e);
        }
    }

    public record GainRequest(String gain_id, String title, String body_md, String metric_md) {}

    @POST
    @Path("gain")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertGain(GainRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.gain_id() == null || req.gain_id().isBlank())
            return badParams("gain_id required");
        if (!SAFE_ID.matcher(req.gain_id()).matches())
            return badParams("gain_id contains illegal characters");
        try {
            StringBuilder sql = new StringBuilder("UPDATE KnowGain SET gain_id=:id");
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("id", req.gain_id());
            if (req.title() != null)     { sql.append(", title=:t");     p.put("t", req.title()); }
            if (req.body_md() != null)   { sql.append(", body_md=:b");   p.put("b", req.body_md()); }
            if (req.metric_md() != null) { sql.append(", metric_md=:m"); p.put("m", req.metric_md()); }
            sql.append(", date_created = ifnull(date_created, :d)");
            p.put("d", LocalDate.now().toString());
            sql.append(" UPSERT WHERE gain_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql.toString(), p))
                .await().indefinitely();
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("gain_id", req.gain_id());
            // metric_md — не required на записи (выгоду формулируют раньше, чем метрику),
            // но БЕЗ него выгода никогда не будет замкнута в fit (ADR-032 §2): говорим сразу.
            if (req.metric_md() == null || req.metric_md().isBlank())
                out.put("hint", "metric_md пуст — выгода не будет засчитана в fit VP-канвы, пока не появится метрика");
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE GAIN] %s: %s", req.gain_id(), e.getMessage());
            return upstream(e);
        }
    }

    // ── Feature links: VP-профиль (pain/gain), стратегическая цель, компонент ──

    public record FeatureLinkRequest(String feature_id, String rel, String target_id, String action) {}

    @POST
    @Path("feature/link")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkFeature(FeatureLinkRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.feature_id() == null || req.feature_id().isBlank()
                || req.rel() == null || req.target_id() == null || req.target_id().isBlank())
            return badParams("feature_id, rel (pain|gain|milestone|component), target_id required");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            String edge, toSql;
            Map<String, Object> p = Map.of("fid", req.feature_id(), "tid", req.target_id());
            switch (req.rel()) {
                case "pain" -> { // фича ЗАЯВЛЯЕТ, что адресует боль; снимает её — UC (RELIEVES)
                    edge = "ADDRESSES";
                    toSql = "(SELECT FROM KnowPain WHERE pain_id=:tid)";
                }
                case "gain" -> { // фича ОБЕЩАЕТ выгоду; создаёт её — UC (DELIVERS)
                    edge = "PROMISES";
                    toSql = "(SELECT FROM KnowGain WHERE gain_id=:tid)";
                }
                case "milestone" -> { // ADR-032 §1: стратегическая цель (KAOS: веха = goal)
                    edge = "TARGETS_MILESTONE";
                    toSql = "(SELECT FROM KnowMilestone WHERE milestone_id=:tid)";
                }
                case "component" -> {
                    edge = "BELONGS_TO";
                    toSql = "(SELECT FROM LoreComponent WHERE component_id=:tid)";
                }
                default -> { return badParams("rel must be pain|gain|milestone|component"); }
            }
            if (remove) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM (SELECT expand(outE('" + edge + "')) FROM KnowFeature WHERE feature_id=:fid) " +
                    "WHERE @in.pain_id=:tid OR @in.gain_id=:tid OR @in.milestone_id=:tid OR @in.component_id=:tid", p))
                    .await().indefinitely();
                return noStore(Response.ok(Map.of("ok", true, "feature_id", req.feature_id(),
                    "rel", req.rel(), "target_id", req.target_id(), "action", "removed")));
            }
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> created = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE " + edge + " FROM (SELECT FROM KnowFeature WHERE feature_id=:fid) " +
                    "TO " + toSql + " IF NOT EXISTS", p))
                .await().indefinitely().result();
            boolean linked = created != null && !created.isEmpty();
            return noStore(Response.ok(Map.of("ok", true, "feature_id", req.feature_id(),
                "rel", req.rel(), "target_id", req.target_id(), "action", "added", "linked", linked,
                "hint", linked ? "" : "no edge created — проверьте, что фича и target существуют")));
        } catch (Exception e) {
            LOG.warnf("[LORE FEATURE LINK] %s: %s", req.feature_id(), e.getMessage());
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
                case "relieves" -> { // ADR-032 D5: pain reliever — UC снимает боль
                    edge = "RELIEVES";
                    fromSql = "(SELECT FROM KnowUseCase WHERE uc_id=:uid)";
                    toSql   = "(SELECT FROM KnowPain WHERE pain_id=:tid)";
                }
                case "delivers" -> { // ADR-032 D5: gain creator — UC создаёт выгоду
                    edge = "DELIVERS";
                    fromSql = "(SELECT FROM KnowUseCase WHERE uc_id=:uid)";
                    toSql   = "(SELECT FROM KnowGain WHERE gain_id=:tid)";
                }
                default -> { return badParams("rel must be task|adr|decision|actor|includes|extends|relieves|delivers"); }
            }
            if (remove) {
                boolean fromUc = !"task".equals(req.rel());
                String delSql = fromUc
                    ? "DELETE FROM (SELECT expand(outE('" + edge + "')) FROM KnowUseCase WHERE uc_id=:uid) " +
                      "WHERE @in.adr_id=:tid OR @in.decision_id=:tid OR @in.actor_id=:tid OR @in.uc_id=:tid " +
                      "OR @in.pain_id=:tid OR @in.gain_id=:tid"
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
