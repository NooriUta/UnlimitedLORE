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
import org.jboss.logging.Logger;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * AL-17 (R2) — вторая ось RBAC: ЧТО именно агенту позволено писать.
 *
 * <p>Первая ось ({@link SeerRoleFromTokenFilter}) отвечает на вопрос «пустить ли
 * вообще»: она выводит {@code X-Seer-Role} из realm-ролей токена. Но все семь
 * агентных профилей ходят с ролью {@code admin} — иначе им нечем писать, — и по
 * первой оси они неразличимы. Различие несёт claim {@code agent_scope}
 * ({@code agent-full}, {@code agent-pm}, …), который KC кладёт в токен client-ролью
 * профиля. До этого фильтра клейм существовал, но НИКТО его не проверял: маркетолог
 * с валидным токеном мог переписать ADR.
 *
 * <h2>Что проверяется</h2>
 * Только ЗАПИСЬ. Чтение (GET, слайсы) открыто всем агентам — так объявлено в
 * матрице прав админ-панели, строка «Чтение (слайсы) · все агенты».
 *
 * <h2>Кого проверяет</h2>
 * Только агентов, то есть носителей клейма {@code agent_scope}. У человека такого
 * клейма нет, и его права по-прежнему определяет {@code requireAdmin}. Поэтому
 * фильтр не может отобрать доступ у владельца — только у машины.
 *
 * <h2>Почему неперечисленное ПРОПУСКАЕТСЯ</h2>
 * Матрица покрывает не все семейства: под {@code /lore} живут ещё feature, uc,
 * pain, job, component, asset и другие. Запрет по умолчанию отрезал бы продуктовый
 * слой у architect/pm прямо посреди работы, причём отказом, неотличимым от поломки.
 * Поэтому неизвестное семейство пропускается и логируется — это строго лучше
 * нынешнего состояния, где не проверяется ВООБЩЕ ничего, и не создаёт новых
 * отказов. Закрывается расширением таблицы ниже, а не сменой поведения по умолчанию.
 *
 * <p><b>Таблица — копия матрицы из админ-панели</b> ({@code LoreAdminPanel.tsx},
 * {@code REVERSE_MATRIX}). Расхождение двух копий = права в UI показываются не те,
 * что применяются. Пиновано тестом {@code AgentScopeFilterTest}.
 */
@Provider
@Priority(Priorities.AUTHENTICATION + 200)
public class AgentScopeFilter implements ContainerRequestFilter {

    private static final Logger LOG = Logger.getLogger(AgentScopeFilter.class);

    /** Семейства, закрытые для агентов совсем — их правит только человек. */
    private static final Set<String> HUMAN_ONLY = Set.of("dict", "kc");

    /**
     * Семейство → профили, которым разрешена запись. Ключ — первый сегмент пути
     * после {@code /lore/}. Значения без префикса {@code agent-}.
     */
    private static final Map<String, Set<String>> FAMILY_AGENTS = Map.ofEntries(
        Map.entry("adr",       Set.of("full", "architect")),
        Map.entry("decision",  Set.of("full", "architect")),
        Map.entry("spec",      Set.of("full", "architect", "developer", "marketer")),
        Map.entry("runbook",   Set.of("full", "architect", "developer", "marketer")),
        Map.entry("doc",       Set.of("full", "architect", "developer", "marketer")),
        Map.entry("sprint",    Set.of("full", "pm")),
        Map.entry("milestone", Set.of("full", "pm")),
        Map.entry("phase",     Set.of("full", "pm")),
        Map.entry("task",      Set.of("full", "pm", "developer", "tester", "marketer", "analyst")),
        Map.entry("status",    Set.of("full", "pm", "developer", "tester", "marketer", "analyst")),
        Map.entry("release",   Set.of("full", "developer")),
        Map.entry("qg",        Set.of("full", "tester")),
        Map.entry("question",  Set.of("full", "architect", "analyst", "pm")),
        Map.entry("metric",    Set.of("full", "analyst")),
        Map.entry("insight",   Set.of("full", "analyst")),
        Map.entry("rec",       Set.of("full", "analyst")));

