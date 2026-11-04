package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * Общая обвязка KC-моста (ADR-LORE-025 D11): токен lore-admin, вызовы Admin API,
 * подсчёт администраторов. Вынесена из LoreKcResource, потому что появился второй
 * потребитель — LoreAuthStartupGuard (AL-35): guard обязан считать админов ТЕМ ЖЕ
 * кодом, что и мост, иначе их представления о "кто админ" разъедутся.
 * Секрет — только через SecretProvider (D15), наружу не отдаётся и не логируется.
 */
@ApplicationScoped
public class KcBridge {

    static final String KC_SECRET_KEY = "KC_ADMIN_CLIENT_SECRET";

    private static final HttpClient HTTP = HttpClient.newHttpClient();

    /** Обе администрирующие realm-роли: инвариант AL-35 — «существует хотя бы один их носитель». */
    static final List<String> ADMIN_ROLES = List.of("admin", "super-admin");

    /**
     * FI-KC-DEFAULTS: без умолчания. Было {@code http://localhost:18180/kc} — чужая
     * установка без переменной молча шла на свой же localhost и получала «KC не
     * отвечает» вместо «адрес не задан». Пусто → мост не настроен, и причина
     * названа ({@link #missingConfig()}). Наш стенд задаёт адрес в compose.
     * Optional, а не {@code ${VAR:}}: пустая строка там роняет старт.
     */
    @ConfigProperty(name = "kc.admin.url")
    Optional<String> kcUrl;
    @ConfigProperty(name = "kc.admin.realm", defaultValue = "omilore")
    String kcRealm;
    @ConfigProperty(name = "kc.admin.client-id", defaultValue = "lore-admin")
    String kcClientId;

    @Inject
    SecretProvider secrets;

    boolean configured() { return missingConfig().isEmpty(); }

    /** Чего не хватает мосту — пусто, если всё есть. Называется в health и логах. */
    List<String> missingConfig() {
        List<String> out = new java.util.ArrayList<>();
        if (!secrets.has(KC_SECRET_KEY)) out.add(KC_SECRET_KEY);
        if (kcUrl.filter(u -> !u.isBlank()).isEmpty()) out.add("kc.admin.url");
        return out;
    }

    private String url() {
        return kcUrl.filter(u -> !u.isBlank()).orElseThrow(
            () -> new IllegalStateException("kc.admin.url не задан"));
    }

    private Optional<String> kcSecret() { return secrets.get(KC_SECRET_KEY); }

    /** client_credentials токен lore-admin — только внутри сервера. */
    String adminToken() throws Exception {
        String body = "grant_type=client_credentials&client_id=" + URLEncoder.encode(kcClientId, StandardCharsets.UTF_8)
            + "&client_secret=" + URLEncoder.encode(kcSecret().orElseThrow(), StandardCharsets.UTF_8);
        HttpRequest req = HttpRequest.newBuilder(URI.create(url() + "/realms/" + kcRealm + "/protocol/openid-connect/token"))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        HttpResponse<String> r = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
        if (r.statusCode() != 200) throw new IllegalStateException("kc token " + r.statusCode());
        return new JsonObject(r.body()).getString("access_token");
    }

    HttpResponse<String> kc(String method, String path, String json, String token) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url() + "/admin/realms/" + kcRealm + path))
            .header("Authorization", "Bearer " + token);
        if (json != null) b.header("Content-Type", "application/json");
        b.method(method, json == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json));
        return HTTP.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }

    /**
     * user-id всех ВКЛЮЧЁННЫХ носителей admin/super-admin. 404 на роли (не заведена
     * в realm) — легальная пустота, а не ошибка: guard'у важно множество носителей.
     */
    Set<String> enabledAdminHolders(String token) throws Exception {
        Set<String> ids = new HashSet<>();
        for (String r : ADMIN_ROLES) {
            HttpResponse<String> resp = kc("GET", "/roles/" + r + "/users?max=200", null, token);
            if (resp.statusCode() == 404) continue;
            if (resp.statusCode() != 200) throw new IllegalStateException("kc role-users " + r + " " + resp.statusCode());
            JsonArray arr = new JsonArray(resp.body());
            for (int i = 0; i < arr.size(); i++) {
                JsonObject u = arr.getJsonObject(i);
                if (Boolean.TRUE.equals(u.getBoolean("enabled"))) ids.add(u.getString("id"));
            }
        }
        return ids;
    }

    /**
     * Какую realm-роль мост выдаёт и снимает из админки. Правило от противного:
     * любую роль realm'а, кроме super-admin (D11 — эскалация только в консоли KC)
     * и служебных ролей самого Keycloak. Раньше здесь был список {@code admin|viewer},
     * и роль, заведённую в realm руками, нельзя было выдать вовсе (04.11.2026).
     * Существует ли роль, проверяет сам вызов — KC ответит 404.
     */
    static boolean isGrantableRealmRole(String role) {
        if (role == null || role.isBlank()) return false;
        if ("super-admin".equals(role)) return false;
        return !isKeycloakServiceRole(role);
    }

    /** Роли, которые Keycloak заводит сам на каждый realm, — не права LORE. */
    static boolean isKeycloakServiceRole(String role) {
        return role.startsWith("default-roles-")
            || "offline_access".equals(role)
            || "uma_authorization".equals(role);
    }

    /**
     * Чистое правило AL-35 (юнит-тестируемо без KC): снятие админ-роли запрещено,
     * когда цель — ЕДИНСТВЕННЫЙ включённый носитель администрирования. Роль viewer
     * снимать можно всегда; super-admin мост не трогает вовсе (D11).
     */
    static boolean isLastAdminRemoval(Set<String> enabledAdminHolders, String targetUserId, String roleBeingRemoved) {
        if (!"admin".equals(roleBeingRemoved)) return false;
        return enabledAdminHolders.size() <= 1 && enabledAdminHolders.contains(targetUserId);
    }
}
