package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.function.Function;

/**
 * SPRINT_LORE_OWN_HOST/OH-MCP-HOSTED-SWITCH (1.18.2) — запись секрета учётки MCP в Infisical после выпуска
 * учётки и смены секрета. Чистая часть: настройка, вход, upsert. API тот же, что у установщика
 * ({@code scripts/model-migration/infisical.mjs}): {@code POST /api/v1/auth/universal-auth/login}, затем
 * {@code PATCH /api/v4/secrets/<ключ>}, а если секрета ещё нет (404) — {@code POST} туда же.
 *
 * <p>Учётка записи (identity lore-backend-mcp-secrets) — СНАЧАЛА из SecretProvider по ключам
 * {@code LORE_MCP_SECRETS_CLIENT_ID} / {@code LORE_MCP_SECRETS_CLIENT_SECRET} (они лежат в lore-secrets),
 * запасной путь — настройка {@code lore.mcp-secrets.client-id/client-secret}. Адрес, проект, окружение
 * и путь — из настройки: они не секрет.
 *
 * <p>Значение секрета не попадает ни в причину, ни в журнал.
 */
final class McpSecretsInfisical {

    private McpSecretsInfisical() {}

    static final String KEY_CLIENT_ID = "LORE_MCP_SECRETS_CLIENT_ID";
    static final String KEY_CLIENT_SECRET = "LORE_MCP_SECRETS_CLIENT_SECRET";

    record Config(String url, String clientId, String clientSecret, String projectId, String environment, String path) {}

    /** state: written | not_configured | failed | no_key. */
    record Result(boolean written, String state, String reason) {}

    record Resp(int status, String body) {}

    /** Один HTTP-вызов: метод, адрес, bearer (null — без него), тело JSON. */
    @FunctionalInterface
    interface Http {
        Resp send(String method, String url, String bearer, String json) throws Exception;
    }

    static Config config(Optional<String> url, Optional<String> cfgClientId, Optional<String> cfgClientSecret,
                         Optional<String> projectId, String environment, String path,
                         Function<String, Optional<String>> secrets) {
        String id = nonBlank(secrets.apply(KEY_CLIENT_ID)).or(() -> nonBlank(cfgClientId)).orElse(null);
        String sec = nonBlank(secrets.apply(KEY_CLIENT_SECRET)).or(() -> nonBlank(cfgClientSecret)).orElse(null);
        return new Config(nonBlank(url).orElse(null), id, sec, nonBlank(projectId).orElse(null),
            environment == null || environment.isBlank() ? "prod" : environment.trim(),
            path == null || path.isBlank() ? "/" : path.trim());
    }

    private static Optional<String> nonBlank(Optional<String> v) {
        return v == null ? Optional.empty() : v.map(String::trim).filter(s -> !s.isEmpty());
    }

    /** Чего не хватает (имена настроек, не значения); null — настроено. */
    static String missing(Config c) {
        List<String> m = new ArrayList<>();
        if (c.url() == null) m.add("LORE_MCP_SECRETS_URL");
        if (c.projectId() == null) m.add("LORE_MCP_SECRETS_PROJECT_ID");
        if (c.clientId() == null) m.add(KEY_CLIENT_ID);
        if (c.clientSecret() == null) m.add(KEY_CLIENT_SECRET);
        return m.isEmpty() ? null : String.join(", ", m);
    }

    static Result write(Config c, String key, String value, Http http) {
        if (key == null || key.isBlank())
            return new Result(false, "no_key", "у учётки нет ключа секрета по схеме harness (lore-mcp-<роль>[_<harness>]) — "
                + "в Infisical не записан, секрет показан один раз");
        String miss = missing(c);
        if (miss != null)
            return new Result(false, "not_configured", "запись в Infisical не настроена — секрет показан один раз (нет: " + miss + ")");
        String base = c.url().replaceAll("/+$", "");
        String token;
        try {
            Resp r = http.send("POST", base + "/api/v1/auth/universal-auth/login", null,
                new JsonObject().put("clientId", c.clientId()).put("clientSecret", c.clientSecret()).encode());
            if (r.status() != 200)
                return new Result(false, "failed", "вход машинной учётки в Infisical не принят: HTTP " + r.status());
            token = new JsonObject(r.body()).getString("accessToken");
            if (token == null || token.isBlank())
                return new Result(false, "failed", "Infisical принял вход, но не вернул accessToken");
        } catch (Exception e) {
            return new Result(false, "failed", "Infisical не ответил при входе: " + e.getClass().getSimpleName());
        }
        String body = new JsonObject().put("projectId", c.projectId()).put("environment", c.environment())
            .put("secretPath", c.path()).put("secretValue", value).encode();
        String url = base + "/api/v4/secrets/" + URLEncoder.encode(key, StandardCharsets.UTF_8);
        try {
            Resp r = http.send("PATCH", url, token, body);
            if (r.status() == 404) r = http.send("POST", url, token, body);
            if (r.status() < 300)
                return new Result(true, "written", "записан в Infisical ключом " + key
                    + " (окружение " + c.environment() + ", путь " + c.path() + ")");
            return new Result(false, "failed", "Infisical не принял запись " + key + ": HTTP " + r.status());
        } catch (Exception e) {
            return new Result(false, "failed", "Infisical не ответил при записи " + key + ": " + e.getClass().getSimpleName());
        }
    }

    /** Поля ответа выпуска/смены секрета. */
    static void putInto(java.util.Map<String, Object> out, Result r) {
        out.put("infisical_written", r.written());
        out.put("infisical_state", r.state());
        out.put("infisical_reason", r.reason());
    }
}
