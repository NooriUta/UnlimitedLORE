package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

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

    // B8: agent-<profile> шаблону выдана клиентской ролью (kc-provision-agents.js), realm-копия
    // её не видела — свежая учётка жила с пустым agent_scope. Грант клиентских ролей шаблона
    // собирается с тем же фильтром служебных ролей KC, что и у realm-ролей.
    @Test
    void templateClientRolesBecomeGrantForNewAccount() {
        List<String> copied = new ArrayList<>();
        JsonArray grant = LoreKcResource.roleGrant(
            "[{\"id\":\"r1\",\"name\":\"agent-full\"},{\"id\":\"r2\",\"name\":\"custom-client-role\"}]", copied);
        assertEquals(2, grant.size());
        assertEquals(List.of("agent-full", "custom-client-role"), copied,
            "клиентские роли шаблона копируются на сервисную учётку нового клиента");
    }

    @Test
    void keycloakServiceClientRolesAreSkippedInGrant() {
        List<String> copied = new ArrayList<>();
        JsonArray grant = LoreKcResource.roleGrant(
            "[{\"id\":\"r1\",\"name\":\"agent-full\"},{\"id\":\"r2\",\"name\":\"default-roles-omilore\"}]", copied);
        assertEquals(1, grant.size());
        assertEquals("agent-full", grant.getJsonObject(0).getString("name"));
        assertEquals(List.of("agent-full"), copied);
    }

    @Test
    void brokenClientRoleMappingsGiveEmptyGrant() {
        List<String> copied = new ArrayList<>();
        assertTrue(LoreKcResource.roleGrant("not json", copied).isEmpty());
        assertTrue(LoreKcResource.roleGrant(null, copied).isEmpty());
        assertTrue(copied.isEmpty(), "битый ответ не должен оставлять имён в списке скопированных");
    }
}
