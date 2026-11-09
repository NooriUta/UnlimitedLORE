package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-07 — «MCP: подключения и честное здоровье».
 * MCP-сервер работает у агента на машине; LORE видит только его вызовы. Поэтому
 * здоровье подключения — то, что LORE наблюдал: когда агент звал в последний раз,
 * сколько, и сколько его записей упало. Не звал ни разу — строки нет («не видели»),
 * а не «здоров».
 */
class McpHealthSlicesTest {

    @Test
    void connectionsAreAgentCallsGroupedByProfileWithLastSeen() {
        String sql = LoreSlices.compose("mcp_connections", Map.of()).sql();
        assertTrue(sql.contains("metric = 'lore.requests'"), sql);
        assertTrue(sql.contains("segment = 'agent'"), "только агентская ось: " + sql);
        assertTrue(sql.contains("max(ts) AS last_seen"), sql);
        assertTrue(sql.contains("sum(value) AS calls"), sql);
        assertTrue(sql.contains("GROUP BY object_id"), sql);
    }

    @Test
    void failuresAreAgentWritesAnsweredWithAnErrorCode() {
        String sql = LoreSlices.compose("mcp_failures", Map.of()).sql();
        assertTrue(sql.contains("metric = 'lore.action'"), sql);
        assertTrue(sql.contains("segment = 'agent'"), sql);
        assertTrue(sql.contains("value >= 400"), "упавшая запись — код ответа ≥ 400: " + sql);
        assertTrue(sql.contains("max(ts) AS last_failure"), sql);
        assertTrue(sql.contains("GROUP BY source"), sql);
    }

    @Test
    void failuresFilterByAgent() {
        String sql = LoreSlices.compose("mcp_failures", Map.of("caller", "full")).sql();
        assertTrue(sql.contains("source = :caller"), sql);
        assertEquals(1, sql.toUpperCase().split(" WHERE ", -1).length - 1, "один WHERE: " + sql);
    }
}
