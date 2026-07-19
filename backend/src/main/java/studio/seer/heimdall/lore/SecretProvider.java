package studio.seer.heimdall.lore;

import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.config.ConfigProvider;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Единая абстракция чтения секретов (ADR-LORE-025 D15): источник выбирается
 * конфигом, код не знает, откуда пришло значение.
 *
 * <ul>
 *   <li><b>env</b> (дефолт) — plain env/MicroProfile Config. Ничего не требует:
 *       заказчику без секрет-сервиса всё работает из коробки.</li>
 *   <li><b>infisical</b> — локальный секрет-сервис (вектор ADR-MT-011).
 *       Включается {@code lore.secrets.provider=infisical} + адрес сервиса.
 *       Аутентификация — одна из двух:
 *       <ul>
 *         <li><b>machine identity</b> (Universal Auth): {@code client-id} + {@code client-secret},
 *             плюс ОБЯЗАТЕЛЬНО {@code project-id} и {@code environment}. Единственный
 *             путь в свежих сборках Infisical;</li>
 *         <li><b>сервисный токен</b> {@code lore.secrets.token} — легаси, проект и
 *             окружение зашиты в сам токен. В новых сборках такие токены больше
 *             не выпускаются.</li>
 *       </ul></li>
 * </ul>
 *
 * Отсутствие ключа — не ошибка, а «не сконфигурировано»: {@link #get(String)}
 * возвращает {@link Optional#empty()}, а вызывающий (KC-мост, Forgejo-мост)
 * отвечает 503 «not configured» — pluggable-контракт D14.
 *
 * Значения секретов НИКОГДА не логируются.
 */
@ApplicationScoped
public class SecretProvider {

    private static final Logger LOG = Logger.getLogger(SecretProvider.class);
    private static final HttpClient HTTP = HttpClient.newHttpClient();

    @ConfigProperty(name = "lore.secrets.provider", defaultValue = "env")
    String provider;

    /** Базовый URL секрет-сервиса, напр. http://localhost:8222 (только для infisical). */
    @ConfigProperty(name = "lore.secrets.url")
    Optional<String> serviceUrl;

    /**
     * Сервисный токен — ЛЕГАСИ-путь. Такой токен носит проект и окружение в себе,
     * поэтому больше ничего указывать не нужно. В свежих сборках Infisical сервисные
     * токены убраны (в Project Settings нет ни вкладки, ни секции) — там заводится
     * machine identity, см. clientId/clientSecret ниже. Оставлено для совместимости
     * со старыми инстансами и тестами.
     */
    @ConfigProperty(name = "lore.secrets.token")
    Optional<String> serviceToken;

    /** Machine identity (Universal Auth) — вместо сервисного токена. */
    @ConfigProperty(name = "lore.secrets.client-id")
    Optional<String> clientId;

    @ConfigProperty(name = "lore.secrets.client-secret")
    Optional<String> clientSecret;

    /**
     * ID проекта и окружение. Для сервисного токена не нужны (он их несёт), для
     * machine identity ОБЯЗАТЕЛЬНЫ: выданный по логину access-token сам по себе не
     * говорит, из какого проекта читать, и без этих двух параметров сервис отвечает
     * 400 — симптом выглядит как «секрет не найден», хотя секрет на месте.
     */
    @ConfigProperty(name = "lore.secrets.project-id")
    Optional<String> projectId;

    @ConfigProperty(name = "lore.secrets.environment", defaultValue = "prod")
    String environment;

    /** Путь/скоуп проекта в секрет-сервисе. */
    @ConfigProperty(name = "lore.secrets.scope", defaultValue = "/lore")
    String scope;

    private final ConcurrentHashMap<String, String> cache = new ConcurrentHashMap<>();

    /** Access-token, полученный по Universal Auth. Живёт до истечения TTL. */
    private volatile String accessToken;
    private volatile long accessTokenExpiresAt;

    /**
     * Читает секрет по логическому имени (напр. {@code KC_ADMIN_CLIENT_SECRET}).
     * @return значение или empty, если не сконфигурировано/не найдено.
     */
    public Optional<String> get(String key) {
        String cached = cache.get(key);
        if (cached != null) return Optional.of(cached);

        Optional<String> val = "infisical".equalsIgnoreCase(provider) ? fromService(key) : fromEnv(key);
        val.ifPresent(v -> cache.put(key, v));
        if (val.isEmpty()) {
            LOG.debugf("[LORE secrets] %s не найден (провайдер=%s)", key, provider);
        }
        return val;
    }

    /** true, если ключ доступен — для pluggable-гейтов (503 при отсутствии). */
    public boolean has(String key) {
        return get(key).filter(v -> !v.isBlank()).isPresent();
    }

    /** Сбросить кэш (после ротации секрета). */
    public void invalidate(String key) { cache.remove(key); }

    private Optional<String> fromEnv(String key) {
        // MicroProfile Config сам покрывает env-переменные и application.properties.
        return ConfigProvider.getConfig().getOptionalValue(key, String.class)
            .or(() -> Optional.ofNullable(System.getenv(key)))
            .filter(v -> !v.isBlank());
    }

    private Optional<String> fromService(String key) {
        if (serviceUrl.isEmpty()) {
            LOG.warn("[LORE secrets] провайдер=infisical, но lore.secrets.url не задан — секреты недоступны");
            return Optional.empty();
        }
        try {
            Optional<String> bearer = bearer();
            if (bearer.isEmpty()) return Optional.empty();

            Optional<String> v = fetch(key, bearer.get());
            // 401 при живом access-token = он протух раньше заявленного TTL
            // (ротация identity, рестарт сервиса). Один раз перелогиниваемся и
            // повторяем — иначе мост «залипает» на 503 до рестарта бэкенда.
            if (v.isEmpty() && usesMachineIdentity() && accessToken != null) {
                accessToken = null;
                Optional<String> retryBearer = bearer();
                if (retryBearer.isPresent()) v = fetch(key, retryBearer.get());
            }
            return v;
        } catch (Exception e) {
            LOG.warnf("[LORE secrets] сервис недоступен (%s) — %s не прочитан", e.getMessage(), key);
            return Optional.empty();
        }
    }

    private boolean usesMachineIdentity() {
        return clientId.isPresent() && clientSecret.isPresent();
    }

    /** Токен для заголовка Authorization: сервисный (легаси) либо по Universal Auth. */
    private Optional<String> bearer() throws Exception {
        if (!usesMachineIdentity()) {
            if (serviceToken.isEmpty()) {
                LOG.warn("[LORE secrets] не задан ни lore.secrets.token, ни пара client-id/client-secret");
            }
            return serviceToken;
        }
        String tok = accessToken;
        if (tok != null && System.currentTimeMillis() < accessTokenExpiresAt) return Optional.of(tok);

        HttpRequest req = HttpRequest.newBuilder(URI.create(serviceUrl.get() + "/api/v1/auth/universal-auth/login"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(new io.vertx.core.json.JsonObject()
                .put("clientId", clientId.get())
                .put("clientSecret", clientSecret.get())
                .encode()))
            .build();
        HttpResponse<String> r = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
        if (r.statusCode() != 200) {
            LOG.warnf("[LORE secrets] Universal Auth login вернул %d — проверьте client-id/client-secret "
                + "и что identity добавлена в проект", r.statusCode());
            return Optional.empty();
        }
        io.vertx.core.json.JsonObject body = new io.vertx.core.json.JsonObject(r.body());
        String at = body.getString("accessToken");
        if (at == null || at.isBlank()) return Optional.empty();
        // Обновляемся заранее (минута запаса), чтобы не попасть в окно протухания.
        long ttlSec = body.getLong("expiresIn", 3600L);
        accessTokenExpiresAt = System.currentTimeMillis() + Math.max(0, ttlSec - 60) * 1000L;
        accessToken = at;
        return Optional.of(at);
    }

    private Optional<String> fetch(String key, String bearer) throws Exception {
        StringBuilder url = new StringBuilder(serviceUrl.get())
            .append("/api/v3/secrets/raw/").append(key)
            .append("?secretPath=").append(scope);
        if (usesMachineIdentity()) {
            if (projectId.isEmpty()) {
                LOG.warn("[LORE secrets] machine identity задана, но lore.secrets.project-id — нет; "
                    + "без него сервис не знает, из какого проекта читать");
                return Optional.empty();
            }
            url.append("&workspaceId=").append(projectId.get())
               .append("&environment=").append(environment);
        }
        HttpRequest req = HttpRequest.newBuilder(URI.create(url.toString()))
            .header("Authorization", "Bearer " + bearer)
            .GET().build();
        HttpResponse<String> r = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
        if (r.statusCode() != 200) {
            LOG.warnf("[LORE secrets] сервис вернул %d для %s", r.statusCode(), key);
            return Optional.empty();
        }
        String v = new io.vertx.core.json.JsonObject(r.body())
            .getJsonObject("secret", new io.vertx.core.json.JsonObject())
            .getString("secretValue");
        return Optional.ofNullable(v).filter(s -> !s.isBlank());
    }
}
