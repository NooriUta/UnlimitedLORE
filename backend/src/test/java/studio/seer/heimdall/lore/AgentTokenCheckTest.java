package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

/**
 * SPRINT_LORE_AGENT_OBSERVABILITY/AO-AGENT-ADD шаг 4 — после создания учётки агента бэкенд
 * сам берёт её токен и показывает, что в нём agent_scope = профиль. Проверяется разбор
 * токена (чистая часть): совпал / другой профиль / клейма нет / токен не разобран.
 * Значение секрета и сам токен в ответ не попадают.
 */
class AgentTokenCheckTest {

    private static String jwt(String payloadJson) {
        Base64.Encoder e = Base64.getUrlEncoder().withoutPadding();
        return e.encodeToString("{\"alg\":\"none\"}".getBytes(StandardCharsets.UTF_8)) + "."
            + e.encodeToString(payloadJson.getBytes(StandardCharsets.UTF_8)) + ".sig";
    }

    @Test
    void scopeMatchesProfile_ok_arrayAndQuotedLikeKeycloak() {
        Map<String, Object> c = LoreKcAgentClient.tokenCheck(jwt("{\"agent_scope\":[\"agent-pm\"]}"), "pm");
        assertEquals("ok", c.get("state"));
        assertEquals("pm", c.get("agent_scope"));
    }

    @Test
    void otherProfile_mismatch() {
        Map<String, Object> c = LoreKcAgentClient.tokenCheck(jwt("{\"agent_scope\":\"agent-full\"}"), "pm");
        assertEquals("mismatch", c.get("state"));
        assertEquals("full", c.get("agent_scope"));
        assertEquals("pm", c.get("expected"));
    }

    @Test
    void noClaim_missing_notOk() {
        assertEquals("missing", LoreKcAgentClient.tokenCheck(jwt("{\"sub\":\"x\"}"), "pm").get("state"));
    }

    @Test
    void garbage_error_neverThrows() {
        assertEquals("error", LoreKcAgentClient.tokenCheck("not-a-jwt", "pm").get("state"));
        assertEquals("error", LoreKcAgentClient.tokenCheck(null, "pm").get("state"));
    }

    @Test
    void tokenItselfNotEchoed() {
        String t = jwt("{\"agent_scope\":\"agent-pm\"}");
        assertFalse(LoreKcAgentClient.tokenCheck(t, "pm").toString().contains(t));
    }
}
