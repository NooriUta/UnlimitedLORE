package studio.seer.heimdall.lore;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * KC-мост (ADR-LORE-025 D11, SPEC-RBAC-OMILORE-AGENTS): управление пользователями
 * и обзор агентных клиентов realm'а omilore ЧЕРЕЗ СЕРВЕР — секрет lore-admin
 * живёт в конфиге backend'а и наружу не отдаётся. Pluggable: без KC_ADMIN_CLIENT_SECRET
 * все эндпоинты отвечают 503 "kc integration not configured".
 * Все операции — ТОЛЬКО человеческий admin (D12): ни одна агентная роль сюда не проходит.
 * Пароли НИКОГДА не создаются/не принимаются здесь — пользователь получает их в KC.
 */
@Path("/lore/kc")
public class LoreKcResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreKcResource.class);

    /** Вся KC-обвязка (токен, вызовы, подсчёт админов) — в KcBridge: ей же пользуется
     * LoreAuthStartupGuard (AL-35), у guard'а и моста одно представление о «кто админ». */
    @jakarta.inject.Inject
    KcBridge bridge;

    @ConfigProperty(name = "quarkus.oidc.enabled", defaultValue = "false")
    boolean oidcEnabled;

    private boolean configured() { return bridge.configured(); }

    private Response notConfigured() {
        return noStore(Response.status(503)
            .entity(new LoreError("KC_NOT_CONFIGURED", "kc integration not configured (" + KcBridge.KC_SECRET_KEY + " unset)")));
    }

    private String adminToken() throws Exception { return bridge.adminToken(); }

    private HttpResponse<String> kc(String method, String path, String json, String token) throws Exception {
        return bridge.kc(method, path, json, token);
    }

    // ── Пользователи (люди, realm-роли) ─────────────────────────────────────

    @GET
    @Path("users")
    @Produces(MediaType.APPLICATION_JSON)
    public Response listUsers(@HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (!configured()) return notConfigured();
        try {
            String t = adminToken();
            HttpResponse<String> users = kc("GET", "/users?max=100", null, t);
            io.vertx.core.json.JsonArray arr = new io.vertx.core.json.JsonArray(users.body());
            io.vertx.core.json.JsonArray out = new io.vertx.core.json.JsonArray();
            for (int i = 0; i < arr.size(); i++) {
                io.vertx.core.json.JsonObject u = arr.getJsonObject(i);
                HttpResponse<String> rm = kc("GET", "/users/" + u.getString("id") + "/role-mappings/realm", null, t);
                io.vertx.core.json.JsonArray roles = rm.statusCode() == 200 ? new io.vertx.core.json.JsonArray(rm.body()) : new io.vertx.core.json.JsonArray();
                io.vertx.core.json.JsonArray names = new io.vertx.core.json.JsonArray();
                for (int j = 0; j < roles.size(); j++) names.add(roles.getJsonObject(j).getString("name"));
                out.add(io.vertx.core.json.JsonObject.of(
                    "id", u.getString("id"), "username", u.getString("username"),
                    "email", u.getString("email"), "enabled", u.getBoolean("enabled"),
                    "roles", names));
            }
            return noStore(Response.ok(out.encode()));
        } catch (Exception e) { return upstream(e); }
    }

    public record KcUserCreate(String username, String email) {}

    @POST
    @Path("user")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response createUser(KcUserCreate req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (!configured()) return notConfigured();
        if (req == null || req.username() == null || req.username().isBlank())
            return badParams("username required");
        try {
            String t = adminToken();
            // D11: без пароля — пользователь задаёт его в KC (reset-link/консоль).
            String body = io.vertx.core.json.JsonObject.of(
                "username", req.username(), "email", req.email(), "enabled", true).encode();
            HttpResponse<String> r = kc("POST", "/users", body, t);
            if (r.statusCode() >= 300)
                return noStore(Response.status(r.statusCode()).entity(new LoreError("KC_UPSTREAM", r.body())));
            return noStore(Response.ok(Map.of("ok", true, "username", req.username(),
                "note", "пароль задаётся в KC (reset-link/консоль), LORE пароли не хранит")));
        } catch (Exception e) { return upstream(e); }
    }

    public record KcRoleRequest(String role, String action) {}

    @POST
    @Path("user/{id}/role")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response setUserRole(@PathParam("id") String userId, KcRoleRequest req,
                                @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (!configured()) return notConfigured();
        if (req == null || req.role() == null) return badParams("role required");
        // D11: эскалация до super-admin — только вручную в KC, вне моста.
        if (!List.of("admin", "viewer").contains(req.role()))
            return badParams("role must be admin|viewer (super-admin is out of bridge scope by design)");
        try {
            String t = adminToken();
            boolean remove = "remove".equalsIgnoreCase(req.action());
            // AL-35: последняя администрирующая учётка неснимаема. Не «двухшаг», а отказ:
            // свойство «администратор существует» защищается бэкендом, не интерфейсом.
            if (remove && KcBridge.isLastAdminRemoval(bridge.enabledAdminHolders(t), userId, req.role())) {
                return noStore(Response.status(Response.Status.CONFLICT)
                    .entity(new LoreError("LAST_ADMIN",
                        "это последняя включённая учётка с ролью admin/super-admin — снятие роли оставит LORE "
                        + "без администратора. Сначала назначьте admin кому-то ещё (AL-35)")));
            }
            HttpResponse<String> rr = kc("GET", "/roles/" + req.role(), null, t);
            if (rr.statusCode() != 200)
                return noStore(Response.status(404).entity(new LoreError("NOT_FOUND", "realm role " + req.role())));
            String payload = "[" + rr.body() + "]";
            HttpResponse<String> r = kc(remove ? "DELETE" : "POST", "/users/" + userId + "/role-mappings/realm", payload, t);
            if (r.statusCode() >= 300)
                return noStore(Response.status(r.statusCode()).entity(new LoreError("KC_UPSTREAM", r.body())));
            return noStore(Response.ok(Map.of("ok", true, "user", userId, "role", req.role(),
                "action", remove ? "removed" : "added")));
        } catch (Exception e) { return upstream(e); }
    }

    // ── Агенты (client-роли, ось агентов) — read + ротация ──────────────────

    @GET
    @Path("agents")
    @Produces(MediaType.APPLICATION_JSON)
    public Response listAgents(@HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (!configured()) return notConfigured();
        try {
            String t = adminToken();
            HttpResponse<String> cs = kc("GET", "/clients?max=200", null, t);
            io.vertx.core.json.JsonArray arr = new io.vertx.core.json.JsonArray(cs.body());
            io.vertx.core.json.JsonArray out = new io.vertx.core.json.JsonArray();
            for (int i = 0; i < arr.size(); i++) {
                io.vertx.core.json.JsonObject c = arr.getJsonObject(i);
                String cid = c.getString("clientId", "");
                if (!cid.startsWith("lore-mcp")) continue;
                HttpResponse<String> roles = kc("GET", "/clients/" + c.getString("id") + "/roles", null, t);
                io.vertx.core.json.JsonArray scope = new io.vertx.core.json.JsonArray();
                if (roles.statusCode() == 200) {
                    io.vertx.core.json.JsonArray ra = new io.vertx.core.json.JsonArray(roles.body());
                    for (int j = 0; j < ra.size(); j++) scope.add(ra.getJsonObject(j).getString("name"));
                }
                out.add(io.vertx.core.json.JsonObject.of("clientId", cid, "id", c.getString("id"),
                    "enabled", c.getBoolean("enabled"), "agent_scope", scope));
            }
            return noStore(Response.ok(out.encode()));
        } catch (Exception e) { return upstream(e); }
    }

    @POST
    @Path("agent/{id}/rotate")
    @Produces(MediaType.APPLICATION_JSON)
    public Response rotateAgentSecret(@PathParam("id") String clientUuid, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (!configured()) return notConfigured();
        try {
            String t = adminToken();
            HttpResponse<String> r = kc("POST", "/clients/" + clientUuid + "/client-secret", null, t);
            if (r.statusCode() >= 300)
                return noStore(Response.status(r.statusCode()).entity(new LoreError("KC_UPSTREAM", r.body())));
            // Секрет возвращается ОДИН раз вызывающему admin'у; нигде не сохраняется/не логируется.
            return noStore(Response.ok(r.body()));
        } catch (Exception e) { return upstream(e); }
    }

    // ── Предполётный чеклист включения auth (AL-35/AL-38) ────────────────────

    /**
     * Живые проверки для блока «Включение аутентификации» на Настройках: сколько
     * админов, жив ли мост, включён ли auth, enforced ли agent_scope. UI рисует
     * чеклист из ЭТОГО ответа, а не из своих предположений — тот же инвариант, что
     * проверяет LoreAuthStartupGuard, но до рестарта.
     * agent_scope_enforced=false захардкожен до AL-17 (AgentScopeFilter ещё не написан) —
     * поле переводится на реальную проверку вместе с R2.
     */
    @GET
    @Path("auth-preflight")
    @Produces(MediaType.APPLICATION_JSON)
    public Response authPreflight(@HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        boolean conf = configured();
        int adminCount = -1;              // -1 = неизвестно (мост не настроен/не ответил)
        String kcError = null;
        if (conf) {
            try { adminCount = bridge.enabledAdminHolders(adminToken()).size(); }
            catch (Exception e) { kcError = e.getMessage(); }
        }
        boolean canEnable = adminCount > 0;
        return noStore(Response.ok(Map.of(
            "auth_enabled", oidcEnabled,
            "kc_configured", conf,
            "kc_reachable", conf && kcError == null,
            "kc_error", kcError == null ? "" : kcError,
            "admin_count", adminCount,
            "agent_scope_enforced", false,   // AL-17 (R2) ещё не реализован
            "can_enable_auth", canEnable,
            "hint", canEnable
                ? "включение: LORE_AUTH_ENABLED=true + рестарт (RUNBOOK-AUTH-OMILORE, все флаги вместе)"
                : "сначала заведите хотя бы одного человека с ролью admin — иначе после включения auth войти не сможет никто (AL-35)")));
    }

    // ── Последние отказы (AL-45, UC-A7 реактивный минимум) ───────────────────

    @jakarta.inject.Inject
    LoreDenialRecorder denials;

    /**
     * «Почему агенту/человеку только что отказали» — снимок кольцевого буфера
     * 401/403/409 по /lore/*. Память процесса, не БД: живёт до рестарта.
     * Полноценный аудит по осям (long-term, с ролью из токена) — AL-20; UI обязан
     * показывать это происхождение данных, а не выдавать буфер за аудит.
     */
    @GET
    @Path("denials")
    @Produces(MediaType.APPLICATION_JSON)
    public Response recentDenials(@HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        return noStore(Response.ok(Map.of(
            "source", "in-memory ring (до рестарта); долговременный аудит — AL-20",
            "denials", denials.snapshot())));
    }

    private Response upstream(Exception e) {
        LOG.warnf("[LORE KC] %s", e.getMessage());
        return noStore(Response.status(Response.Status.BAD_GATEWAY)
            .entity(new LoreError("KC_UPSTREAM", e.getMessage())));
    }
}
