package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;
import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;

/**
 * Forgejo-миниапп (ADR-LORE-060, SPRINT_FORGEJO_MINIAPP/FJ-02, FJ-03): операционный доступ агентов к Forgejo через
 * LORE вместо автономного forgejo-mcp. Тонкий ресурс над чистыми {@link ForgejoRoutes} (реестр) и
 * {@link ForgejoApp} (исполнитель):
 * <ul>
 *   <li>{@code POST /lore/forgejo-app/{route}} — тело: args JSON; ответ — конверт v=1 (SPEC-AGENT-SURFACE-061 §4)
 *       с HTTP-статусом его ошибки (404/403/428/400/409/501/апстрим) или 200;</li>
 *   <li>{@code GET /lore/forgejo-app/describe?route=|group=} — карточка маршрута (вид forgejo:* из реестра) или
 *       оглавление групп и имён, отфильтрованное по роли вызывающего.</li>
 * </ul>
 * Роль — профиль агента из токена (agent_scope; full может заявить младший профиль X-Lore-Act-As); человек
 * (admin) — full. Токен Forgejo — серверный секрет моста ({@code FORGEJO_API_TOKEN}), наружу не выходит; база —
 * primary-хост проекта {@code lore.forgejo-app.git-project} (наш Forgejo), owner/repo вызова — из args.
 */
