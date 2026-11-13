package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_PIPELINE_HOST/PL-MCP-CLIENT-MAPPERS — машинный клиент без маппера seer_roles:
 * бэкенд берёт роли только из claim seer_roles (role-claim-path), и клиент
 * lore-mcp-full_arharaga 08.11 получал 403 на любую запись при живом чтении.
 * Правило: клиент агента, заведённый по шаблону, несёт ОБА маппера — seer_roles (realm-роли)
 * и agent_scope (роли agent-&lt;профиль&gt; клиента-шаблона); отсутствующий дописывается, а
 * проверка токена новой учётки называет пропажу seer_roles отдельным исходом.
 */
class AgentClientMappersTest {

    private static JsonObject mapper(String name, String type, String claim) {
        return new JsonObject().put("id", "x-" + name).put("name", name).put("protocol", "openid-connect")
            .put("protocolMapper", type).put("config", new JsonObject().put("claim.name", claim));
    }

    private static long claims(JsonObject c, String claim) {
        JsonArray m = c.getJsonArray("protocolMappers", new JsonArray());
        return m.stream().map(o -> (JsonObject) o)
            .filter(o -> claim.equals(o.getJsonObject("config", new JsonObject()).getString("claim.name"))).count();
    }

    @Test
    void templateWithoutSeerRoles_newClientGetsBoth() {
        JsonObject tpl = new JsonObject().put("clientId", "lore-mcp-full")
            .put("protocolMappers", new JsonArray().add(mapper("agent_scope", "oidc-usermodel-client-role-mapper", "agent_scope")));
        JsonObject c = LoreKcAgentClient.fromTemplate(tpl, "lore-mcp-full_box");
        assertEquals(1, claims(c, "seer_roles"), "seer_roles не дописан");
        assertEquals(1, claims(c, "agent_scope"));
        JsonObject seer = c.getJsonArray("protocolMappers").stream().map(o -> (JsonObject) o)
            .filter(o -> "seer_roles".equals(o.getJsonObject("config").getString("claim.name"))).findFirst().orElseThrow();
        assertEquals("oidc-usermodel-realm-role-mapper", seer.getString("protocolMapper"));
        assertEquals("true", seer.getJsonObject("config").getString("access.token.claim"));
        assertEquals("true", seer.getJsonObject("config").getString("multivalued"));
    }

    @Test
    void templateWithoutAgentScope_newClientGetsItPointingAtTemplateRoles() {
        JsonObject tpl = new JsonObject().put("clientId", "lore-mcp-pm")
            .put("protocolMappers", new JsonArray().add(mapper("lore-realm-role-mapper", "oidc-usermodel-realm-role-mapper", "seer_roles")));
        JsonObject c = LoreKcAgentClient.fromTemplate(tpl, "lore-mcp-pm_box");
        assertEquals(1, claims(c, "agent_scope"));
        JsonObject as = c.getJsonArray("protocolMappers").stream().map(o -> (JsonObject) o)
            .filter(o -> "agent_scope".equals(o.getJsonObject("config").getString("claim.name"))).findFirst().orElseThrow();
        // роль agent-pm — клиентская роль ШАБЛОНА (её выдаёт копия ролей из шаблона)
        assertEquals("lore-mcp-pm", as.getJsonObject("config").getString("usermodel.clientRoleMapping.clientId"));
    }

    @Test
    void bothPresent_noDuplicates() {
        JsonObject tpl = new JsonObject().put("clientId", "lore-mcp-full").put("protocolMappers", new JsonArray()
            .add(mapper("agent_scope", "oidc-usermodel-client-role-mapper", "agent_scope"))
            .add(mapper("lore-realm-role-mapper", "oidc-usermodel-realm-role-mapper", "seer_roles")));
        JsonObject c = LoreKcAgentClient.fromTemplate(tpl, "lore-mcp-full_box");
        assertEquals(1, claims(c, "seer_roles"));
        assertEquals(1, claims(c, "agent_scope"));
        assertTrue(c.getJsonArray("protocolMappers").stream().noneMatch(o -> ((JsonObject) o).containsKey("id")));
    }

    private static String jwt(String payload) {
        Base64.Encoder e = Base64.getUrlEncoder().withoutPadding();
        return e.encodeToString("{}".getBytes(StandardCharsets.UTF_8)) + "." + e.encodeToString(payload.getBytes(StandardCharsets.UTF_8)) + ".s";
    }

    @Test
    void tokenCheck_scopeOkButNoSeerRoles_isItsOwnFailure() {
        assertEquals("no_seer_roles",
            LoreKcAgentClient.tokenCheck(jwt("{\"agent_scope\":[\"agent-full\"]}"), "full").get("state"));
        assertEquals("ok",
            LoreKcAgentClient.tokenCheck(jwt("{\"agent_scope\":[\"agent-full\"],\"seer_roles\":[\"admin\"]}"), "full").get("state"));
    }
}
