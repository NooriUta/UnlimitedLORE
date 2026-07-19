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

    @ConfigProperty(name = "kc.admin.url", defaultValue = "http://localhost:18180/kc")
    String kcUrl;
    @ConfigProperty(name = "kc.admin.realm", defaultValue = "omilore")
    String kcRealm;
    @ConfigProperty(name = "kc.admin.client-id", defaultValue = "lore-admin")
    String kcClientId;

    @Inject
    SecretProvider secrets;

    boolean configured() { return secrets.has(KC_SECRET_KEY); }

    private Optional<String> kcSecret() { return secrets.get(KC_SECRET_KEY); }

    /** client_credentials токен lore-admin — только внутри сервера. */
    String adminToken() throws Exception {
        String body = "grant_type=client_credentials&client_id=" + URLEncoder.encode(kcClientId, StandardCharsets.UTF_8)
            + "&client_secret=" + URLEncoder.encode(kcSecret().orElseThrow(), StandardCharsets.UTF_8);
        HttpRequest req = HttpRequest.newBuilder(URI.create(kcUrl + "/realms/" + kcRealm + "/protocol/openid-connect/token"))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        HttpResponse<String> r = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
        if (r.statusCode() != 200) throw new IllegalStateException("kc token " + r.statusCode());
        return new JsonObject(r.body()).getString("access_token");
    }

    HttpResponse<String> kc(String method, String path, String json, String token) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(kcUrl + "/admin/realms/" + kcRealm + path))
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
     * Чистое правило AL-35 (юнит-тестируемо без KC): снятие админ-роли запрещено,
     * когда цель — ЕДИНСТВЕННЫЙ включённый носитель администрирования. Роль viewer
     * снимать можно всегда; super-admin мост не трогает вовсе (D11).
     */
    static boolean isLastAdminRemoval(Set<String> enabledAdminHolders, String targetUserId, String roleBeingRemoved) {
        if (!"admin".equals(roleBeingRemoved)) return false;
        return enabledAdminHolders.size() <= 1 && enabledAdminHolders.contains(targetUserId);
    }
}
