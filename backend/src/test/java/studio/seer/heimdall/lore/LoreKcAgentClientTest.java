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

    /**
     * Ревью 10.11, B8: роль agent-&lt;profile&gt; выдана сервисной учётке шаблона КЛИЕНТСКОЙ ролью
     * (kc-provision-agents.js), а копировались только realm-роли — свежая машинная учётка
     * получала пустой agent_scope. Клиентские роли из clientMappings переносятся все, кроме
     * служебных ролей самого KC.
     */
    @Test
    void clientRolesOfTemplateServiceAccountAreCopied() {
        JsonObject mappings = new JsonObject()
            .put("realmMappings", new JsonArray().add(new JsonObject().put("name", "lore-admin")))
            .put("clientMappings", new JsonObject()
                .put("lore-mcp-full", new JsonObject().put("id", "uuid-tpl").put("client", "lore-mcp-full")
                    .put("mappings", new JsonArray().add(new JsonObject().put("id", "r1").put("name", "agent-full"))))
                .put("realm-management", new JsonObject().put("id", "uuid-rm").put("client", "realm-management")
                    .put("mappings", new JsonArray().add(new JsonObject().put("id", "r2").put("name", "manage-clients")))));
        java.util.Map<String, JsonArray> g = LoreKcAgentClient.clientRoleGrants(mappings);
        assertEquals(java.util.Set.of("uuid-tpl"), g.keySet(), "служебные роли KC (realm-management) не копируются");
        assertEquals("agent-full", g.get("uuid-tpl").getJsonObject(0).getString("name"));
        assertTrue(LoreKcAgentClient.clientRoleGrants(new JsonObject()).isEmpty(), "нет clientMappings — нечего копировать");
    }

    /** Ревью 10.11, B10: битое тело ответа KC (пустое, HTML) — нет id, а не 5xx на весь список агентов. */
    @Test
    void brokenServiceAccountBodyGivesNoIdInsteadOfCrash() {
        assertEquals("u1", LoreKcAgentClient.idOf("{\"id\":\"u1\"}"));
        assertNull(LoreKcAgentClient.idOf("<html>bad gateway</html>"));
        assertNull(LoreKcAgentClient.idOf(""));
        assertNull(LoreKcAgentClient.idOf(null));
    }

    /** Находка kit к #1077: тело role-mappings с 200, но битое (HTML от прокси) — null, а не 500 на создание учётки. */
    @Test
    void brokenRoleMappingsBodyIsNullNotCrash() {
        assertNotNull(LoreKcAgentClient.jsonOrNull("{\"clientMappings\":{}}"));
        assertNull(LoreKcAgentClient.jsonOrNull("<html>502</html>"));
        assertNull(LoreKcAgentClient.jsonOrNull(""));
    }

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
        // JsonObject.of держит не больше 10 пар — шаблон собирается put-ами.
        JsonObject template = new JsonObject()
            .put("id", "tpl-uuid").put("clientId", "lore-mcp-full").put("name", "LORE MCP full")
            .put("secret", "TEMPLATE-SECRET").put("enabled", true).put("publicClient", false)
            .put("serviceAccountsEnabled", true).put("registeredNodes", JsonObject.of("n", 1))
            .put("attributes", JsonObject.of("access.token.lifespan", "300"))
            .put("protocolMappers", JsonArray.of(JsonObject.of("id", "m-uuid", "name", "aud", "protocol", "openid-connect")))
            .put("defaultClientScopes", JsonArray.of("profile"));
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
