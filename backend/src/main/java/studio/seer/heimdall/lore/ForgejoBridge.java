package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Серверный Forgejo-клиент (ADR-LORE-024, FJ-02). Тот же паттерн, что KcBridge:
 * секрет только через {@link SecretProvider} (ключ {@code FORGEJO_API_TOKEN}),
 * наружу не отдаётся и не логируется; без секрета мост «не сконфигурирован» —
 * потребители отвечают 503 (pluggable-модуль: у заказчика без self-hosted
 * Forgejo LORE работает как раньше).
 *
 * owner/repo НЕ конфигурируются отдельно — резолвятся из
 * {@code KnowGitProject.hosts[]} primary base_url (OQ-024-OWNER-REPO, дефолт):
 * {@code http://localhost:3030/AIDA/UnlimitedLORE} → api=http://localhost:3030,
 * owner=AIDA, repo=UnlimitedLORE. Один источник правды о том, где живёт репо.
 */
@ApplicationScoped
public class ForgejoBridge {

    static final String FORGEJO_TOKEN_KEY = "FORGEJO_API_TOKEN";

    private static final Logger LOG = Logger.getLogger(ForgejoBridge.class);
    private static final HttpClient HTTP = HttpClient.newHttpClient();

    /** Статусная модель ADR-024 §10 — мост отдаёт ТОЛЬКО эти значения. */
    static final String NO_RUN = "NO_RUN";
    static final String PENDING = "PENDING";
    static final String GREEN = "GREEN";
    static final String RED = "RED";
    static final String UNKNOWN = "UNKNOWN";
    static final String STALLED = "STALLED";

    /** Grace-окно регистрации рана (§10: «рана ещё нет» ≠ «CI мёртв»). */
    @ConfigProperty(name = "lore.forgejo.grace-seconds", defaultValue = "300")
    long graceSeconds;

    /**
     * Переопределение API-адреса primary-хоста. base_url в hosts[] — адрес для
     * ХОСТА разработчика (http://localhost:3030); из контейнера backend'а
     * localhost — сам контейнер, поэтому Docker-стенд задаёт
     * {@code lore.forgejo.base-override=http://forgejo:3030} (extra_host →
     * host-gateway). owner/repo при этом продолжают резолвиться из hosts[].
     */
    @ConfigProperty(name = "lore.forgejo.base-override")
    java.util.Optional<String> baseOverride;

    @Inject
    SecretProvider secrets;

    @Inject
    LoreIngestService ingest;

    boolean configured() { return secrets.has(FORGEJO_TOKEN_KEY); }

    private String token() { return secrets.get(FORGEJO_TOKEN_KEY).orElseThrow(); }

    /** Адресация репозитория, выведенная из KnowGitProject.hosts[] primary. */
    record Repo(String apiBase, String owner, String name) {
        String path() { return owner + "/" + name; }
    }

    /**
     * Резолв slug → Repo из hosts[] primary. Empty, когда проект не зарегистрирован,
     * hosts пуст или base_url не парсится — вызывающий отвечает 404/400, никакой
     * тихой подстановки дефолтов (урок lore_git_project_registration: тихий no-op
     * хуже честной ошибки).
     */
    Optional<Repo> resolve(String gitProjectSlug) {
        try {
            List<Map<String, Object>> rows = ingest.queryPublic(
                "SELECT hosts FROM KnowGitProject WHERE slug=:slug", Map.of("slug", gitProjectSlug));
            if (rows.isEmpty()) return Optional.empty();
            Optional<JsonObject> primary = primaryHost(rows.get(0).get("hosts"));
            if (primary.isEmpty()) return Optional.empty();
            URI base = URI.create(primary.get().getString("base_url", ""));
            String[] seg = base.getPath().replaceAll("^/|/$", "").split("/");
            if (seg.length < 2) return Optional.empty();
            // Override — только для localhost-адресов: у проектов с primary на
            // внешнем хостинге (github.com и т.п.) адрес остаётся как в hosts[].
            boolean isLocal = "localhost".equals(base.getHost()) || "127.0.0.1".equals(base.getHost());
            String apiBase = isLocal
                ? baseOverride.filter(v -> !v.isBlank()).orElse(base.getScheme() + "://" + base.getAuthority())
                : base.getScheme() + "://" + base.getAuthority();
            return Optional.of(new Repo(apiBase.replaceAll("/$", ""), seg[seg.length - 2], seg[seg.length - 1]));
        } catch (Exception e) {
            LOG.warnf("[FORGEJO] resolve %s: %s", gitProjectSlug, e.getMessage());
            return Optional.empty();
        }
    }

    /** primary-хост из hosts[] (JSON-строка); empty — hosts нет, не JSON или primary не объявлен. */
    static Optional<JsonObject> primaryHost(Object hostsRaw) {
        if (hostsRaw == null) return Optional.empty();
        try {
            JsonArray hosts = new JsonArray(hostsRaw.toString());
            for (int i = 0; i < hosts.size(); i++) {
                JsonObject h = hosts.getJsonObject(i);
                if ("primary".equals(h.getString("role"))) return Optional.of(h);
            }
        } catch (Exception e) {
            return Optional.empty();
        }
        return Optional.empty();
    }

    /** «owner/repo» primary-репозитория — то, что Forgejo показывает в адресе. */
    static Optional<String> primaryRepoPath(Object hostsRaw) {
        return primaryHost(hostsRaw).flatMap(h -> {
            try {
                String[] seg = URI.create(h.getString("base_url", "")).getPath().replaceAll("^/|/$", "").split("/");
                return seg.length < 2 ? Optional.empty() : Optional.of(seg[seg.length - 2] + "/" + seg[seg.length - 1]);
            } catch (Exception e) {
                return Optional.empty();
            }
        });
    }

    /**
     * SE-14: слаги проектов, чей primary-репозиторий — ровно этот путь. Нужен
     * только для подсказки в ошибке: путь репозитория как слаг молча НЕ
     * принимается — слаг ключ записей (PR, релизы, required_checks), подстановка
     * разнесла бы их под разные ключи. Регистр игнорируется, как у Forgejo.
     */
    static List<String> slugsForRepoPath(String repoPath, Map<String, Object> hostsBySlug) {
        List<String> out = new java.util.ArrayList<>();
        hostsBySlug.forEach((slug, hosts) -> primaryRepoPath(hosts)
            .filter(p -> p.equalsIgnoreCase(repoPath))
            .ifPresent(p -> out.add(slug)));
        return out;
    }

    List<String> slugsForRepoPath(String repoPath) {
        try {
            Map<String, Object> bySlug = new java.util.LinkedHashMap<>();
            for (Map<String, Object> r : ingest.queryPublic("SELECT slug, hosts FROM KnowGitProject", Map.of()))
                if (r.get("slug") != null) bySlug.put(r.get("slug").toString(), r.get("hosts"));
            return slugsForRepoPath(repoPath, bySlug);
        } catch (Exception e) {
            LOG.warnf("[FORGEJO] slugsForRepoPath %s: %s", repoPath, e.getMessage());
            return List.of();
        }
    }

    /**
     * Текст 404 PROJECT_NOT_RESOLVABLE. Совет «зарегистрируйте» уместен, только
     * когда проекта действительно нет: на путь репозитория уже зарегистрированного
     * проекта он ведёт к дублю KnowGitProject на тот же репозиторий.
     */
    static String notResolvableDetail(String given, List<String> slugsForPath) {
        if (!slugsForPath.isEmpty())
            return "'" + given + "' — путь репозитория в Forgejo, а не слаг проекта. Он зарегистрирован под слагом "
                + String.join(", ", slugsForPath) + " — передайте его в git_project; регистрировать заново не нужно";
        return "KnowGitProject '" + given + "' отсутствует или hosts[] без primary base_url — "
            + "зарегистрируйте проект (project_new) с hosts";
    }

    /**
     * required-чеки проекта (решение 135): поле {@code required_checks} на
     * KnowGitProject (JSON-массив или CSV). Пусто → «все обнаруженные контексты
     * required» (консервативный дефолт: неизвестный чек не пропускается молча).
     */
    Set<String> requiredChecks(String gitProjectSlug) {
        try {
            List<Map<String, Object>> rows = ingest.queryPublic(
                "SELECT required_checks FROM KnowGitProject WHERE slug=:slug", Map.of("slug", gitProjectSlug));
            if (rows.isEmpty() || rows.get(0).get("required_checks") == null) return Set.of();
            String raw = rows.get(0).get("required_checks").toString().trim();
            if (raw.isEmpty()) return Set.of();
            java.util.HashSet<String> out = new java.util.HashSet<>();
            if (raw.startsWith("[")) {
                JsonArray arr = new JsonArray(raw);
                for (int i = 0; i < arr.size(); i++) out.add(arr.getString(i));
            } else {
                for (String s : raw.split(",")) if (!s.isBlank()) out.add(s.trim());
            }
            return out;
        } catch (Exception e) {
            return Set.of();
        }
    }

    /** Вызов Forgejo API (Gitea-совместимый, /api/v1). Токен — только в заголовке, не в логах. */
    HttpResponse<String> api(Repo repo, String method, String path, String json) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(repo.apiBase() + "/api/v1" + path))
            .header("Authorization", "token " + token())
            .header("Accept", "application/json");
        if (json != null) b.header("Content-Type", "application/json");
        b.method(method, json == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json));
        return HTTP.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }

    /**
     * Чистая функция гейта §10 — юнит-тестируема без Forgejo (FJ-07).
     *
     * @param statusByContext контекст → state Forgejo commit-status
     *                        (success|failure|error|pending|warning)
     * @param required        required-контексты; пусто = все обнаруженные required
     * @param ageSeconds      сколько секунд прошло с head-коммита/создания PR
     * @param graceSeconds    grace-окно регистрации рана
     * @param upstreamFailed  запрос статусов не удался (503/сеть/права) → UNKNOWN
     * @return ровно один из NO_RUN/PENDING/GREEN/RED/UNKNOWN/STALLED
     */
    static String gateStatus(Map<String, String> statusByContext, Set<String> required,
                             long ageSeconds, long graceSeconds, boolean upstreamFailed) {
        if (upstreamFailed) return UNKNOWN;
        if (statusByContext.isEmpty()) {
            // §10: «рана ещё нет» ≠ «рана не будет» — но после grace-окна это STALLED.
            return ageSeconds > graceSeconds ? STALLED : NO_RUN;
        }
        Set<String> gate = required.isEmpty() ? statusByContext.keySet() : required;
        boolean anyRed = false, anyPendingOrMissing = false;
        for (String ctx : gate) {
            String st = statusByContext.get(ctx);
            if (st == null) { anyPendingOrMissing = true; continue; } // required-ран ещё не зарегистрирован
            switch (st) {
                case "success" -> { }
                case "failure", "error" -> anyRed = true;
                default -> anyPendingOrMissing = true;               // pending / warning / прочее
            }
        }
        if (anyRed) return RED;                                      // красный сильнее pending: чинить уже есть что
        if (anyPendingOrMissing) return PENDING;
        return GREEN;
    }

    /** true только когда merge разрешён (§10: только из GREEN). */
    static boolean mergeAllowed(String gateStatus) { return GREEN.equals(gateStatus); }

    /**
     * SE-09: цеплять ли PR к автоматически выбранному релизу после слияния.
     *
     * <p>Признак «вышел» — тег в РЕПОЗИТОРИИ, а не поле тега у релиза: план
     * может нести имя тега заранее, и правило по полю отказало бы ровно там,
     * где цеплять надо, — у ещё не вырезанного релиза. Поле может опережать
     * факт; репозиторий — нет.
     *
     * <p>Неизвестность («проверить не удалось», любой не-200/404 ответ) — это
     * НЕ «тега нет»: не цепляем и говорим почему. Неверная привязка хуже
     * отсутствующей — отсутствие видно и чинится, неверная выглядит сделанной
     * работой.
     *
     * @param releaseGitTag   тег релиза или null, если релиз его не несёт
     * @param tagLookupStatus HTTP-код проверки тега в репозитории; null — проверка не состоялась
     */
    static AutoLinkDecision autoLinkDecision(String releaseGitTag, Integer tagLookupStatus) {
        if (releaseGitTag == null || releaseGitTag.isBlank()) return new AutoLinkDecision(true, null);
        if (tagLookupStatus == null)
            return new AutoLinkDecision(false, "не удалось проверить, стоит ли тег " + releaseGitTag
                + " в репозитории — не цепляю: неверная привязка хуже отсутствующей; release_link руками");
        if (tagLookupStatus == 200)
            return new AutoLinkDecision(false, "релиз " + releaseGitTag + " уже выпущен (тег стоит в репозитории) — "
                + "правка в него физически не входит; привяжите её к следующему релизу");
        if (tagLookupStatus == 404) return new AutoLinkDecision(true, null);
        return new AutoLinkDecision(false, "Forgejo ответил " + tagLookupStatus + " на проверку тега " + releaseGitTag
            + " — это «не знаем», а не «тега нет»; не цепляю, release_link руками");
    }

    /** Решение автопривязки: цеплять ли и, если нет, — почему (причина обязательна). */
    record AutoLinkDecision(boolean link, String reason) {}
}
