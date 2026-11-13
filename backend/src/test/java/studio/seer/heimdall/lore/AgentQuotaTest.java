package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.OptionalInt;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_AGENT_OBSERVABILITY/AO-03 — квоты агентов: два уровня (агент и весь контур),
 * расход по журналу AO-01 (свой счётчик не заводится), жёсткий отказ с причиной. Потолки —
 * конфигом, по умолчанию ВЫКЛ (значения решает владелица).
 */
class AgentQuotaTest {

    private static final OptionalInt OFF = OptionalInt.empty();

    @Test
    void bothOff_neverRefuses() {
        assertNull(AgentQuota.judge("full", OFF, OFF, 1_000_000, 9_000_000));
    }

    @Test
    void agentOverItsCeiling_refusedWithReason() {
        AgentQuota.Denial d = AgentQuota.judge("pm", OptionalInt.of(100), OFF, 100, 100);
        assertNotNull(d);
        assertEquals("AGENT_QUOTA_EXCEEDED", d.code());
        assertTrue(d.reason().contains("pm") && d.reason().contains("100"), d.reason());
    }

    @Test
    void agentUnderCeiling_passes() {
        assertNull(AgentQuota.judge("pm", OptionalInt.of(100), OFF, 99, 99));
    }

    @Test
    void totalCeiling_firesEvenWhenNoAgentReachedItsOwn() {
        AgentQuota.Denial d = AgentQuota.judge("pm", OptionalInt.of(100), OptionalInt.of(500), 10, 500);
        assertNotNull(d);
        assertEquals("TOTAL_QUOTA_EXCEEDED", d.code());
    }

    @Test
    void countSql_readsTheActionJournal_agentAxisOnly_window() {
        assertTrue(AgentQuota.AGENT_SQL.contains("metric = 'lore.action'"));
        assertTrue(AgentQuota.AGENT_SQL.contains("segment = 'agent'"));
        assertTrue(AgentQuota.AGENT_SQL.contains("source = :scope"));
        assertTrue(AgentQuota.AGENT_SQL.contains("ts >= :from"));
        assertTrue(AgentQuota.TOTAL_SQL.contains("segment = 'agent'"));
        assertTrue(!AgentQuota.TOTAL_SQL.contains(":scope"));
    }

    @Test
    void readsAreNotCounted() {
        assertTrue(AgentQuota.applies("POST", "full"));
        assertTrue(!AgentQuota.applies("GET", "full"));
        assertTrue(!AgentQuota.applies("POST", null), "человек квотами агентов не режется");
    }
}
