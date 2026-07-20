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
        // developer заводит ADR (README профилей: adr_new) — решение владельца
        // 2026-07-18. Создание и правка неразделимы по пути: adr_new и adr_set
        // оба идут в POST /lore/adr (upsert). А вот разрушающие операции
        // разделимы, и они у developer'а изъяты — см. SUBPATH_AGENTS ниже.
        Map.entry("adr",       Set.of("full", "architect", "developer")),
        Map.entry("decision",  Set.of("full", "architect")),
        Map.entry("spec",      Set.of("full", "architect", "developer", "marketer")),
        Map.entry("runbook",   Set.of("full", "architect", "developer", "marketer")),
        Map.entry("doc",       Set.of("full", "architect", "developer", "marketer")),
        Map.entry("sprint",    Set.of("full", "pm")),
        Map.entry("milestone", Set.of("full", "pm")),
        Map.entry("phase",     Set.of("full", "pm")),
        // architect добавлен по решению владельца 2026-07-20. Причина не в
        // удобстве: по ADR-LORE-014 §4 архитектор фигурирует АВТОРОМ и
        // РЕВЬЮЕРОМ задач — а завести задачу или перевести её в done не мог.
        // Роль, которая принимает работу, но не может отметить приёмку,
        // недееспособна.
        //
        // Заодно снято живое противоречие между осями: в профиле architect
        // стоял `status_set: allow`, то есть профиль разрешал то, что фильтр
        // запрещал. Не задело никого лишь потому, что под этим профилем ещё
        // не работали — а проявилось бы как AGENT_SCOPE_FORBIDDEN на действии,
        // которое админка показывает разрешённым.
        Map.entry("task",      Set.of("full", "pm", "developer", "tester", "marketer", "analyst", "architect")),
        Map.entry("status",    Set.of("full", "pm", "developer", "tester", "marketer", "analyst", "architect")),
        Map.entry("release",   Set.of("full", "developer")),
        Map.entry("qg",        Set.of("full", "tester")),
        Map.entry("question",  Set.of("full", "architect", "analyst", "pm", "product-analyst")),
        Map.entry("metric",    Set.of("full", "analyst", "product-analyst")),
        Map.entry("insight",   Set.of("full", "analyst", "marketer", "product-analyst")),
        Map.entry("rec",       Set.of("full", "analyst", "marketer", "product-analyst")),
        // ── Продуктовый слой (ADR-LORE-022/030/032) ──────────────────────────
        // Владельцы по mcp-server/agent-profiles/README.md. Раньше эти семейства
        // были ВНЕ таблицы и пропускались как «неизвестные» — писать в них мог
        // любой профиль. Ключевой владелец, product-analyst, до этого коммита не
        // существовал в KC вовсе, хотя профиль был описан ещё в v1.0.53.
        Map.entry("feature",   Set.of("full", "architect", "pm", "product-analyst")),
        Map.entry("uc",        Set.of("full", "architect", "pm", "product-analyst")),
        Map.entry("pain",      Set.of("full", "architect", "pm", "product-analyst")),
        Map.entry("gain",      Set.of("full", "architect", "pm", "product-analyst")),
        Map.entry("job",       Set.of("full", "architect", "pm", "product-analyst")),
        Map.entry("vp",        Set.of("full", "architect", "pm", "product-analyst")),
        Map.entry("actor",     Set.of("full", "architect", "pm")),
        // ── Прочее из README, чего тоже не было ──────────────────────────────
        Map.entry("component", Set.of("full", "architect")),
        Map.entry("tech",      Set.of("full", "architect", "developer")),
        Map.entry("project",   Set.of("full", "architect", "pm")),
        Map.entry("bragi",     Set.of("full", "marketer")),
        // ── Найдено сверкой таблицы с реальными путями записи (AL-62) ────────
        // Три семейства имели живой POST под /lore, но в матрице отсутствовали,
        // то есть попадали в ветку «неизвестное — пропускаю». Права выставлены
        // ПО ФАКТУ, а не на глаз: forgejo_* и asset_* не разрешены ни в одном
        // ограниченном профиле (agent-profiles/*.json — у всех "*": "deny" плюс
        // allow-лист), у tester разрешён qg_*. Поэтому ни одна строка не
        // создаёт новых отказов — требование, которое фильтр сам себе ставит.
        //
        // forgejo: POST /lore/forgejo/pr и pr/{n}/merge. Мерж PR мог сделать
        // ЛЮБОЙ профиль, хотя ADR-LORE-024 прямо говорит «merge только full».
        // Отделить merge подпутём нельзя: subPathOf берёт два сегмента, и
        // forgejo/pr/{n}/merge сворачивается в forgejo/pr вместе с созданием PR.
        Map.entry("forgejo",   Set.of("full")),
        // asset: POST /lore/asset/upload, единственный вызывающий — asset_up.
        Map.entry("asset",     Set.of("full")),
        // quality-gate: СОЗДАНИЕ гейта. В таблице был только "qg" — прогоны и
        // рекомендации, — из-за чего получилось расщепление, которого никто не
        // задумывал: записать прогон нельзя, а завести сам гейт можно кому угодно.
        Map.entry("quality-gate", Set.of("full", "tester")));

    /**
     * Исключения УЖЕ семейства: конкретный подпуть с более узким списком.
     * Проверяется раньше семейства и только точным совпадением.
     *
     * <p>Нужны там, где «завести» и «снести» — разные по последствиям операции на
     * одном семействе. developer'у положено авторствовать ADR, но не удалять и не
     * переименовывать чужие: восстановление после ошибочного сноса стоит несопоставимо
     * дороже, чем сам снос, а отличить «ошибся» от «так и хотел» постфактум нельзя.
     */
    private static final Map<String, Set<String>> SUBPATH_AGENTS = Map.of(
        "adr/delete",   Set.of("full", "architect"),
        "adr/rename",   Set.of("full", "architect"),
        "spec/delete",  Set.of("full", "architect"),
        "doc/delete",   Set.of("full", "architect"));

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

        String path = ctx.getUriInfo().getPath();
        String family = familyOf(path);
        if (family == null) return;

        // Подпуть проверяется ПЕРВЫМ: он сужает права внутри разрешённого семейства.
        Set<String> narrowed = SUBPATH_AGENTS.get(subPathOf(path));
        if (narrowed != null && !narrowed.contains(scope)) {
            deny(ctx, scope, subPathOf(path), "разрушающая операция; доступна: " + String.join(", ", narrowed));
            return;
        }

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
            for (Object o : c) { first = unquote(String.valueOf(o)); break; }
        } else {
            first = unquote(String.valueOf(raw));
        }
        if (first == null || first.isBlank()) return null;
        return first.startsWith("agent-") ? first.substring("agent-".length()) : first;
    }

    /**
     * Снимает кавычки, которые приходят ВМЕСТЕ со значением из JSON-клейма.
     *
     * <p>Клейм многозначный, поэтому в токене это JSON-массив, а его элементы —
     * {@code JsonString}. У них {@code toString()} отдаёт значение <b>в кавычках</b>:
     * {@code "agent-full"}, а не {@code agent-full}. Без снятия кавычек проверка
     * {@code startsWith("agent-")} ниже не срабатывает, префикс остаётся, и скоуп
     * не совпадает ни с одной строкой матрицы — фильтр отсекает ВСЕХ агентов,
     * включая full.
     *
     * <p>Найдено первым же живым запросом после включения auth (2026-07-19):
     * <pre>AGENT_SCOPE_FORBIDDEN: профиль agent-"agent-full" не пишет в 'status'</pre>
     * Двойной префикс в сообщении и есть след необрезанных кавычек. Юнит-тесты
     * этого не ловили: они подставляли готовую строку, а не JSON-значение —
     * то есть проверяли таблицу прав, но не путь получения скоупа.
     *
     * <p>Снимаем именно так, а не приведением к {@code JsonString}: клейм может
     * прийти и обычной строкой (другой провайдер, другой маппер), и тогда
     * приведение упало бы. Обрезка кавычек верна в обоих случаях.
     */
    static String unquote(String s) {
        if (s == null) return null;
        return (s.length() >= 2 && s.charAt(0) == '"' && s.charAt(s.length() - 1) == '"')
            ? s.substring(1, s.length() - 1)
            : s;
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

    /** Два первых сегмента после {@code lore/}: "lore/adr/delete" → "adr/delete". */
    static String subPathOf(String path) {
        if (path == null) return "";
        String p = path.startsWith("/") ? path.substring(1) : path;
        if (!p.startsWith("lore/")) return "";
        String[] parts = p.substring("lore/".length()).split("/");
        return parts.length >= 2 ? parts[0] + "/" + parts[1] : "";
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
