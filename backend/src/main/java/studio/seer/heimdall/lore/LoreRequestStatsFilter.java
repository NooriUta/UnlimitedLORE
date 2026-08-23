package studio.seer.heimdall.lore;

import io.quarkus.security.identity.SecurityIdentity;
import jakarta.inject.Inject;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.container.ContainerResponseFilter;
import jakarta.ws.rs.ext.Provider;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.jwt.JsonWebToken;

/**
 * Считает КАЖДЫЙ запрос к {@code /lore/*} — и чтения, и записи (STAT-1).
 *
 * <p>Отдельно от {@link LoreAuditLogFilter} намеренно. Аудит отвечает на вопрос
 * «кто и что изменил» и потому смотрит только записи; статистика отвечает на
 * «кто что и по сколько запрашивает», и без чтений она бессмысленна — основной
 * трафик агентов это слайсы. Смешать их в одном фильтре значило бы либо
 * замусорить аудит чтениями, либо оставить статистику слепой на 90% вызовов.
 *
 * <h2>«Что» — с точностью до слайса</h2>
 * Для {@code /lore/slice/{name}} пишется имя слайса. Семейства мало: весь
 * трафик чтения схлопнулся бы в одно значение {@code slice}, и вопрос «что
 * именно запрашивают» остался бы без ответа — а он и был задан.
 *
 * <h2>«Кто» — факт токена</h2>
 * Ось и имя берутся из JWT ({@code agent_scope} → агент, иначе subject/имя
 * пользователя), как и в аудите: тело запроса может назвать кем угодно.
 */
@Provider
public class LoreRequestStatsFilter implements ContainerResponseFilter {

    @Inject
    LoreRequestStats stats;

    @Inject
    SecurityIdentity identity;

    @ConfigProperty(name = "quarkus.oidc.enabled", defaultValue = "false")
    boolean oidcEnabled;

    @Override
    public void filter(ContainerRequestContext req, ContainerResponseContext res) {
        String family = AgentScopeFilter.familyOf(req.getUriInfo().getPath());
        if (family == null) return;   // не /lore/* — не наш периметр

        String axis;
        String caller;
        if (oidcEnabled && identity != null && !identity.isAnonymous()) {
            String scope = AgentScopeFilter.agentScopeOf(identity);
            if (scope != null) {
                axis = "agent";
                caller = scope;
            } else {
                axis = "human";
                caller = humanName(req);
            }
        } else {
            // Без токенов (dev/local) ось установить нечем. Пишем как есть, а не
            // «human»: приписать вызов человеку, которого не опознали, — то же
            // самое враньё, что и приписать агенту.
            axis = "unauth";
            caller = humanName(req);
        }

        stats.record(caller, axis, whatOf(req));
        if (stats.touchSession(axis + ":" + caller)) stats.recordSessionStart(caller, axis);
    }

    /**
     * Что именно звали: для слайсов — {@code slice:<имя>}, иначе два первых
     * сегмента пути ({@code adr/delete}), иначе семейство.
     */
    private static String whatOf(ContainerRequestContext req) {
        String path = req.getUriInfo().getPath();
        String family = AgentScopeFilter.familyOf(path);
        if ("slice".equals(family)) {
            String[] parts = path.replaceFirst("^/?lore/slice/?", "").split("/");
            String name = parts.length > 0 ? parts[0] : "";
            return name.isBlank() ? "slice" : "slice:" + name;
        }
        String sub = AgentScopeFilter.subPathOf(path);
        return sub.isBlank() ? family : sub;
    }

    /** Имя человека из токена, иначе роль из заголовка — как в аудите. */
    private String humanName(ContainerRequestContext req) {
        if (identity != null && identity.getPrincipal() instanceof JsonWebToken jwt) {
            Object u = jwt.getClaim("preferred_username");
            if (u != null && !String.valueOf(u).isBlank()) return String.valueOf(u);
            if (jwt.getSubject() != null && !jwt.getSubject().isBlank()) return jwt.getSubject();
        }
        String r = req.getHeaderString("X-Seer-Role");
        return r == null || r.isBlank() ? "unknown" : r;
    }
}
