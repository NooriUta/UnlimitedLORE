package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * D-2026-LORE-AGENT-MACHINE-EVERYWHERE — «машина» у всего, что связано с агентом; где
 * неприменимо — явно «не применимо». Одно правило отметки машины вызова для аудита,
 * буфера отказов и whoami: агент — каноническое имя из X-Lore-Machine, без заголовка
 * или с негодным — «неизвестно»; человек — «не применимо» (а не «неизвестно»).
 */
class MachineMarkTest {

    @Test
    void agentWithHeader_canonicalName() {
        assertEquals("lorcetus", AgentMachine.mark(true, " LorCetus "));
    }

    @Test
    void agentWithoutOrBadHeader_unknown() {
        assertEquals(AgentMachine.UNKNOWN, AgentMachine.mark(true, null));
        assertEquals(AgentMachine.UNKNOWN, AgentMachine.mark(true, "bad name!"));
    }

    @Test
    void human_notApplicable_evenWithHeader() {
        assertEquals(AgentMachine.NOT_APPLICABLE, AgentMachine.mark(false, "lorcetus"));
        assertEquals(AgentMachine.NOT_APPLICABLE, AgentMachine.mark(false, null));
    }

    @Test
    void markersAreDistinct_andNotValidMachineNames() {
        assertTrue(!AgentMachine.SAFE.matcher(AgentMachine.UNKNOWN).matches() || AgentMachine.UNKNOWN.startsWith("("));
        assertTrue(!AgentMachine.UNKNOWN.equals(AgentMachine.NOT_APPLICABLE));
    }

    @Test
    void auditLineCarriesMachine() {
        String line = LoreAuditLogFilter.line("2026-11-13T23:00:00Z", "agent", "full", "status", "/lore/status",
            "POST", 200, "SPRINT_X/T1", "lorcetus");
        assertTrue(line.endsWith("machine=lorcetus"), line);
    }

    @Test
    void denialCarriesMachine() {
        LoreDenialRecorder.Denial d = new LoreDenialRecorder.Denial("t", "POST", "/lore/x", 403, "E", "admin", "lorcetus");
        assertEquals("lorcetus", d.machine());
    }
}
