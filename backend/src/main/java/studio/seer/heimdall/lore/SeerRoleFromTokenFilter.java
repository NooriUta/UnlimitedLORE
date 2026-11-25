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

/**
 * A2 — bridges Keycloak (omilore realm) auth to the existing role gate. When OIDC
 * is enabled, it derives the internal {@code X-Seer-Role} header from the VERIFIED
 * token's realm roles, overwriting whatever the client sent — so requireAdmin
 * (which reads X-Seer-Role) can no longer be spoofed with a plain header.
 *
 * When OIDC is disabled (dev/local, quarkus.oidc.enabled=false) the request is
 * anonymous and the incoming header is left untouched — today's behaviour, so
 * nothing about local dev changes until auth is switched on.
 *
 * When OIDC IS enabled, an anonymous request (no bearer token) must NOT get the
 * same free pass: Quarkus treats a missing token as an anonymous identity too, so
 * "OIDC on, no token" and "OIDC off" both hit isAnonymous()==true above. Without
 * the oidcEnabled check below, an unauthenticated caller could send a plain
 * `X-Seer-Role: admin` header once OIDC is switched on in staging/prod and reach
 * requireAdmin() — the exact spoof this filter exists to close (flagged by Devin
 * review on PR #79, SEC-0001).
 */
@Provider
@Priority(Priorities.AUTHENTICATION + 100)
public class SeerRoleFromTokenFilter implements ContainerRequestFilter {

    @Inject
    SecurityIdentity identity;

    @ConfigProperty(name = "quarkus.oidc.enabled", defaultValue = "false")
    boolean oidcEnabled;

    /**
     * MIG-30: чтение тоже требует входа, а не только запись.
     *
     * До этого снятие заголовка закрывало ЗАПИСЬ (requireAdmin не получал роли),
     * но GET проходил дальше и отдавал данные анониму. Замер на живом стенде:
     * `GET /lore/slice/sprints` без токена → 200 и 392 КБ содержимого — весь граф,
     * включая ADR, решения и заметки о том, где что устроено слабо.
     *
     * На LAN это было осознанным решением. При публикации наружу оно превращается
     * в утечку, и увидеть её трудно: браузер честно показывает форму входа, потому
     * что `AuthGate` срабатывает раньше, — а API отдаёт то же самое мимо интерфейса.
     * Защита интерфейса не является защитой данных.
     *
     * Проверяется факт входа, а не роль: роли уже разграничивают, что можно менять.
     */
    static boolean isProtected(String path) {
        if (path == null) return false;
        String p = path.startsWith("/") ? path.substring(1) : path;
        // Только продуктовый слой. `/q/health/*` намеренно остаётся открытым:
        // на него смотрят healthcheck в compose и проверка деплоя в CD, а данных
        // он не отдаёт. Закрыть его значило бы сломать перезапуск стенда, и
        // выглядело бы это как «контейнер не поднимается».
        // Единственное исключение — настройка входа своей среды (LoreAuthConfigResource): она нужна ДО входа
        // и отдаёт только публичное (issuer, клиент фронта). Ровно этот путь, не поддерево.
        if (p.equals(AUTH_CONFIG_PATH)) return false;
        // EMB-L6: открытый ключ подписи встройки (JWKS) — Völva читает его без токена; только открытые ключи.
        if (p.equals(EMBED_JWKS_PATH)) return false;
        return p.equals("lore") || p.startsWith("lore/");
    }

    /** Роль, которой создаётся проект, — одно слово, как её кладёт сюда мост Keycloak. */
    static final String SUPERADMIN = "superadmin";

    /**
     * SPRINT_LORE_EXT_AUDIT_1190/AUD-SUPERADMIN (issue SeidrStudio/UnlimitedLORE#8): одно написание
     * роли во всём LORE — {@code superadmin}. Роль realm Keycloak называется {@code super-admin}, и
     * человек, поставивший {@code LORE_SEER_ROLE=super-admin}, получал 403. Теперь {@code super-admin}
     * и {@code super_admin} (любой регистр, пробелы по краям) — синонимы; остальные роли не меняются.
     */
    static String normalizeRole(String role) {
        if (role == null) return null;
        String r = role.trim();
        String k = r.toLowerCase(java.util.Locale.ROOT);
        if (k.equals("super-admin") || k.equals("super_admin") || k.equals(SUPERADMIN)) return SUPERADMIN;
        return r;
    }

    /** Открытый путь настройки входа (без ведущего «/»). */
    static final String AUTH_CONFIG_PATH = "lore/auth/config";

    /** Открытый путь JWKS встройки Völva (без ведущего «/»), SPRINT_VIZ_EMBED/EMB-L6. */
    static final String EMBED_JWKS_PATH = "lore/embed/jwks";

    @Override
    public void filter(ContainerRequestContext ctx) {
        if (identity == null || identity.isAnonymous()) {
            if (oidcEnabled) {
                // OIDC is on but this request carried no verified token — an
                // anonymous caller gets no role, full stop. Never trust a raw
                // client header once verified auth is the source of truth.
                ctx.getHeaders().remove("X-Seer-Role");
                if (isProtected(ctx.getUriInfo().getPath())) {
                    ctx.abortWith(Response.status(Response.Status.UNAUTHORIZED)
                        .header("Cache-Control", "no-store")
                        .type(MediaType.APPLICATION_JSON)
                        .entity(new LoreResourceBase.LoreError("UNAUTHENTICATED",
                            "требуется вход: чтение и запись в LORE доступны только "
                            + "аутентифицированным пользователям и агентам"))
                        .build());
                }
            }
            // OIDC off (dev/local, пакет установки): X-Seer-Role принимается как прислан, но в
            // ОДНОМ написании — AUD-SUPERADMIN (issue SeidrStudio#8): «super-admin» (имя роли realm
            // Keycloak) приводится к «superadmin», которое ждут все проверки.
            String sent = ctx.getHeaderString("X-Seer-Role");
            String norm = normalizeRole(sent);
            if (sent != null && !sent.equals(norm)) ctx.getHeaders().putSingle("X-Seer-Role", norm);
            return;
        }
        final String role;
        if (identity.hasRole("super-admin")) {
            role = "superadmin";
        } else if (identity.hasRole("admin")) {
            role = "admin";
        } else {
            role = "viewer";
        }
        ctx.getHeaders().putSingle("X-Seer-Role", role);
    }
}
