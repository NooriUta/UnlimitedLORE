package studio.seer.heimdall.lore;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * Учётка к ArcadeDB (:2480) в одном месте.
 *
 * <p>До этого пароль инжектился {@code @ConfigProperty} в семь классов, и каждый
 * собирал Basic-auth своей приватной копией метода. Пока источник был один (env),
 * это было просто дублированием; как только источников стало два, дублирование
 * стало опасным — «перевести на секрет-сервис» означало бы семь синхронных
 * правок, и забытая седьмая молча ходила бы со старым паролем.
 *
 * <p><b>Два источника, в порядке приоритета:</b>
 * <ol>
 *   <li>{@link SecretProvider} по ключу {@code ARCADEDB_ROOT_PASSWORD} —
 *       при {@code lore.secrets.provider=infisical} это секрет-сервис;</li>
 *   <li>значение конфига {@code bench.mart.password} — то же, что было раньше
 *       (env/compose/.env).</li>
 * </ol>
 *
 * <p>Запасной источник оставлен НАМЕРЕННО и убирается не раньше, чем чтение из
 * секрет-сервиса подтверждено на живом стенде. Пароль БД, в отличие от секретов
 * мостов, несущий: без него не поднимается ничего, а не «одна ручка отвечает
 * 503». Пока обе строки на месте, недоступный Infisical не роняет старт.
 *
 * <p>Пароль НИКОГДА не логируется и наружу не отдаётся.
 */
@ApplicationScoped
public class MartCredentials {

    @ConfigProperty(name = "bench.mart.user", defaultValue = "root")
    String user;

    @ConfigProperty(name = "bench.mart.password", defaultValue = "")
    String passwordFromConfig;

    /**
     * DBR-06: КЛЮЧ секрета, а не сам секрет. Был захардкожен как
     * {@code ARCADEDB_ROOT_PASSWORD}, и это ломало разделение кредов ещё до
     * того, как оно началось: контейнер накатки ходит под root, приложение —
     * своим кредом, но оба читали бы ОДНО значение из хранилища, потому что
     * при провайдере Infisical секрет-сервис перекрывает env контейнера.
     * Два креда молча оказались бы одним, и деплой при этом был бы зелёным.
     */
    @ConfigProperty(name = "lore.secrets.key.mart-password", defaultValue = "ARCADEDB_ROOT_PASSWORD")
    String secretKey;

    @Inject
    SecretProvider secrets;

    public String user() {
        return user;
    }

    public String password() {
        return secrets.get(secretKey)
            .filter(v -> !v.isBlank())
            .orElse(passwordFromConfig);
    }

    /** Готовый заголовок Authorization для запросов к :2480. */
    public String basicAuth() {
        return "Basic " + Base64.getEncoder().encodeToString(
            (user() + ":" + password()).getBytes(StandardCharsets.UTF_8));
    }
}
