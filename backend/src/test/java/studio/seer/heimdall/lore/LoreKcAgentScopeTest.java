package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * SPRINT_UXR_S4_UI_SHELL_LISTS/S4-AGENT-CLIENT-PICK. Владелица 08.11: «админка не
 * доделана — привязать lore-mcp-full_arharaga к человеку».
 *
 * <p>Причина: {@code agent_scope} в {@code GET /kc/agents} собирался только из
 * СВОИХ ролей клиента ({@code /clients/{id}/roles}). Машинные клиенты
 * {@code lore-mcp-full_<машина>} своих ролей не имеют — {@code agent-full} им
 * выдана клиентской ролью клиента {@code lore-mcp-full} на их сервисную учётку.
 * Админка видела пустой {@code agent_scope}, помечала их «легаси» и не пускала
 * в «Учётку».
 *
 * <p>Правило: свои роли клиента ∪ клиентские роли сервисной учётки вида
 * {@code agent-*}. Служебные роли Keycloak (realm-management и т. п.) агента из
 * клиента не делают.
 */
class LoreKcAgentScopeTest {

    private static final String SA_AGENT_FULL = """
        {"realmMappings":[{"name":"default-roles-omilore"}],
         "clientMappings":{
           "lore-mcp-full":{"client":"lore-mcp-full","mappings":[{"name":"agent-full"}]},
           "realm-management":{"client":"realm-management","mappings":[{"name":"view-users"}]}}}
        """;

    @Test
    void machineClientWithoutOwnRolesGetsAgentRoleFromServiceAccount() {
        assertEquals(List.of("agent-full"), LoreKcResource.agentScope("[]", SA_AGENT_FULL),
            "lore-mcp-full_<машина>: своих ролей нет, agent-full — через сервисную учётку");
    }

    @Test
    void ownRolesStayAndAreNotDuplicated() {
        String own = "[{\"name\":\"agent-full\"},{\"name\":\"agent-reader\"}]";
        assertEquals(List.of("agent-full", "agent-reader"), LoreKcResource.agentScope(own, SA_AGENT_FULL));
    }

    @Test
    void keycloakServiceRolesDoNotMakeAnAgent() {
        String sa = """
            {"clientMappings":{"realm-management":{"mappings":[{"name":"view-users"},{"name":"query-clients"}]}}}
            """;
        assertEquals(List.of(), LoreKcResource.agentScope("[]", sa));
    }

    @Test
    void unreadableOrMissingServiceAccountKeepsOwnRoles() {
        String own = "[{\"name\":\"agent-reader\"}]";
        assertEquals(List.of("agent-reader"), LoreKcResource.agentScope(own, null));
        assertEquals(List.of("agent-reader"), LoreKcResource.agentScope(own, "not json"));
        assertEquals(List.of("agent-reader"), LoreKcResource.agentScope(own, "{}"));
    }
}
