package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_AGENT_OBSERVABILITY/AO-07 — решение владельца 04.11 «оба пути»:
 * «если full, то сам агент заявляет роль, либо при регистрации только роль».
 *
 * <p>Путь «заявка на действии»: агент под {@code full} шлёт {@code X-Lore-Act-As: tester},
 * и запись проверяется матрицей ПРОФИЛЯ tester — заявка только СУЖАЕТ. Путь
 * «регистрация»: агент со своим клиентом ({@code agent_scope=tester}) закреплён им —
 * заявить другой профиль нельзя, иначе заголовок стал бы способом сменить права.</p>
 */
class AgentActAsTest {

    @Test
    void noDeclarationKeepsTokenScope() {
        assertEquals("full", AgentScopeFilter.effectiveScope("full", null).scope());
        assertEquals("tester", AgentScopeFilter.effectiveScope("tester", " ").scope());
    }

    @Test
    void fullMayDeclareAKnownProfileAndIsNarrowedToIt() {
        var r = AgentScopeFilter.effectiveScope("full", "tester");
        assertNull(r.refusal(), String.valueOf(r.refusal()));
        assertEquals("tester", r.scope());
        // и запись дальше решает матрица ЗАЯВЛЕННОГО профиля: tester не пишет ADR
        assertNotNull(AgentScopeFilter.decide(r.scope(), "/lore/adr/create"),
            "заявивший tester не пишет ADR, хотя токен full");
        assertNull(AgentScopeFilter.decide("full", "/lore/adr/create"), "контроль: full сам по себе ADR пишет");
    }

    @Test
    void unknownDeclaredProfileIsRefusedNotIgnored() {
        var r = AgentScopeFilter.effectiveScope("full", "testr");
        assertNotNull(r.refusal());
        assertTrue(r.refusal().contains("testr"), r.refusal());
    }

    @Test
    void registeredProfileCannotSwitch() {
        var r = AgentScopeFilter.effectiveScope("tester", "architect");
        assertNotNull(r.refusal(), "профиль, закреплённый регистрацией, не меняется заголовком");
        assertNull(AgentScopeFilter.effectiveScope("tester", "tester").refusal(), "повтор своего — не смена");
    }

    @Test
    void declaringFullIsNotAWayUp() {
        assertNotNull(AgentScopeFilter.effectiveScope("tester", "full").refusal());
    }

    @Test
    void ambiguousTokenStaysRefusedWhateverIsDeclared() {
        var r = AgentScopeFilter.effectiveScope(AgentScopeFilter.AMBIGUOUS_SCOPE, "tester");
        assertNotNull(r.refusal());
    }
}
