package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_OWN_HOST/OH-MCP-HOSTED-SWITCH (1.18.2): запись секрета учётки MCP в Infisical после выпуска
 * и смены секрета. Тот же API, что scripts/model-migration/infisical.mjs: universal-auth login →
 * PATCH /api/v4/secrets/&lt;ключ&gt;, на 404 — POST. HTTP — заглушка; значение секрета не попадает в причину.
 */
class McpSecretsInfisicalTest {

    private static final String VALUE = "sEcReT-vAlUe-42";

    private static McpSecretsInfisical.Config cfg() {
        return new McpSecretsInfisical.Config("http://inf.local/", "cid", "csec", "proj-1", "prod", "/");
    }

    record Call(String method, String url, String bearer, String body) {}

    @Test
    void notConfiguredSaysSoAndNamesMissingSettings() {
        McpSecretsInfisical.Config c = McpSecretsInfisical.config(Optional.empty(), Optional.empty(), Optional.empty(),
            Optional.empty(), "prod", "/", k -> Optional.empty());
        assertNull(c.url());
        McpSecretsInfisical.Result r = McpSecretsInfisical.write(c, "LORE_MCP_CLIENT_SECRET_TESTER", VALUE, (m, u, b, j) -> {
            throw new AssertionError("без настройки в сеть не ходим");
        });
        assertFalse(r.written());
        assertEquals("not_configured", r.state());
        assertTrue(r.reason().contains("не настроена"), r.reason());
        assertTrue(r.reason().contains("LORE_MCP_SECRETS_URL"), r.reason());
    }

    @Test
    void credentialsComeFromSecretProviderFirst() {
        Map<String, String> vault = Map.of("LORE_MCP_SECRETS_CLIENT_ID", "from-vault-id", "LORE_MCP_SECRETS_CLIENT_SECRET", "from-vault-secret");
        McpSecretsInfisical.Config c = McpSecretsInfisical.config(Optional.of("http://inf"), Optional.of("env-id"),
            Optional.of("env-secret"), Optional.of("p"), "prod", "/", k -> Optional.ofNullable(vault.get(k)));
        assertEquals("from-vault-id", c.clientId());
        assertEquals("from-vault-secret", c.clientSecret());
    }

    @Test
    void credentialsFallBackToConfigWhenSecretProviderHasNone() {
        McpSecretsInfisical.Config c = McpSecretsInfisical.config(Optional.of("http://inf"), Optional.of("env-id"),
            Optional.of("env-secret"), Optional.of("p"), "prod", "/", k -> Optional.empty());
        assertEquals("env-id", c.clientId());
        assertEquals("env-secret", c.clientSecret());
        assertNull(McpSecretsInfisical.missing(c));
    }

    @Test
    void patchExistingSecret() {
        List<Call> calls = new ArrayList<>();
        McpSecretsInfisical.Result r = McpSecretsInfisical.write(cfg(), "LORE_MCP_CLIENT_SECRET_TESTER", VALUE, (m, u, b, j) -> {
            calls.add(new Call(m, u, b, j));
            if (u.endsWith("/api/v1/auth/universal-auth/login")) return new McpSecretsInfisical.Resp(200, "{\"accessToken\":\"AT\"}");
            return new McpSecretsInfisical.Resp(200, "{}");
        });
        assertTrue(r.written(), r.reason());
        assertEquals("written", r.state());
        assertEquals(2, calls.size());
        assertEquals("POST", calls.get(0).method());
        assertEquals("http://inf.local/api/v1/auth/universal-auth/login", calls.get(0).url());
        assertTrue(calls.get(0).body().contains("\"clientId\":\"cid\""));
        assertEquals("PATCH", calls.get(1).method());
        assertEquals("http://inf.local/api/v4/secrets/LORE_MCP_CLIENT_SECRET_TESTER", calls.get(1).url());
        assertEquals("AT", calls.get(1).bearer());
        io.vertx.core.json.JsonObject body = new io.vertx.core.json.JsonObject(calls.get(1).body());
        assertEquals("proj-1", body.getString("projectId"));
        assertEquals("prod", body.getString("environment"));
        assertEquals("/", body.getString("secretPath"));
        assertEquals(VALUE, body.getString("secretValue"));
        assertFalse(r.reason().contains(VALUE));
    }

    @Test
    void missingSecretIsCreatedWithPost() {
        List<String> methods = new ArrayList<>();
        McpSecretsInfisical.Result r = McpSecretsInfisical.write(cfg(), "K", VALUE, (m, u, b, j) -> {
            if (u.endsWith("/login")) return new McpSecretsInfisical.Resp(200, "{\"accessToken\":\"AT\"}");
            methods.add(m);
            return new McpSecretsInfisical.Resp("PATCH".equals(m) ? 404 : 200, "{}");
        });
        assertTrue(r.written(), r.reason());
        assertEquals(List.of("PATCH", "POST"), methods);
    }

    @Test
    void loginRefusedIsFailedWithReasonAndNoValue() {
        McpSecretsInfisical.Result r = McpSecretsInfisical.write(cfg(), "K", VALUE,
            (m, u, b, j) -> new McpSecretsInfisical.Resp(401, "{\"message\":\"bad\"}"));
        assertFalse(r.written());
        assertEquals("failed", r.state());
        assertTrue(r.reason().contains("401"), r.reason());
        assertFalse(r.reason().contains(VALUE));
    }

    @Test
    void writeRefusedOrNetworkDownIsFailed() {
        McpSecretsInfisical.Result r = McpSecretsInfisical.write(cfg(), "K", VALUE, (m, u, b, j) -> {
            if (u.endsWith("/login")) return new McpSecretsInfisical.Resp(200, "{\"accessToken\":\"AT\"}");
            return new McpSecretsInfisical.Resp(403, "{}");
        });
        assertEquals("failed", r.state());
        assertTrue(r.reason().contains("403"), r.reason());

        McpSecretsInfisical.Result down = McpSecretsInfisical.write(cfg(), "K", VALUE, (m, u, b, j) -> {
            throw new java.net.ConnectException("Connection refused");
        });
        assertEquals("failed", down.state());
        assertTrue(down.reason().contains("не ответил"), down.reason());
    }

    @Test
    void noKeyIsNotWritten() {
        McpSecretsInfisical.Result r = McpSecretsInfisical.write(cfg(), null, VALUE, (m, u, b, j) -> {
            throw new AssertionError("без ключа в сеть не ходим");
        });
        assertEquals("no_key", r.state());
        assertFalse(r.written());
    }
}
