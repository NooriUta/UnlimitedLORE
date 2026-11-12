package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-21 — «почему агент получил 403 на инструменте»: объяснение
 * строится ТЕМ ЖЕ решением, что отказывает на проде ({@link AgentScopeFilter#decide}),
 * а не копией матрицы. Вход — то, что пишет журнал отказа (AO-01): caller = профиль
 * агента, family, entity_id = путь запроса.
 */
class AgentToolExplainTest {

    @SuppressWarnings("unchecked")
    private static List<String> allowed(Map<String, Object> r) { return (List<String>) r.get("allowed_profiles"); }

    @Test
    void marketerOnAdrIsDeniedWithTheFilterOwnReason() {
        Map<String, Object> r = AgentToolExplain.explain("marketer", "adr", "lore/adr");
        assertEquals("denied", r.get("verdict"));
        assertEquals("adr", r.get("what"));
        assertEquals(AgentScopeFilter.decide("marketer", "/lore/adr").why(), r.get("why"));
        assertTrue(allowed(r).containsAll(List.of("full", "architect", "developer")), "кому можно: " + allowed(r));
        assertFalse(allowed(r).contains("marketer"));
        assertEquals("change_profile", r.get("fix"));
    }

    @Test
    void fullOnAdrIsAllowedSoA403ThereIsNotTheProfileMatrix() {
        Map<String, Object> r = AgentToolExplain.explain("full", "adr", "lore/adr");
        assertEquals("allowed", r.get("verdict"));
        assertNull(r.get("why"));
        assertEquals("project_role", r.get("fix"));
    }

    @Test
    void subPathNarrowingIsExplainedBySubPath() {
        Map<String, Object> r = AgentToolExplain.explain("developer", "adr", "/lore/adr/delete");
        assertEquals("denied", r.get("verdict"));
        assertEquals("adr/delete", r.get("what"));
        assertEquals(List.of("architect", "full"), allowed(r));
    }

    @Test
    void humanOnlyFamilyHasNoProfileToSwitchTo() {
        Map<String, Object> r = AgentToolExplain.explain("full", "dict", "lore/dict/harness/x");
        assertEquals("denied", r.get("verdict"));
        assertEquals(true, r.get("human_only"));
        assertEquals(List.of(), allowed(r));
        assertEquals("human", r.get("fix"));
    }

    @Test
    void humanOnlyExemptionIsTheFilters() {
        assertEquals("allowed", AgentToolExplain.explain("full", "user", "lore/user/role").get("verdict"));
        Map<String, Object> r = AgentToolExplain.explain("pm", "user", "lore/user/role");
        assertEquals("denied", r.get("verdict"));
        assertEquals(List.of("full"), allowed(r));
    }

    @Test
    void entityIdThatIsNotAPathFallsBackToTheFamily() {
        Map<String, Object> r = AgentToolExplain.explain("marketer", "sprint", "SPRINT_X");
        assertEquals("/lore/sprint", r.get("path"));
        assertEquals("denied", r.get("verdict"));
    }

    @Test
    void familyOutsideTheMatrixIsUnlistedNotDenied() {
        Map<String, Object> r = AgentToolExplain.explain("marketer", "zzz-unknown", null);
        assertEquals("unlisted", r.get("verdict"));
    }

    @Test
    void noProfileMeansHumanAndAmbiguousIsDenied() {
        assertEquals("no_profile", AgentToolExplain.explain(null, "adr", null).get("verdict"));
        assertEquals("no_profile", AgentToolExplain.explain("  ", "adr", null).get("verdict"));
        assertEquals("denied", AgentToolExplain.explain(AgentScopeFilter.AMBIGUOUS_SCOPE, "task", null).get("verdict"));
    }

    @Test
    void agentPrefixIsStrippedLikeTheClaim() {
        assertEquals("denied", AgentToolExplain.explain("agent-marketer", "adr", null).get("verdict"));
        assertEquals("marketer", AgentToolExplain.explain("agent-marketer", "adr", null).get("profile"));
    }

    @Test
    void verdictMatchesTheFilterForEveryFamilyAndProfile() {
        for (String fam : AgentScopeFilter.FAMILY_AGENTS.keySet())
            for (String p : AgentScopeFilter.knownProfiles()) {
                boolean denied = AgentScopeFilter.decide(p, "/lore/" + fam) != null;
                assertEquals(denied ? "denied" : "allowed", AgentToolExplain.explain(p, fam, null).get("verdict"), fam + " × " + p);
            }
    }

    @Test
    void missingFamilyAndPathIsAnError() {
        assertEquals("bad_input", AgentToolExplain.explain("full", null, null).get("verdict"));
    }
}
