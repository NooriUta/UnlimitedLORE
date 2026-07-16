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
 *       Включается {@code lore.secrets.provider=infisical} + адрес/токен сервиса.</li>
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

    /** Токен доступа к секрет-сервису — сам живёт в env (bootstrap-секрет). */
    @ConfigProperty(name = "lore.secrets.token")
    Optional<String> serviceToken;

    /** Путь/скоуп проекта в секрет-сервисе. */
    @ConfigProperty(name = "lore.secrets.scope", defaultValue = "/lore")
    String scope;

    private final ConcurrentHashMap<String, String> cache = new ConcurrentHashMap<>();

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
        if (serviceUrl.isEmpty() || serviceToken.isEmpty()) {
            LOG.warn("[LORE secrets] провайдер=infisical, но lore.secrets.url/token не заданы — секреты недоступны");
            return Optional.empty();
        }
        try {
            HttpRequest req = HttpRequest.newBuilder(
                    URI.create(serviceUrl.get() + "/api/v3/secrets/raw/" + key + "?secretPath=" + scope))
                .header("Authorization", "Bearer " + serviceToken.get())
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
        } catch (Exception e) {
            LOG.warnf("[LORE secrets] сервис недоступен (%s) — %s не прочитан", e.getMessage(), key);
            return Optional.empty();
        }
    }
}
