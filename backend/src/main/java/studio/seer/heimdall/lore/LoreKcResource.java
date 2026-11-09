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

    /**
     * Роли realm'а, какие есть на самом деле, — чтобы админка выдавала их, а не
     * держала в коде список «admin, viewer» (04.11.2026: роль, заведённую в realm
     * руками, нельзя было ни увидеть в карточке, ни выдать). Служебные роли KC
     * не отдаются вовсе; super-admin отдаётся с {@code grantable:false} — его
     * видно, но выдаётся он только в консоли KC (D11).
     */
    @GET
    @Path("realm-roles")
    @Produces(MediaType.APPLICATION_JSON)
    public Response listRealmRoles(@HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (!configured()) return notConfigured();
        try {
            HttpResponse<String> r = kc("GET", "/roles?max=200", null, adminToken());
            if (r.statusCode() != 200)
                return noStore(Response.status(r.statusCode()).entity(new LoreError("KC_UPSTREAM", r.body())));
            io.vertx.core.json.JsonArray arr = new io.vertx.core.json.JsonArray(r.body());
            io.vertx.core.json.JsonArray out = new io.vertx.core.json.JsonArray();
            for (int i = 0; i < arr.size(); i++) {
                io.vertx.core.json.JsonObject x = arr.getJsonObject(i);
                String name = x.getString("name");
                if (name == null || KcBridge.isKeycloakServiceRole(name)) continue;
                out.add(io.vertx.core.json.JsonObject.of(
                    "name", name, "description", x.getString("description"),
                    "grantable", KcBridge.isGrantableRealmRole(name)));
            }
            return noStore(Response.ok(out.encode()));
        } catch (Exception e) { return upstream(e); }
    }

    // AL-82: два источника знают о людях — KC (учётки) и граф (роли в проектах).
    // Инвариант «пользователь KC без вершины KnowUser не получает проектных
    // прав» дырой не является (это и есть defaults-to-deny), но живёт незаметно
    // — учётка есть, войти можно, а прав нигде не назначено, и разница между
    // «забыли назначить» и «умышленно без доступа» не видна без явной сверки.
    // По образцу asset_orphans, но НЕ статический слайс: список KC-пользователей
    // не лежит в ArcadeDB, сверка возможна только здесь, живым запросом к KC.
    @GET
    @Path("user-orphans")
    @Produces(MediaType.APPLICATION_JSON)
    public Response userOrphans(@HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (!configured()) return notConfigured();
        try {
            String t = adminToken();
            HttpResponse<String> users = kc("GET", "/users?max=200", null, t);
            io.vertx.core.json.JsonArray arr = new io.vertx.core.json.JsonArray(users.body());
            java.util.List<Map<String, Object>> graphUsers = ingestService.queryPublic(
                "SELECT kc_sub FROM KnowUser", Map.of());
            java.util.Set<String> known = new java.util.HashSet<>();
            for (Map<String, Object> r : graphUsers) known.add(String.valueOf(r.get("kc_sub")));
            io.vertx.core.json.JsonArray out = new io.vertx.core.json.JsonArray();
            for (int i = 0; i < arr.size(); i++) {
                io.vertx.core.json.JsonObject u = arr.getJsonObject(i);
                String id = u.getString("id");
                if (!known.contains(id)) {
                    out.add(io.vertx.core.json.JsonObject.of(
                        "id", id, "username", u.getString("username"),
                        "email", u.getString("email"), "enabled", u.getBoolean("enabled")));
                }
            }
            return noStore(Response.ok(Map.of("orphans", out.getList())));
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

    // ── S7A-12 A: учётка агента по шаблону профиля (UC-ADMIN-NEW-MACHINE) ────

    public record KcAgentClientRequest(String profile, String machine) {}

    private Response kcRefused(HttpResponse<String> r) {
        String hint = LoreKcAgentClient.forbiddenHint(r.statusCode());
        return noStore(Response.status(r.statusCode())
            .entity(new LoreError(hint != null ? "KC_FORBIDDEN" : "KC_UPSTREAM", hint != null ? hint : r.body())));
    }

    /** id клиента KC по clientId; null — нет такого. */
    private String kcClientUuid(String clientId, String t) throws Exception {
        HttpResponse<String> r = kc("GET", "/clients?clientId=" + URLEncoder.encode(clientId, StandardCharsets.UTF_8), null, t);
        if (r.statusCode() != 200) throw new KcCallFailed(r);
        io.vertx.core.json.JsonArray a = new io.vertx.core.json.JsonArray(r.body());
        return a.isEmpty() ? null : a.getJsonObject(0).getString("id");
    }

    private static final class KcCallFailed extends RuntimeException {
        final HttpResponse<String> response;
        KcCallFailed(HttpResponse<String> r) { super("kc " + r.statusCode()); this.response = r; }
    }

    @POST
    @Path("agent-client")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response createAgentClient(KcAgentClientRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (!configured()) return notConfigured();
        if (req == null) return badParams("profile и machine обязательны");
        final String templateId, newId;
        try {
            templateId = LoreKcAgentClient.templateId(req.profile());
            newId = LoreKcAgentClient.clientId(req.profile(), req.machine());
        } catch (IllegalArgumentException e) { return badParams(e.getMessage()); }
        try {
            String t = adminToken();
            String tplUuid = kcClientUuid(templateId, t);
            if (tplUuid == null)
                return badParams("нет шаблона профиля: клиента " + templateId + " в Keycloak нет");
            if (kcClientUuid(newId, t) != null)
                return noStore(Response.status(409).entity(new LoreError("EXISTS",
                    newId + " уже есть — секрет повторно не выдаётся; отключите и заведите заново")));
            HttpResponse<String> tpl = kc("GET", "/clients/" + tplUuid, null, t);
            if (tpl.statusCode() != 200) return kcRefused(tpl);
            io.vertx.core.json.JsonObject body = LoreKcAgentClient.fromTemplate(new io.vertx.core.json.JsonObject(tpl.body()), newId);
            HttpResponse<String> created = kc("POST", "/clients", body.encode(), t);
            if (created.statusCode() >= 300) return kcRefused(created);
            String newUuid = kcClientUuid(newId, t);
            HttpResponse<String> sec = kc("GET", "/clients/" + newUuid + "/client-secret", null, t);
            if (sec.statusCode() != 200) return kcRefused(sec);
            String secret = new io.vertx.core.json.JsonObject(sec.body()).getString("value");

            // realm-роли сервисного аккаунта — тоже из шаблона: без них учётка входит, но прав нет.
            List<String> copied = new java.util.ArrayList<>();
            String rolesNote = null;
            HttpResponse<String> tplSa = kc("GET", "/clients/" + tplUuid + "/service-account-user", null, t);
            HttpResponse<String> newSa = kc("GET", "/clients/" + newUuid + "/service-account-user", null, t);
            if (tplSa.statusCode() == 200 && newSa.statusCode() == 200) {
                String tplUser = new io.vertx.core.json.JsonObject(tplSa.body()).getString("id");
                String newUser = new io.vertx.core.json.JsonObject(newSa.body()).getString("id");
                HttpResponse<String> rm = kc("GET", "/users/" + tplUser + "/role-mappings/realm", null, t);
                if (rm.statusCode() == 200) {
                    io.vertx.core.json.JsonArray roles = new io.vertx.core.json.JsonArray(rm.body());
                    io.vertx.core.json.JsonArray grant = new io.vertx.core.json.JsonArray();
                    for (int i = 0; i < roles.size(); i++) {
                        io.vertx.core.json.JsonObject r = roles.getJsonObject(i);
                        if (KcBridge.isKeycloakServiceRole(r.getString("name", ""))) continue;
                        grant.add(r);
                        copied.add(r.getString("name"));
                    }
                    if (!grant.isEmpty()) {
                        HttpResponse<String> g = kc("POST", "/users/" + newUser + "/role-mappings/realm", grant.encode(), t);
                        if (g.statusCode() >= 300) { copied.clear(); rolesNote = "роли не скопированы: KC " + g.statusCode(); }
                    }
                } else rolesNote = "роли шаблона не прочитаны: KC " + rm.statusCode();
            } else rolesNote = "сервисный аккаунт не найден у шаблона или нового клиента";
            LOG.infof("[LORE KC] создан клиент агента %s по шаблону %s, ролей скопировано %d", newId, templateId, copied.size());
            Map<String, Object> out = new java.util.LinkedHashMap<>();
            out.put("ok", true);
            out.put("clientId", newId);
            out.put("template", templateId);
            out.put("secret", secret);
            out.put("secret_note", "показывается один раз: LORE его не хранит. Положите в Infisical или в конфиг машины сразу.");
            out.put("roles_copied", copied);
            if (rolesNote != null) out.put("roles_note", rolesNote);
            return noStore(Response.ok(out));
        } catch (KcCallFailed e) { return kcRefused(e.response); }
        catch (Exception e) { return upstream(e); }
    }

    @POST
    @Path("agent-client/{clientId}/disable")
    @Produces(MediaType.APPLICATION_JSON)
    public Response disableAgentClient(@PathParam("clientId") String clientId, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (!configured()) return notConfigured();
        if (clientId == null || !clientId.startsWith("lore-mcp-"))
            return badParams("отключаются только учётки агентов lore-mcp-*");
        try {
            String t = adminToken();
            String uuid = kcClientUuid(clientId, t);
            if (uuid == null) return noStore(Response.status(404).entity(new LoreError("NOT_FOUND", clientId + " в Keycloak нет")));
            HttpResponse<String> r = kc("PUT", "/clients/" + uuid, io.vertx.core.json.JsonObject.of("enabled", false).encode(), t);
            if (r.statusCode() >= 300) return kcRefused(r);
            LOG.infof("[LORE KC] клиент агента %s отключён", clientId);
            return noStore(Response.ok(Map.of("ok", true, "clientId", clientId, "enabled", false)));
        } catch (KcCallFailed e) { return kcRefused(e.response); }
        catch (Exception e) { return upstream(e); }
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
        // D11: эскалация до super-admin — только вручную в KC, вне моста. Остальные
        // роли realm'а выдаются (KcBridge.isGrantableRealmRole); несуществующая — 404 ниже.
        if (!KcBridge.isGrantableRealmRole(req.role()))
            return badParams("role " + req.role() + " is not grantable from LORE: super-admin is out of bridge scope by design (D11), Keycloak service roles are not LORE rights");
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

    /**
     * Может ли клиент KC получить СВОЙ токен и прийти с ним в LORE — то есть
     * попадает ли он на ось агентов вообще.
     *
     * <p><b>Было написано префиксом {@code clientId.startsWith("lore-mcp")} —
     * и это делало сторожа слепым ровно к тому, для чего он написан.</b>
     * {@code agent-orphans} ищет «клиент KC без KnowActor»: у такого клиента
     * нет входа в цепочку {@code client_id → владелец → роль}, и проектный
     * скоуп отдаёт на него пустое множество. Префикс же отбирал только наши
     * MCP-клиенты, а главный потребитель API — служебная учётка приложения
     * miniLORE ({@code lore-reader-minilore}, 25 478 вызовов по проду
     * 19.10.2026) — под него не попадает и в списке сирот не появлялась
     * никогда. Сторож отвечал «сирот нет» при живой сироте: тот самый случай,
     * когда непроведённая проверка выглядит как успешная.
     *
     * <p>Признак взят по СВОЙСТВУ клиента, а не по имени: имя — соглашение,
     * которое следующий клиент может не соблюсти, а {@code serviceAccountsEnabled}
     * и есть то, что позволяет прийти с собственным токеном.
     */
    private static boolean hasServiceAccount(io.vertx.core.json.JsonObject client) {
        return Boolean.TRUE.equals(client.getBoolean("serviceAccountsEnabled", false));
    }

    /**
     * Ось агента (S4-AGENT-CLIENT-PICK): свои роли клиента ∪ клиентские роли его
     * сервисной учётки вида {@code agent-*}. Машинные клиенты
     * {@code lore-mcp-full_<машина>} своих ролей не имеют — {@code agent-full} им
     * выдана клиентской ролью {@code lore-mcp-full} на сервисную учётку, и раньше
     * их ось была пустой: админка не пускала их в «Учётку». Служебные роли
     * Keycloak (realm-management и т. п.) агента из клиента не делают.
     * Сервисную учётку не прочитали — остаются свои роли, без выдумывания.
     *
     * @param ownRolesJson   ответ {@code /clients/{id}/roles} (массив ролей)
     * @param saMappingsJson ответ {@code /users/{sa}/role-mappings} или null
     */
    static java.util.List<String> agentScope(String ownRolesJson, String saMappingsJson) {
        java.util.LinkedHashSet<String> out = new java.util.LinkedHashSet<>();
        try {
            io.vertx.core.json.JsonArray own = new io.vertx.core.json.JsonArray(ownRolesJson == null ? "[]" : ownRolesJson);
            for (int i = 0; i < own.size(); i++) {
                String n = own.getJsonObject(i).getString("name");
                if (n != null) out.add(n);
            }
        } catch (RuntimeException e) { /* свои роли не прочитались — ось из сервисной учётки */ }
        if (saMappingsJson != null) {
            try {
                io.vertx.core.json.JsonObject cm = new io.vertx.core.json.JsonObject(saMappingsJson).getJsonObject("clientMappings");
                if (cm != null) {
                    for (String client : cm.fieldNames()) {
                        io.vertx.core.json.JsonArray ms = cm.getJsonObject(client).getJsonArray("mappings");
                        if (ms == null) continue;
                        for (int i = 0; i < ms.size(); i++) {
                            String n = ms.getJsonObject(i).getString("name");
                            if (n != null && n.startsWith("agent-")) out.add(n);
                        }
                    }
                }
            } catch (RuntimeException e) { /* нечитаемый ответ — остаются свои роли */ }
        }
        return new java.util.ArrayList<>(out);
    }

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
                if (!hasServiceAccount(c)) continue;
                HttpResponse<String> roles = kc("GET", "/clients/" + c.getString("id") + "/roles", null, t);
                String own = roles.statusCode() == 200 ? roles.body() : "[]";
                // S4-AGENT-CLIENT-PICK: ось машинного клиента (lore-mcp-full_<машина>)
                // выдана ролью на его сервисную учётку, а не своей ролью клиента.
                String sa = null;
                HttpResponse<String> su = kc("GET", "/clients/" + c.getString("id") + "/service-account-user", null, t);
                if (su.statusCode() == 200) {
                    String uid = new io.vertx.core.json.JsonObject(su.body()).getString("id");
                    if (uid != null) {
                        HttpResponse<String> rm = kc("GET", "/users/" + uid + "/role-mappings", null, t);
                        if (rm.statusCode() == 200) sa = rm.body();
                    }
                }
                io.vertx.core.json.JsonArray scope = new io.vertx.core.json.JsonArray(agentScope(own, sa));
                out.add(io.vertx.core.json.JsonObject.of("clientId", cid, "id", c.getString("id"),
                    "enabled", c.getBoolean("enabled"), "agent_scope", scope));
            }
            return noStore(Response.ok(out.encode()));
        } catch (Exception e) { return upstream(e); }
    }

    // AL-83/ADR-LORE-036: та же ловушка, что user-orphans, на оси агентов —
    // клиент KC без KnowActor(kind=agent).client_id в графе не имеет
    // владельца, а значит AL-68 не сможет вывести ему проектную роль вовсе
    // (не «отказ по матрице», а «нет входа в цепочку client_id→агент»).
    @GET
    @Path("agent-orphans")
    @Produces(MediaType.APPLICATION_JSON)
    public Response agentOrphans(@HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (!configured()) return notConfigured();
        try {
            String t = adminToken();
            HttpResponse<String> cs = kc("GET", "/clients?max=200", null, t);
            io.vertx.core.json.JsonArray arr = new io.vertx.core.json.JsonArray(cs.body());
            java.util.List<Map<String, Object>> graphAgents = ingestService.queryPublic(
                "SELECT client_id FROM KnowActor WHERE kind = 'agent' AND client_id IS NOT NULL", Map.of());
            java.util.Set<String> known = new java.util.HashSet<>();
            for (Map<String, Object> r : graphAgents) known.add(String.valueOf(r.get("client_id")));
            io.vertx.core.json.JsonArray out = new io.vertx.core.json.JsonArray();
            for (int i = 0; i < arr.size(); i++) {
                io.vertx.core.json.JsonObject c = arr.getJsonObject(i);
                String cid = c.getString("clientId", "");
                if (!hasServiceAccount(c)) continue;
                if (!known.contains(cid)) {
                    out.add(io.vertx.core.json.JsonObject.of(
                        "clientId", cid, "id", c.getString("id"), "enabled", c.getBoolean("enabled")));
                }
            }
            return noStore(Response.ok(Map.of("orphans", out.getList())));
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
     * agent_scope_enforced (AL-17/R2) больше не захардкожен: он отражает то же
     * условие, при котором реально работает AgentScopeFilter — включённый OIDC.
     * Без токенов проверять нечего, поэтому при auth=false честнее false, чем
     * «фильтр есть».
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
            "agent_scope_enforced", oidcEnabled,   // AL-17 (R2): AgentScopeFilter работает только при включённом OIDC
            "agent_scope_families", AgentScopeFilter.enforcedFamilies(),
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
