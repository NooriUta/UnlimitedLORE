package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * S7A-12 серверная просьба A (UC-ADMIN-NEW-MACHINE, SPRINT_UXR_S7B_ADMIN/S7B-04):
 * учётка агента в Keycloak создаётся из админки по шаблону профиля, а не руками в консоли.
 * clientId = lore-mcp-&lt;profile&gt;_&lt;machine&gt;; шаблон — клиент lore-mcp-&lt;profile&gt;.
 * Здесь — чистые части: имя и очистка шаблона (KC в CI нет).
 */
class LoreKcAgentClientTest {

    @Test
    void clientIdFromProfileAndMachine() {
        assertEquals("lore-mcp-full_arharaga", LoreKcAgentClient.clientId("full", "arharaga"));
        assertEquals("lore-mcp-full", LoreKcAgentClient.templateId("full"));
        assertThrows(IllegalArgumentException.class, () -> LoreKcAgentClient.clientId("full", "bad id!"));
        assertThrows(IllegalArgumentException.class, () -> LoreKcAgentClient.clientId("", "arharaga"));
        assertThrows(IllegalArgumentException.class, () -> LoreKcAgentClient.clientId("full", null));
    }

    @Test
    void templateIsCopiedWithoutIdentityAndSecret() {
        JsonObject template = JsonObject.of(
            "id", "tpl-uuid", "clientId", "lore-mcp-full", "name", "LORE MCP full", "secret", "TEMPLATE-SECRET",
            "enabled", true, "publicClient", false, "serviceAccountsEnabled", true,
            "registeredNodes", JsonObject.of("n", 1),
            "attributes", JsonObject.of("access.token.lifespan", "300"),
            "protocolMappers", JsonArray.of(JsonObject.of("id", "m-uuid", "name", "aud", "protocol", "openid-connect")),
            "defaultClientScopes", JsonArray.of("profile"));
        JsonObject copy = LoreKcAgentClient.fromTemplate(template, "lore-mcp-full_arharaga");
        assertEquals("lore-mcp-full_arharaga", copy.getString("clientId"));
        assertFalse(copy.containsKey("id"), "id шаблона не переносится — иначе KC перезапишет шаблон");
        assertFalse(copy.containsKey("secret"), "секрет шаблона не переносится — KC выдаст новый");
        assertFalse(copy.containsKey("registeredNodes"));
        assertTrue(copy.getBoolean("enabled"));
        assertTrue(copy.getBoolean("serviceAccountsEnabled"));
        assertEquals("300", copy.getJsonObject("attributes").getString("access.token.lifespan"), "настройки шаблона сохранены");
        assertFalse(copy.getJsonArray("protocolMappers").getJsonObject(0).containsKey("id"), "id мапперов не переносятся");
        assertEquals("aud", copy.getJsonArray("protocolMappers").getJsonObject(0).getString("name"));
        assertTrue(template.containsKey("id"), "шаблон не изменён");
    }

    @Test
    void kcForbiddenIsExplainedNotHidden() {
        String hint = LoreKcAgentClient.forbiddenHint(403);
        assertNotNull(hint);
        assertTrue(hint.contains("manage-clients"), "403 — назвать недостающую роль lore-admin: " + hint);
        assertNull(LoreKcAgentClient.forbiddenHint(201));
    }
}
