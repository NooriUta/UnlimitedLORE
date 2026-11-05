package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * MT-TASK-MV-HISTORY, часть 2 (Völva 05.11.2026): task_new отвергал «Claude Code (full)»
 * как незаявленную личность, хотя это ОТОБРАЖАЕМОЕ ИМЯ заявленной агентной личности
 * AGENT-FULL-msbt0fed — им же роли показываются при чтении. Прочитанное должно
 * записываться обратно: имя агента сводится к его actor_id.
 */
class RoleAgentDisplayNameTest {

    static final Map<String, String> AGENTS = Map.of(
        "Claude Code (full)", "AGENT-FULL-msbt0fed",
        "Claude Code (tester)", "AGENT-TESTER-msbt42cj");

    @Test
    void agentDisplayNameResolvesToActorId() {
        assertEquals("AGENT-FULL-msbt0fed", TaskRoleService.agentIdByName("Claude Code (full)", AGENTS));
        assertEquals("AGENT-TESTER-msbt42cj", TaskRoleService.agentIdByName("  Claude Code (tester) ", AGENTS));
    }

    @Test
    void anythingElsePassesThroughUnchanged() {
        assertEquals("AGENT-FULL-msbt0fed", TaskRoleService.agentIdByName("AGENT-FULL-msbt0fed", AGENTS));
        assertEquals("omiloreadmin", TaskRoleService.agentIdByName("omiloreadmin", AGENTS));
        assertEquals("Claude Code (ful)", TaskRoleService.agentIdByName("Claude Code (ful)", AGENTS), "опечатка не угадывается");
        assertNull(TaskRoleService.agentIdByName(null, AGENTS));
    }
}
