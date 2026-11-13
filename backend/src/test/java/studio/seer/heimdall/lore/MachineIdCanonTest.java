package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * SPRINT_UXR_POLISH_UAT_1113/PU-18 — одна машина = один объект независимо от регистра.
 *
 * <p>Прод 13.11: у Kimi (full) machines = ["LorCetus", "LORCETUS"] — одна физическая
 * машина двумя вершинами KnowMachine, потому что заголовок X-Lore-Machine писался как
 * пришёл. Правило: имя машины канонизируется на ВХОДЕ — заголовок, заведение машины,
 * доступ к машине, окно активности, учётка minilore-link-&lt;machine&gt; — trim + нижний
 * регистр. Плоский тест: без QuarkusTest (тот увёл бы миграцию в боевую схему).
 */
class MachineIdCanonTest {

    private static final ChangeAuthor AGENT = new ChangeAuthor("lore-mcp-full_kimi", ChangeAuthor.KIND_AGENT);

    @Test
    void canon_trimsAndLowercases_nullStaysNull() {
        assertEquals("lorcetus", AgentMachine.canon("  LorCetus "));
        assertEquals("lorcetus", AgentMachine.canon("LORCETUS"));
        assertNull(AgentMachine.canon(null));
    }

    @Test
    void header_differentCase_sameMachine() {
        assertEquals(AgentMachine.judge(AGENT, "LorCetus", false).machineId(),
            AgentMachine.judge(AGENT, "LORCETUS", false).machineId());
        assertEquals("lorcetus", AgentMachine.judge(AGENT, "LORCETUS", false).machineId());
    }

    @Test
    void requests_carryCanonicalMachineId() {
        assertEquals("lorcetus", new MachineEnroll.Request("LorCetus", null, null, null, null, true).machine_id());
        assertEquals("lorcetus", new MachineActivity.Request("LORCETUS", null, null, true).machine_id());
        assertEquals("lorcetus", new MachineAccess.Request("LorCetus", "u-1", null, null, "reader", List.of(), List.of()).machine_id());
    }

    /** Пробел #1308: actor, actor/session и actor/owner писали machine_id как пришёл (Kimi — «lorecetus»). */
    @Test
    void actorPaths_carryCanonicalMachineId() {
        assertEquals("lorcetus", new LoreProductResource.ActorRequest("A", null, null, null, null, null, "LorCetus", null).machine_id());
        assertEquals("lorcetus", new LoreProductResource.AgentSessionRequest("A", "s", "LORCETUS", null, null, null).machine_id());
        assertEquals("lorcetus", new LoreProductResource.ActorOwnerRequest("A", null, null, null, null, "LORCETUS").machine_id());
        assertEquals("", new LoreProductResource.ActorOwnerRequest("A", null, null, null, null, "").machine_id(), "«» — отвязать, не трогаем");
        assertNull(new LoreProductResource.AgentSessionRequest("A", "s", null, null, null, null).machine_id());
    }

    @Test
    void clientId_isCanonical() {
        assertEquals(MachineAccess.PREFIX + "lorcetus", MachineAccess.clientIdOf("LorCetus"));
    }
}
