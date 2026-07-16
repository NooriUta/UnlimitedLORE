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
    private static final HttpClient HTTP = HttpClient.newHttpClient();

    @ConfigProperty(name = "kc.admin.url", defaultValue = "http://localhost:18180/kc")
    String kcUrl;
    @ConfigProperty(name = "kc.admin.realm", defaultValue = "omilore")
    String kcRealm;
    @ConfigProperty(name = "kc.admin.client-id", defaultValue = "lore-admin")
    String kcClientId;

    /** ADR-LORE-025 D15: секрет читается через абстракцию (env | infisical), не напрямую из env. */
    @jakarta.inject.Inject
    SecretProvider secrets;

    private static final String KC_SECRET_KEY = "KC_ADMIN_CLIENT_SECRET";

    private Optional<String> kcSecret() { return secrets.get(KC_SECRET_KEY); }

    private boolean configured() { return secrets.has(KC_SECRET_KEY); }

    private Response notConfigured() {
        return noStore(Response.status(503)
            .entity(new LoreError("KC_NOT_CONFIGURED", "kc integration not configured (" + KC_SECRET_KEY + " unset)")));
    }

    /** client_credentials токен lore-admin — только внутри сервера. */
    private String adminToken() throws Exception {
        String body = "grant_type=client_credentials&client_id=" + URLEncoder.encode(kcClientId, StandardCharsets.UTF_8)
            + "&client_secret=" + URLEncoder.encode(kcSecret().orElseThrow(), StandardCharsets.UTF_8);
        HttpRequest req = HttpRequest.newBuilder(URI.create(kcUrl + "/realms/" + kcRealm + "/protocol/openid-connect/token"))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        HttpResponse<String> r = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
        if (r.statusCode() != 200) throw new IllegalStateException("kc token " + r.statusCode());
        return new io.vertx.core.json.JsonObject(r.body()).getString("access_token");
    }

    private HttpResponse<String> kc(String method, String path, String json, String token) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(kcUrl + "/admin/realms/" + kcRealm + path))
            .header("Authorization", "Bearer " + token);
        if (json != null) b.header("Content-Type", "application/json");
        b.method(method, json == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json));
        return HTTP.send(b.build(), HttpResponse.BodyHandlers.ofString());
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
            HttpResponse<String> rr = kc("GET", "/roles/" + req.role(), null, t);
            if (rr.statusCode() != 200)
                return noStore(Response.status(404).entity(new LoreError("NOT_FOUND", "realm role " + req.role())));
            String payload = "[" + rr.body() + "]";
            boolean remove = "remove".equalsIgnoreCase(req.action());
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

    private Response upstream(Exception e) {
        LOG.warnf("[LORE KC] %s", e.getMessage());
        return noStore(Response.status(Response.Status.BAD_GATEWAY)
            .entity(new LoreError("KC_UPSTREAM", e.getMessage())));
    }
}