    /** Методы, которые ничего не меняют — вне проверки. */
    private static final Set<String> READ_METHODS = Set.of("GET", "HEAD", "OPTIONS");

    /** Чтобы «семейство вне матрицы» логировалось один раз, а не на каждый запрос. */
    private final Set<String> loggedUnlisted = ConcurrentHashMap.newKeySet();

    @Inject
    SecurityIdentity identity;

    @ConfigProperty(name = "quarkus.oidc.enabled", defaultValue = "false")
    boolean oidcEnabled;

    @Override
    public void filter(ContainerRequestContext ctx) {
        if (!oidcEnabled) return;                       // dev/local — токенов нет вовсе
        if (READ_METHODS.contains(ctx.getMethod())) return;
        if (identity == null || identity.isAnonymous()) return;  // отказ — забота первой оси

        String scope = agentScope();
        if (scope == null) return;                      // человек, а не агент

        String family = familyOf(ctx.getUriInfo().getPath());
        if (family == null) return;

        if (HUMAN_ONLY.contains(family)) {
            deny(ctx, scope, family, "это семейство правит только человек");
            return;
        }
        Set<String> allowed = FAMILY_AGENTS.get(family);
        if (allowed == null) {
            if (loggedUnlisted.add(family)) {
                LOG.infof("[agent-scope] семейство '%s' вне матрицы прав — пропускаю. "
                    + "Закрыть = добавить строку в FAMILY_AGENTS и в REVERSE_MATRIX админки", family);
            }
            return;
        }
        if (!allowed.contains(scope)) {
            deny(ctx, scope, family, "профилю доступны: " + String.join(", ", allowed));
        }
    }

    /**
     * Значение {@code agent_scope} без префикса {@code agent-}, либо null для человека.
     * Клейм многозначный (client-роли), но профиль у токена ровно один — берём первый
     * подходящий, а не склеиваем: два профиля в одном токене означали бы ошибку
     * провижининга, и молча выбирать «самый широкий» было бы опаснее, чем отказать.
     */
    private String agentScope() {
        if (!(identity.getPrincipal() instanceof JsonWebToken jwt)) return null;
        Object raw = jwt.getClaim("agent_scope");
        if (raw == null) return null;
        String first = null;
        if (raw instanceof Collection<?> c) {
            for (Object o : c) { first = String.valueOf(o); break; }
        } else {
            first = String.valueOf(raw);
        }
        if (first == null || first.isBlank()) return null;
        return first.startsWith("agent-") ? first.substring("agent-".length()) : first;
    }

    /** Первый сегмент после {@code lore/}: "lore/task/link" → "task". */
    static String familyOf(String path) {
        if (path == null) return null;
        String p = path.startsWith("/") ? path.substring(1) : path;
        if (!p.startsWith("lore/")) return null;
        String rest = p.substring("lore/".length());
        int slash = rest.indexOf('/');
        String head = slash < 0 ? rest : rest.substring(0, slash);
        return head.isBlank() ? null : head;
    }

    private void deny(ContainerRequestContext ctx, String scope, String family, String why) {
        // Профиль и семейство В ОТВЕТЕ намеренно: агент читает свои ошибки сам, и
        // «403 без объяснения» превращается в слепой перебор. Секретов здесь нет.
        LOG.warnf("[agent-scope] отказ: профиль '%s' → семейство '%s' (%s)", scope, family, why);
        ctx.abortWith(Response.status(Response.Status.FORBIDDEN)
            .type(MediaType.APPLICATION_JSON)
            .entity(new LoreResourceBase.LoreError("AGENT_SCOPE_FORBIDDEN",
                "профиль agent-" + scope + " не пишет в '" + family + "': " + why))
            .build());
    }

    /** Для preflight/тестов: какие семейства реально под контролем. */
    static List<String> enforcedFamilies() {
        return FAMILY_AGENTS.keySet().stream().sorted().toList();
    }

    static Set<String> humanOnlyFamilies() {
        return HUMAN_ONLY;
    }
}