@Path("/lore/forgejo-app")
public class LoreForgejoAppResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreForgejoAppResource.class);

    @Inject
    ForgejoBridge bridge;

    /** Проект, чей primary-хост — «наш Forgejo»: база всех вызовов миниаппа. */
    @ConfigProperty(name = "lore.forgejo-app.git-project", defaultValue = "NooriUta/UnlimitedLORE")
    String gitProject;

    /** Роль вызова или отказ (человек без admin — исключение 403 из requireAdmin). */
    record Caller(String role, String refusal) {}

    Caller caller(String seerRole, String actAs) {
        String scope = identity == null || identity.isAnonymous() ? null : AgentScopeFilter.agentScopeOf(identity);
        if (scope == null) {
            requireAdmin(seerRole);
            return new Caller("full", null);
        }
        AgentScopeFilter.Effective eff = AgentScopeFilter.effectiveScope(scope, actAs);
        return eff.refusal() != null ? new Caller(scope, eff.refusal()) : new Caller(eff.scope(), null);
    }

    @POST
    @Path("{route}")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response call(@PathParam("route") String route, String body,
                         @QueryParam("truncate") String truncate,
                         @HeaderParam("X-Seer-Role") String seerRole,
                         @HeaderParam(AgentScopeFilter.ACT_AS_HEADER) String actAs,
                         @HeaderParam(AgentScopeFilter.HUMAN_APPROVAL_HEADER) String approval) {
        if (!enabled) return disabled();
        // FJ-04: служебный маршрут QG-прогона read-группы — достижим и MCP-инструментом forgejo (route=qg_read)
        if (QG_READ.equals(route)) return qgRead(seerRole, actAs);
        ForgejoRoutes reg = ForgejoRoutes.load();
        Caller c = caller(seerRole, actAs);
        JsonObject args;
        try {
            args = body == null || body.isBlank() ? new JsonObject() : new JsonObject(body);
        } catch (RuntimeException e) {
            args = null;
        }
        String role = c.refusal() == null ? c.role() : null;   // отказ заявки профиля — нет роли, а не чужая роль
        ForgejoApp.Upstream up = upstream();
        ForgejoApp.Outcome o;
        if (args == null && reg.get(route) != null && reg.get(route).allows(role)) {
            o = new ForgejoApp.Outcome(400, envelopeError(route, 400, "BAD_PARAMS", "тело — не JSON-объект args"));
        } else {
            String ourBase = bridge.configured() ? bridge.resolve(gitProject).map(ForgejoBridge.Repo::apiBase).orElse(null) : null;
            o = ForgejoApp.execute(reg, route, args == null ? new JsonObject() : args, role,
                AgentScopeFilter.humanApproval(approval), !"false".equalsIgnoreCase(truncate), up,
                ourBase, ourBase == null ? null : (ForgejoApp.Projects) bridge::resolve,
                new ForgejoApp.Approvals(APPROVALS, sessionOwner(), System.currentTimeMillis()));
        }
        JsonObject env = o.envelope();
        JsonObject err = env.getJsonObject("error");
        JsonObject meta = env.getJsonObject("meta");
        // метрика вызова (SPEC-FORGEJO-APP-060 §11; журнал agent_actions — FJ-09)
        LOG.infof("[FORGEJO-APP] kind=%s role=%s outcome=%s code=%s truncated=%s took_ms=%s http=%d",
            env.getString("kind"), role, env.getString("outcome"), err == null ? "-" : err.getString("code"),
            meta.getValue("truncated") != null, meta.getValue("took_ms"), o.http());
        return noStore(Response.status(o.http()).entity(env.encode()).type(MediaType.APPLICATION_JSON));
    }

    /**
     * FJ-04: QG-прогон read-группы против нашего Forgejo (пробы {@link ForgejoReadProbes}). Только full: прогон
     * ходит во все read-маршруты токеном моста. Ответ — вердикт PASS / PARTIAL / FAIL и строка на пробу; запись
     * в qg_run_log делает вызывающий агент (MCP), бэкенд ничего не пишет.
     */
    // ── FJ-07: подтверждение рисковых операций — фактор LORE ─────────────

    /**
     * Гейт подтверждений — один на процесс (вызов живёт минуты; схема базы не меняется — заморозка схемы).
     * Перезапуск бэкенда сбрасывает незавершённые подтверждения: человек подтверждает заново.
     */
    static final ForgejoApproval APPROVALS = new ForgejoApproval();

    /** Владелец сессии: у агента — kc_sub владельца (KnowActor → OWNED_BY), у человека — его собственный kc_sub. */
    String sessionOwner() {
        String scope = identity == null || identity.isAnonymous() ? null : AgentScopeFilter.agentScopeOf(identity);
        if (scope == null) return callerKcSub();
        String client = callerClientId();
        if (client == null) return null;
        try {
            List<Map<String, Object>> rows = ingestService.queryPublic(
                "SELECT out('OWNED_BY').kc_sub AS owners FROM KnowActor WHERE kind = 'agent' AND client_id = :c",
                Map.of("c", client));
            if (rows.isEmpty() || !(rows.get(0).get("owners") instanceof List<?> l) || l.isEmpty()) return null;
            return String.valueOf(l.get(0));
        } catch (RuntimeException e) {
            LOG.warnf("[FORGEJO-APP] владелец сессии %s не прочитан: %s", client, e.getMessage());
            return null;
        }
    }

    /** Только человек: у агента нет «пальца» для фактора LORE — слово вводит сам человек под своей учёткой. */
    private Response humanOnly() {
        boolean agent = identity != null && !identity.isAnonymous() && AgentScopeFilter.agentScopeOf(identity) != null;
        if (!agent && callerKcSub() != null) return null;
        return noStore(Response.status(403).entity(new JsonObject().put("error", "HUMAN_ONLY")
            .put("detail", "слово-вызов вводит человек в LORE под своей учёткой, не агент").encode()).type(MediaType.APPLICATION_JSON));
    }

    /** Что подтверждается: маршрут, отпечаток, срок — экран подтверждения в LORE. */
    @GET
    @Path("approvals/{id}")
    @Produces(MediaType.APPLICATION_JSON)
    public Response approval(@PathParam("id") String id) {
        if (!enabled) return disabled();
        Response deny = humanOnly();
        if (deny != null) return deny;
        ForgejoApproval.Challenge c = APPROVALS.get(id);
        if (c == null)
            return noStore(Response.status(404).entity(new JsonObject().put("error", "NOT_FOUND")
                .put("detail", "подтверждение не найдено или бэкенд перезапущен — пусть агент повторит вызов").encode())
                .type(MediaType.APPLICATION_JSON));
        return noStore(Response.ok(new JsonObject().put("id", c.id()).put("route", c.route()).put("intent_hash", c.intentHash())
            .put("expires_at", c.expiresAt()).put("confirmed", c.confirmedBy() != null).put("used", c.used()).encode())
            .type(MediaType.APPLICATION_JSON));
    }

    /** Фактор LORE: человек вводит слово, которое ему назвал агент. Ответ: ok | wrong_word | expired | used | unknown. */
    @POST
    @Path("approvals/{id}/confirm")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response confirm(@PathParam("id") String id, String body) {
        if (!enabled) return disabled();
        Response deny = humanOnly();
        if (deny != null) return deny;
        String word;
        try {
            word = body == null || body.isBlank() ? null : new JsonObject(body).getString("word");
        } catch (RuntimeException e) {
            word = null;
        }
        String r = APPROVALS.confirm(id, word, callerKcSub(), System.currentTimeMillis());
        LOG.infof("[FORGEJO-APP] approval %s confirm by human → %s", id, r);
        int http = "ok".equals(r) ? 200 : "unknown".equals(r) ? 404 : 409;
        return noStore(Response.status(http).entity(new JsonObject().put("result", r).encode()).type(MediaType.APPLICATION_JSON));
    }

    /** Имя служебного маршрута QG-прогона для инструмента forgejo (в реестре маршрутов Forgejo его нет — это не REST Forgejo). */
    static final String QG_READ = "qg_read";

    @POST
    @Path("qg/read")
    @Produces(MediaType.APPLICATION_JSON)
    public Response qgRead(@HeaderParam("X-Seer-Role") String seerRole,
                           @HeaderParam(AgentScopeFilter.ACT_AS_HEADER) String actAs) {
        if (!enabled) return disabled();
        Caller c = caller(seerRole, actAs);
        if (c.refusal() != null || !"full".equals(c.role()))
            return noStore(Response.status(403).entity(new JsonObject().put("error", "FORBIDDEN_FOR_ROLE")
                .put("detail", "QG-прогон read-группы — только профиль full").put("allowed", new io.vertx.core.json.JsonArray().add("full"))
                .encode()).type(MediaType.APPLICATION_JSON));
        ForgejoReadProbes.Report rep = ForgejoReadProbes.run(ForgejoRoutes.load(), ForgejoReadProbes.load(), upstream());
        LOG.infof("[FORGEJO-APP] qg/read verdict=%s total=%d passed=%d failed=%d skipped=%d",
            rep.verdict(), rep.total(), rep.passed(), rep.failed(), rep.skipped());
        return noStore(Response.ok(rep.toJson().encode()).type(MediaType.APPLICATION_JSON));
    }

    /** Апстрим: мост не сконфигурирован или проект-база не резолвится — UPSTREAM_5XX 503 с причиной, без похода. */
    private ForgejoApp.Upstream upstream() {
        if (!bridge.configured())
            return (m, p, b) -> new ForgejoApp.Reply(503, JsonObject.of("message",
                "forgejo bridge not configured (" + ForgejoBridge.FORGEJO_TOKEN_KEY + " unset)").encode(), "application/json");
        Optional<ForgejoBridge.Repo> base = bridge.resolve(gitProject);
        if (base.isEmpty())
            return (m, p, b) -> new ForgejoApp.Reply(503, JsonObject.of("message",
                "проект-база миниаппа " + gitProject + " не резолвится в primary-хост (lore.forgejo-app.git-project)").encode(),
                "application/json");
        String apiBase = base.get().apiBase();
        return (m, p, b) -> bridge.appCall(apiBase, m, p, b);
    }

    private static JsonObject envelopeError(String route, int status, String code, String detail) {
        return new JsonObject().put("v", 1).put("kind", "forgejo:" + route).put("outcome", "failed").putNull("data")
            .put("meta", new JsonObject().put("took_ms", 0))
            .put("error", new JsonObject().put("code", code).put("status", status).put("detail", detail)
                .put("hint", "describe forgejo:" + route));
    }

    // ── describe ─────────────────────────────────────────────────────────

    @GET
    @Path("describe")
    @Produces(MediaType.APPLICATION_JSON)
    public Response describe(@QueryParam("route") String route, @QueryParam("group") String group,
                             @HeaderParam("X-Seer-Role") String seerRole,
                             @HeaderParam(AgentScopeFilter.ACT_AS_HEADER) String actAs) {
        if (!enabled) return disabled();
        ForgejoRoutes reg = ForgejoRoutes.load();
        String scope = identity == null || identity.isAnonymous() ? null : AgentScopeFilter.agentScopeOf(identity);
        String role = scope == null ? "full" : Optional.ofNullable(AgentScopeFilter.effectiveScope(scope, actAs).scope()).orElse(scope);
        return noStore(Response.ok(describeBody(reg, route, group, role).encode()).type(MediaType.APPLICATION_JSON));
    }

    /**
     * Тело describe — чистая функция: карточка маршрута (KnowDescribe над видом forgejo:* + метод, путь, группа, риск,
     * пример конверта) либо оглавление «группа → имена», только маршруты, разрешённые роли (allowlist).
     */
    static JsonObject describeBody(ForgejoRoutes reg, String route, String group, String role) {
        if (route != null && !route.isBlank()) {
            String name = route.startsWith("forgejo:") ? route.substring("forgejo:".length()) : route;
            ForgejoRoutes.Route r = reg.get(name);
            if (r == null)
                return new JsonObject().put("v", 1).put("kind", "forgejo:" + name).put("outcome", "failed").putNull("data")
                    .put("meta", new JsonObject())
                    .put("error", new JsonObject().put("code", "UNKNOWN_KIND").put("status", 404)
                        .put("allowed", new io.vertx.core.json.JsonArray(reg.candidates(name, 5)))
                        .put("hint", "forgejo_describe без route — оглавление"));
            Map<String, Object> card = new LinkedHashMap<>(KnowDescribe.describeFull(ForgejoRoutes.kind(r), null));
            card.put("method", r.method());
            card.put("path", r.pathTemplate());
            card.put("group", r.group());
            card.put("risk", r.risk());
            card.put("list", r.list());
            if (r.via() != null) card.put("via", r.via());
            if (r.capability() != null) card.put("capability", r.capability());
            if (r.note() != null) card.put("note", r.note());
            List<Map<String, Object>> params = new ArrayList<>();
            for (ForgejoRoutes.Param p : r.params().values()) params.add(p.toMap());
            card.put("params", params);
            if (!r.rules().isEmpty()) {
                List<Map<String, Object>> rules = new ArrayList<>();
                for (ForgejoRoutes.Rule x : r.rules()) {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("kind", x.kind());
                    m.put("param", x.param());
                    if (x.values() != null) m.put("values", x.values());
                    if (x.pattern() != null) m.put("pattern", x.pattern());
                    if (x.risk() != null) m.put("risk", x.risk());
                    if (x.roles() != null) m.put("roles", x.roles());
                    m.put("reason", x.reason());
                    rules.add(m);
                }
                card.put("rules", rules);
            }
            if (ForgejoApp.takesRepo(r))
                card.put(ForgejoApp.GIT_PROJECT, "вместо owner+repo можно дать git_project — слаг проекта LORE (например "
                    + "NooriUta/UnlimitedLORE); резолв только в наш Forgejo, что-то одно из двух");
            card.put("allowed_for_you", r.allows(role));
            card.put("envelope", "{v:1, kind, outcome: found|empty|failed, data, meta{took_ms" + (r.list() ? ", cursor, has_more" : "")
                + ", truncated}, error{code,status,allowed,hint}}");
            return new JsonObject().put("v", 1).put("kind", "forgejo:" + name).put("outcome", "found")
                .put("data", new JsonObject(card)).put("meta", new JsonObject()).putNull("error");
        }
        Map<String, List<String>> byGroup = new TreeMap<>();
        for (ForgejoRoutes.Route r : reg.visibleTo(role))
            if (group == null || group.isBlank() || group.equals(r.group()))
                byGroup.computeIfAbsent(r.group(), g -> new ArrayList<>()).add(r.name() + (r.via() != null ? " (via " + r.via() + ")" : ""));
        int total = byGroup.values().stream().mapToInt(List::size).sum();
        return new JsonObject().put("v", 1).put("kind", "forgejo:*").put("outcome", total == 0 ? "empty" : "found")
            .put("data", new JsonObject().put("role", role).put("groups", new JsonObject(new LinkedHashMap<>(byGroup)))
                .put("total", total).put("registry_total", reg.all().size())
                .put("qg", "full: forgejo route=qg_read — QG-прогон всех read-маршрутов против нашего Forgejo, вердикт PASS/PARTIAL/FAIL")
                .put("hint", "forgejo_describe route=<name> — карточка; forgejo route=<name> args={…} — вызов"))
            .put("meta", new JsonObject()).putNull("error");
    }
}
