package studio.seer.heimdall.lore;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Optional;

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

    /**
     * DBR-01: способ входа в ArcadeDB. {@code basic} — user/пароль (сегодня root);
     * {@code token} — собственный API-токен приложения без права менять схему
     * (D-DB-ACCESS-SPLIT). Отката с token на basic НЕТ намеренно: общий кред и
     * есть анти-паттерн — неверный пароль любого сервиса запирал root всем
     * (прод лёг 31.07). Нет токена — запросы и readiness падают громко.
     */
    @ConfigProperty(name = "lore.mart.auth", defaultValue = "basic")
    String authMode = "basic";   // инициализатор — для экземпляров вне CDI (тесты)

    /** Ключ секрета токена (SecretProvider: env или Infisical). */
    @ConfigProperty(name = "lore.secrets.key.mart-token", defaultValue = "ARCADEDB_API_TOKEN")
    String tokenKey = "ARCADEDB_API_TOKEN";

    /** Токен к базе стенда Muninn (bench.mart.db) — токен ArcadeDB привязан к одной базе. */
    @ConfigProperty(name = "lore.secrets.key.mart-token-bench", defaultValue = "ARCADEDB_API_TOKEN_BENCH")
    String benchTokenKey = "ARCADEDB_API_TOKEN_BENCH";

    @Inject
    SecretProvider secrets;

    public String authMode() {
        return authMode;
    }

    public String user() {
        return user;
    }

    public String password() {
        return secrets.get(secretKey)
            .filter(v -> !v.isBlank())
            .orElse(passwordFromConfig);
    }

    /**
     * Готовый заголовок Authorization для запросов к :2480 (база lore.db).
     * Имя историческое: в режиме token это Bearer, а не Basic — все ~230 мест
     * вызова переключаются здесь, а не по одному.
     */
    public String basicAuth() {
        return header(authMode, user(), "token".equals(authMode) ? "" : password(), secrets.get(tokenKey));
    }

    /** То же для базы Muninn (bench.mart.db): у неё свой токен. */
    public String benchAuth() {
        return header(authMode, user(), "token".equals(authMode) ? "" : password(), secrets.get(benchTokenKey));
    }

    static String header(String mode, String user, String password, Optional<String> token) {
        if ("basic".equals(mode)) {
            return "Basic " + Base64.getEncoder().encodeToString(
                (user + ":" + password).getBytes(StandardCharsets.UTF_8));
        }
        if ("token".equals(mode)) {
            String t = token.map(String::trim).filter(v -> !v.isEmpty()).orElseThrow(() -> new IllegalStateException(
                "[LORE MART] lore.mart.auth=token, но токен не задан (ARCADEDB_API_TOKEN / ARCADEDB_API_TOKEN_BENCH) — "
                + "отката на root нет намеренно (DBR-01); выпустите токен или верните lore.mart.auth=basic"));
            return "Bearer " + t;
        }
        throw new IllegalStateException("[LORE MART] lore.mart.auth=" + mode + " — допустимо basic или token");
    }
}
