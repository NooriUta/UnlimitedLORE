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
 * LoreComponent write endpoints (update, create, link-parent), split out of
 * AidaLoreResource (B2). Shares infra via LoreResourceBase.
 */
@Path("/lore")
public class LoreComponentResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreComponentResource.class);

    public record ComponentUpdateRequest(
        String component_id,
        String owner, String team,
        String full_name, String area, String game_icon, String parent_id
    ) {}

    @POST
    @Path("component/update")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response updateComponent(ComponentUpdateRequest req,
                                    @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.component_id() == null || req.component_id().isBlank())
            return badParams("component_id required");
        try {
            // LH-44: the MCP tool contract explicitly promises "partial update — only
            // supplied fields written"; previously ALL six fields were SET unconditionally,
            // so an owner-only call wiped team/full_name/area/game_icon/parent_id.
            StringBuilder csql = new StringBuilder("UPDATE LoreComponent SET component_id=:cid");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("cid", req.component_id());
            if (req.owner() != null)     { csql.append(", owner=:owner");         p.put("owner",     req.owner()); }
            if (req.team() != null)      { csql.append(", team=:team");           p.put("team",      req.team()); }
            if (req.full_name() != null) { csql.append(", full_name=:full_name"); p.put("full_name", req.full_name()); }
            if (req.area() != null)      { csql.append(", area=:area");           p.put("area",      req.area()); }
            if (req.game_icon() != null) { csql.append(", game_icon=:game_icon"); p.put("game_icon", req.game_icon()); }
            if (req.parent_id() != null) { csql.append(", parent_id=:parent_id"); p.put("parent_id", req.parent_id()); }
            csql.append(" WHERE component_id=:cid");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                csql.toString(), p)).await().indefinitely();
            // ADR-LORE-012 level B: keep the IN_AREA edge in sync with the string.
            if (req.area() != null) relinkAreaEdge(req.component_id(), req.area());
            // T01: keep the PARENT_OF edge in sync with the parent_id field (the
            // tree UI reads the edge, not the field) — create/link-parent already do.
            if (req.parent_id() != null) relinkParentEdge(req.component_id(), req.parent_id());
            return noStore(Response.ok(Map.of("ok", true, "component_id", req.component_id())));
        } catch (Exception e) {
            LOG.warnf("[LORE COMPONENT UPDATE] %s: %s", req.component_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    public record ComponentCreateRequest(
        String component_id,
        String full_name, String area, String team,
        String game_icon, String owner, String parent_id
    ) {}

    @POST
    @Path("component/create")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response createComponent(ComponentCreateRequest req,
                                    @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.component_id() == null || req.component_id().isBlank())
            return badParams("component_id required");
        if (!SAFE_ID.matcher(req.component_id()).matches())
            return badParams("component_id contains illegal characters");
        try {
            // LH-44: dynamic SET — re-calling create on an existing component must not
            // wipe unspecified fields nor reset children/tech arrays (initialised below
            // only where still missing, i.e. genuinely new vertices).
            StringBuilder csql = new StringBuilder("UPDATE LoreComponent SET component_id=:cid");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("cid", req.component_id());
            if (req.full_name() != null) { csql.append(", full_name=:full_name"); p.put("full_name", req.full_name()); }
            if (req.area() != null)      { csql.append(", area=:area");           p.put("area",      req.area()); }
            if (req.team() != null)      { csql.append(", team=:team");           p.put("team",      req.team()); }
            if (req.game_icon() != null) { csql.append(", game_icon=:game_icon"); p.put("game_icon", req.game_icon()); }
            if (req.owner() != null)     { csql.append(", owner=:owner");         p.put("owner",     req.owner()); }
            if (req.parent_id() != null) { csql.append(", parent_id=:parent_id"); p.put("parent_id", req.parent_id()); }
            csql.append(" UPSERT WHERE component_id=:cid");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                csql.toString(), p)).await().indefinitely();
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE LoreComponent SET children=[] WHERE component_id=:cid AND children IS NULL",
                Map.of("cid", req.component_id()))).await().indefinitely();
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE LoreComponent SET tech=[] WHERE component_id=:cid AND tech IS NULL",
                Map.of("cid", req.component_id()))).await().indefinitely();
            if (req.parent_id() != null && !req.parent_id().isBlank()) {
                Map<String, Object> ep = Map.of("cid", req.component_id(), "pid", req.parent_id());
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    String.format(
                    "CREATE EDGE PARENT_OF FROM (SELECT FROM LoreComponent WHERE component_id='%s') " +
                    "TO (SELECT FROM LoreComponent WHERE component_id='%s')",
                    req.component_id(), req.parent_id()),
                    Map.of())).await().indefinitely();
            }
            // ADR-LORE-012 level B: keep the IN_AREA edge in sync with the string.
            if (req.area() != null) relinkAreaEdge(req.component_id(), req.area());
            return noStore(Response.ok(Map.of("ok", true, "component_id", req.component_id())));
        } catch (Exception e) {
            LOG.warnf("[LORE COMPONENT CREATE] %s: %s", req.component_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    public record ComponentDeleteRequest(String component_id) {}

    /**
     * component_del — единственный из `_del`-инструментов LORE с гейтом
     * ссылок, а не безусловным удалением.
     *
     * <p>{@code adr_del}/{@code doc_del} удаляют без проверки — их контракт
     * прямо документирует это как «для тестовых артефактов и ошибочных
     * созданий». Компонент — другое: узел дерева, на который может ссылаться
     * что угодно (задачи, ADR, спринты, вопросы, QG), и повреждённая ссылка
     * не бросается в глаза сразу — обнаруживается позже, косвенно, как
     * висячий `component_id` без объяснения. Поэтому здесь удаление вершины
     * возможно ТОЛЬКО когда все проверенные пути ссылок дают ноль; иначе —
     * 409 со списком конкретных находок, а не общий отказ.
     *
     * <p>Проверяются: дети (по `parent_id`, зеркалит `PARENT_OF`), входящие
     * `BELONGS_TO` БЕЗ фильтра по типу источника (ADR/спек/спринт — уже под
     * `adr_count`/`spec_count`/`sprint_count` в срезе `components`, но эти
     * счётчики смотрят не на все типы — например `KnowUseCase`/`KnowDecision`
     * туда не входят), исходящий `DOCUMENTED_IN` (спеки), и плоское строковое
     * поле `component_id` у шести типов, что ещё не переведены на рёбра
     * (`KnowTask`, `KnowQuestion`, `QualityGate`, `QGJobTask`,
     * `QGRecommendation`, `KnowDecision` — `KnowUseCase`/`KnowFeature` уже
     * мигрировали на `BELONGS_TO` по PL-10, у них проверка ловится через
     * `BELONGS_TO` выше, а не отдельным полем).
     */
    @POST
    @Path("component/delete")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response deleteComponent(ComponentDeleteRequest req,
                                    @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.component_id() == null || req.component_id().isBlank())
            return badParams("component_id required");
        String cid = req.component_id();
        try {
            Map<String, Object> p = Map.of("cid", cid);
            java.util.LinkedHashMap<String, Long> blockers = new java.util.LinkedHashMap<>();
            putIfPositive(blockers, "children",           countN("SELECT count(*) AS n FROM LoreComponent WHERE parent_id=:cid", p));
            putIfPositive(blockers, "belongs_to_edges",    countN("SELECT count(*) AS n FROM (SELECT expand(in('BELONGS_TO')) FROM LoreComponent WHERE component_id=:cid)", p));
            putIfPositive(blockers, "documented_specs",    countN("SELECT count(*) AS n FROM (SELECT expand(out('DOCUMENTED_IN')) FROM LoreComponent WHERE component_id=:cid)", p));
            // Задача ссылается на компонент ДВУМЯ путями одновременно: обычное
            // создание (/lore/task, task/component) кладёт TAGGED_WITH-ребро, а
            // промоушен QG-рекомендации (LoreQgResource) пишет плоское поле
            // KnowTask.component_id напрямую, в обход ребра. Проверка только
            // поля находила бы 0 всегда для первого пути — тот самый молчаливый
            // ноль вместо честного отказа, от которого предостерегает FEAT-LORE-HONEST.
            putIfPositive(blockers, "tasks", countN(
                "SELECT count(*) AS n FROM (" +
                "SELECT expand(in('TAGGED_WITH')) FROM LoreComponent WHERE component_id=:cid" +
                ") WHERE @class = 'KnowTask'", p)
                + countN("SELECT count(*) AS n FROM KnowTask WHERE component_id=:cid", p));
            putIfPositive(blockers, "questions",           countN("SELECT count(*) AS n FROM KnowQuestion WHERE component_id=:cid", p));
            putIfPositive(blockers, "quality_gates",       countN("SELECT count(*) AS n FROM QualityGate WHERE component_id=:cid", p));
            // QGJobTask НЕ несёт component_id ни в одном пути записи (проверено:
            // ни одна из ~9 CREATE PROPERTY QGJobTask.* в LoreSchemaInitializer, ни
            // resolveJob в LoreQgResource его не пишут) — родительский QualityGate
            // уже покрыт строкой выше. Проверка поля, которого нет в схеме, всегда
            // 0 и не блокирует НИКОГДА — вычеркнута, а не оставлена мёртвым чеком.
            putIfPositive(blockers, "qg_recommendations",  countN("SELECT count(*) AS n FROM QGRecommendation WHERE component_id=:cid", p));
            putIfPositive(blockers, "decisions",           countN("SELECT count(*) AS n FROM KnowDecision WHERE component_id=:cid", p));

            if (!blockers.isEmpty()) {
                LOG.infof("[LORE COMPONENT DELETE] %s отклонён — ссылки: %s", cid, blockers);
                return noStore(Response.status(Response.Status.CONFLICT)
                    .entity(new LoreError("COMPONENT_REFERENCED",
                        "компонент используется, удаление отклонено: " + blockers)));
            }

            // Дошли сюда — ссылок нет, вершину можно снести. Рёбра сначала
            // (ArcadeDB: DELETE VERTEX не поддерживается) — иначе после
            // DELETE FROM вершины останутся висячие outE/inE без хозяина.
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "DELETE FROM (SELECT expand(bothE()) FROM LoreComponent WHERE component_id=:id)",
                Map.of("id", cid))).await().indefinitely();
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "DELETE FROM LoreComponent WHERE component_id=:id",
                Map.of("id", cid))).await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "component_id", cid)));
        } catch (Exception e) {
            LOG.warnf("[LORE COMPONENT DELETE] %s: %s", cid, e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    private long countN(String sql, Map<String, Object> params) {
        List<Map<String, Object>> rows = ingestService.queryPublic(sql, params);
        if (rows.isEmpty()) return 0;
        Object n = rows.get(0).get("n");
        return n instanceof Number num ? num.longValue() : 0;
    }

    private static void putIfPositive(Map<String, Long> m, String key, long n) {
        if (n > 0) m.put(key, n);
    }

    public record ComponentLinkParentRequest(String component_id, String parent_id) {}

    @POST
    @Path("component/link-parent")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkComponentParent(ComponentLinkParentRequest req,
                                        @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.component_id() == null || req.parent_id() == null)
            return badParams("component_id and parent_id required");
        try {
            Map<String, Object> p = Map.of("cid", req.component_id(), "pid", req.parent_id());
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE LoreComponent SET parent_id=:pid WHERE component_id=:cid", p))
                .await().indefinitely();
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                String.format(
                    "CREATE EDGE PARENT_OF FROM (SELECT FROM LoreComponent WHERE component_id='%s') " +
                    "TO (SELECT FROM LoreComponent WHERE component_id='%s')",
                    req.component_id(), req.parent_id()),
                Map.of())).await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "component_id", req.component_id(), "parent_id", req.parent_id())));
        } catch (Exception e) {
            LOG.warnf("[LORE COMPONENT LINK-PARENT] %s→%s: %s", req.component_id(), req.parent_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }
}
