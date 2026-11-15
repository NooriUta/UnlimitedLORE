package studio.seer.heimdall.lore;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Настройка входа СВОЕЙ среды для фронта — {@code GET /lore/auth/config}, открытый путь (до входа).
 *
 * <p>Владелица 15.11.2026: «вынеси realm настройкой для каждой среды». Повод — v1.17.21fix: Vite впекал
 * {@code VITE_OIDC_ISSUER} в бандл при сборке на препроде, прод по правилу везёт тот же образ — и фронт прода
 * отправлял вход в realm omilorePreprod. Бэкенд же берёт issuer из окружения своей среды
 * ({@code LORE_OIDC_ISSUER}, проверено: прод — omilore, препрод — omilorePreprod). Теперь фронт спрашивает
 * адрес входа здесь, и один образ работает в любой среде; build-time значение — только запасной путь.
 *
 * <p>Отдаётся ТОЛЬКО публичное: включён ли вход, issuer (тот же адрес, куда браузер всё равно уходит) и
 * клиент фронта. Ни секретов, ни данных LORE — поэтому путь открыт в {@link SeerRoleFromTokenFilter}.
 */
@Path("/lore/auth/config")
public class LoreAuthConfigResource {

    @ConfigProperty(name = "quarkus.oidc.enabled", defaultValue = "false")
    boolean authEnabled;

    @ConfigProperty(name = "quarkus.oidc.auth-server-url", defaultValue = "")
    String issuer;

    @ConfigProperty(name = "lore.web.oidc-client-id", defaultValue = "lore-app")
    String webClientId;

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Response get() {
        return Response.ok(body(authEnabled, issuer, webClientId)).header("Cache-Control", "no-store").build();
    }

    static Map<String, Object> body(boolean authEnabled, String issuer, String clientId) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("auth_enabled", authEnabled);
        b.put("issuer", authEnabled && issuer != null && !issuer.isBlank() ? issuer : null);
        b.put("client_id", clientId);
        return b;
    }
}
