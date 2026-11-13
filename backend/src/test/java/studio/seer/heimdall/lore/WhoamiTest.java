package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_AGENT_OBSERVABILITY/AO-WHOAMI — «кем LORE видит вызывающего», только из
 * проверенного токена и графа. Плоский тест: без QuarkusTest (тот мигрирует базу).
 * Случаи из задачи: человек, агент full, агент pm, токен без agent_scope, клиент без
 * личности в графе — и обратная проверка (агент НЕ получает семейств чужого профиля).
 */
class WhoamiTest {

    private static final Long EXP = 1_794_600_000L;

    private static Whoami.Token human() {
        return new Whoami.Token(true, "52f6-sub", "lore-app", null, Set.of("admin", "offline_access"), EXP);
    }

    private static Whoami.Token agent(String scope) {
        return new Whoami.Token(true, "sa-sub", "lore-mcp-" + scope, scope, Set.of(), EXP);
    }

    @Test
    void human_isHuman_roleFromRealm_identityByKcSub() {
        Map<String, Object> b = Whoami.body(human(),
            new Whoami.Graph(Map.of("kc_sub", "52f6-sub", "display_name", "omiloreadmin"), List.of(),
                List.of(Map.of("project", "UnlimitedLORE", "role", "owner"))));
        assertEquals("human", b.get("kind"));
        assertEquals("admin", b.get("seer_role"));
        assertNull(b.get("profile"));
        assertEquals("known", ((Map<?, ?>) b.get("identity")).get("state"));
        assertEquals("omiloreadmin", ((Map<?, ?>) b.get("identity")).get("display_name"));
        assertEquals(List.of(Map.of("project", "UnlimitedLORE", "role", "owner")), b.get("project_roles"));
        assertEquals("2026-11-13T20:00:00Z", b.get("token_expires_at"));
    }

    @Test
    void agentFull_profileFull_familiesOfFull_ownerFromGraph() {
        Map<String, Object> b = Whoami.body(agent("full"), new Whoami.Graph(
            Map.of("actor_id", "AGENT-FULL-x", "name", "Claude Code (full)"),
            List.of(Map.of("kc_sub", "52f6-sub", "display_name", "omiloreadmin")), List.of()));
        assertEquals("agent", b.get("kind"));
        assertEquals("full", b.get("profile"));
        assertEquals("lore-mcp-full", b.get("client_id"));
        @SuppressWarnings("unchecked") List<String> fam = (List<String>) b.get("write_families");
        assertTrue(fam.contains("status"), fam.toString());
        assertEquals("AGENT-FULL-x", ((Map<?, ?>) b.get("identity")).get("actor_id"));
        assertEquals(List.of(Map.of("kc_sub", "52f6-sub", "display_name", "omiloreadmin")), b.get("owners"));
    }

    @Test
    void agentPm_familiesOnlyOfPm_reverseCheck() {
        Map<String, Object> pm = Whoami.body(agent("pm"), Whoami.Graph.EMPTY);
        Map<String, Object> full = Whoami.body(agent("full"), Whoami.Graph.EMPTY);
        @SuppressWarnings("unchecked") List<String> pmF = (List<String>) pm.get("write_families");
        @SuppressWarnings("unchecked") List<String> fullF = (List<String>) full.get("write_families");
        assertTrue(fullF.containsAll(pmF), "у pm не может быть семейства, которого нет у full");
        assertTrue(pmF.size() < fullF.size(), "обратная проверка: pm уже, чем full");
        for (String f : pmF)
            assertTrue(AgentScopeFilter.FAMILY_AGENTS.get(f).contains("pm"), f);
    }

    @Test
    void tokenWithoutAgentScope_isHuman_notAgent() {
        Map<String, Object> b = Whoami.body(
            new Whoami.Token(true, "s", "lore-app", null, Set.of(), EXP), Whoami.Graph.EMPTY);
        assertEquals("human", b.get("kind"));
        assertEquals("viewer", b.get("seer_role"));
    }

    @Test
    void clientWithoutIdentityInGraph_saysUnknown_notNoRights() {
        Map<String, Object> b = Whoami.body(agent("full"), Whoami.Graph.EMPTY);
        Map<?, ?> id = (Map<?, ?>) b.get("identity");
        assertEquals("unknown", id.get("state"));
        assertTrue(String.valueOf(id.get("reason")).contains("lore-mcp-full"), String.valueOf(id.get("reason")));
    }

    @Test
    void ambiguousScope_saidAsAmbiguous_noFamilies() {
        Map<String, Object> b = Whoami.body(agent(AgentScopeFilter.AMBIGUOUS_SCOPE), Whoami.Graph.EMPTY);
        assertEquals("ambiguous", b.get("profile"));
        assertEquals(List.of(), b.get("write_families"));
    }

    /** D-2026-LORE-AGENT-MACHINE-EVERYWHERE: машина вызова — агенту из заголовка, человеку «не применимо». */
    @Test
    void machineOfTheCall_agentFromHeader_humanNotApplicable() {
        assertEquals("lorcetus", Whoami.machineOf(agent("full"), "LORCETUS"));
        assertEquals(AgentMachine.UNKNOWN, Whoami.machineOf(agent("full"), null));
        assertEquals(AgentMachine.NOT_APPLICABLE, Whoami.machineOf(human(), "lorcetus"));
    }

    @Test
    void authOff_saysSo_noTokenFieldsInvented() {
        Map<String, Object> b = Whoami.body(Whoami.Token.authOff("admin"), Whoami.Graph.EMPTY);
        assertFalse((Boolean) b.get("auth_enabled"));
        assertEquals("unverified", b.get("kind"));
        assertEquals("admin", b.get("seer_role"));
        assertNull(b.get("client_id"));
    }
}
