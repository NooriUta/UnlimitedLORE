package studio.seer.heimdall.lore;

import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.Priority;
import jakarta.inject.Inject;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.Provider;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.jwt.JsonWebToken;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * SPRINT_LORE_PRODUCT_BACKLOG/MINI-01-AZP-ALLOWLIST — явный список допустимых клиентов токена.
 *
 * <p><b>Зачем.</b> Realm выдаёт токены многим клиентам (веб, мобильный miniLORE, MCP разных
 * harness, сервер miniLORE). Проверка подписи и issuer говорит «токен наш», но не «этому
 * клиенту сюда можно». Настройка {@code lore.auth.allowed-clients} — список значений claim
 * {@code azp} через запятую; элемент со звёздочкой на конце — префикс ({@code lore-mcp-full*}).
 *
 * <p><b>По умолчанию пусто — проверка выключена</b>, поведение как до задачи. Включение на
 * проде — решение владелицы. Запрос без токена и выключенный OIDC фильтр не трогает: это забота
 * {@link SeerRoleFromTokenFilter} (первая ось). Токен без {@code azp} при заданном списке —
 * отказ: клиента не назвать, значит и не проверить.
 */
@Provider
@Priority(Priorities.AUTHENTICATION + 150)
public class ClientAllowlistFilter implements ContainerRequestFilter {

    static final String PROPERTY = "lore.auth.allowed-clients";

    @Inject
    SecurityIdentity identity;

    @ConfigProperty(name = "quarkus.oidc.enabled", defaultValue = "false")
    boolean oidcEnabled;

    @ConfigProperty(name = PROPERTY)
    Optional<String> allowedRaw;

    /** Список из настройки: пробелы и пустые элементы отбрасываются. */
    static List<String> parse(Optional<String> raw) {
        List<String> out = new ArrayList<>();
        if (raw == null || raw.isEmpty()) return out;
        for (String s : raw.get().split(",")) {
            String t = s.strip();
            if (!t.isEmpty() && !"*".equals(t.strip())) out.add(t);
        }
        return out;
    }

    static boolean matches(String pattern, String azp) {
        if (pattern.endsWith("*")) return azp.startsWith(pattern.substring(0, pattern.length() - 1));
        return pattern.equals(azp);
    }

    /** Причина отказа словами; {@code null} — пропустить. Пустой список — пропустить всех. */
    static String refusal(List<String> allowed, String azp) {
        if (allowed == null || allowed.isEmpty()) return null;
        if (azp == null || azp.isBlank())
            return "в токене нет клиента (claim azp), а доступ ограничен списком " + PROPERTY + " — проверить нечем";
        for (String p : allowed) if (matches(p, azp)) return null;
        return "клиент «" + azp + "» не входит в список допустимых клиентов (" + PROPERTY + ")";
    }

    @Override
    public void filter(ContainerRequestContext ctx) {
        if (!oidcEnabled) return;
        List<String> allowed = parse(allowedRaw);
        if (allowed.isEmpty()) return;
        if (identity == null || identity.isAnonymous()) return;
        if (!SeerRoleFromTokenFilter.isProtected(ctx.getUriInfo().getPath())) return;
        Object azp = identity.getPrincipal() instanceof JsonWebToken jwt ? jwt.getClaim("azp") : null;
        String why = refusal(allowed, azp == null ? null : String.valueOf(azp).replace("\"", ""));
        if (why == null) return;
        ctx.abortWith(Response.status(Response.Status.FORBIDDEN)
            .header("Cache-Control", "no-store")
            .type(MediaType.APPLICATION_JSON)
            .entity(new LoreResourceBase.LoreError("CLIENT_NOT_ALLOWED", why))
            .build());
    }
}
