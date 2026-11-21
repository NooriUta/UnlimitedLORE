package studio.seer.heimdall.lore;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Optional;

/**
 * SPRINT_LORE_OWN_HOST/OH-MCP-HOSTED-SWITCH (1.18.2): запись секрета учётки MCP в Infisical (проект
 * lore-mcp-secrets) — обвязка {@link McpSecretsInfisical} настройкой и HTTP. Настройка
 * {@code lore.mcp-secrets.*} (env {@code LORE_MCP_SECRETS_URL/CLIENT_ID/CLIENT_SECRET/PROJECT_ID/ENVIRONMENT/PATH}),
 * все поля необязательны: не задано — «запись в Infisical не настроена», старт бэкенда не падает.
 * Учётка записи — сначала через SecretProvider (ключи LORE_MCP_SECRETS_CLIENT_ID/_SECRET в lore-secrets),
 * env/настройка — запасной путь. Значения секретов не логируются.
 */
@ApplicationScoped
public class McpSecretsWriter {

    private static final Logger LOG = Logger.getLogger(McpSecretsWriter.class);
    private static final LoreHttpClients.Shared HTTP = LoreHttpClients.shared(
        () -> HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)));

    @ConfigProperty(name = "lore.mcp-secrets.url")
    Optional<String> url;
    @ConfigProperty(name = "lore.mcp-secrets.client-id")
    Optional<String> clientId;
    @ConfigProperty(name = "lore.mcp-secrets.client-secret")
    Optional<String> clientSecret;
    @ConfigProperty(name = "lore.mcp-secrets.project-id")
    Optional<String> projectId;
    @ConfigProperty(name = "lore.mcp-secrets.environment", defaultValue = "prod")
    String environment;
    @ConfigProperty(name = "lore.mcp-secrets.path", defaultValue = "/")
    String path;

    @Inject
    SecretProvider secrets;

    McpSecretsInfisical.Config config() {
        return McpSecretsInfisical.config(url, clientId, clientSecret, projectId, environment, path, k -> {
            try { return secrets.get(k); } catch (RuntimeException e) { return Optional.empty(); }
        });
    }

    /** Записать секрет под ключом; итог — без значения. Сбой — громко в журнал (имя ключа и причина). */
    McpSecretsInfisical.Result write(String key, String value) {
        McpSecretsInfisical.Result r = McpSecretsInfisical.write(config(), key, value, McpSecretsWriter::send);
        if ("failed".equals(r.state())) LOG.errorf("[LORE MCP SECRETS] секрет %s НЕ записан в Infisical: %s", key, r.reason());
        else if ("written".equals(r.state())) LOG.infof("[LORE MCP SECRETS] секрет %s записан в Infisical", key);
        return r;
    }

    private static McpSecretsInfisical.Resp send(String method, String u, String bearer, String json) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(u)).timeout(Duration.ofSeconds(15))
            .header("Content-Type", "application/json")
            .method(method, HttpRequest.BodyPublishers.ofString(json == null ? "" : json));
        if (bearer != null) b.header("Authorization", "Bearer " + bearer);
        HttpResponse<String> r = HTTP.get().send(b.build(), HttpResponse.BodyHandlers.ofString());
        return new McpSecretsInfisical.Resp(r.statusCode(), r.body());
    }
}
