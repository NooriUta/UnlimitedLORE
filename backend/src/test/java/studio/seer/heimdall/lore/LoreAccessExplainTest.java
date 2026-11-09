package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-10 — «почему видит / не видит»: цепочка
 * «скоуп → роль realm → роль в проекте → итог» по тем же правилам, что
 * AidaLoreResource.allowedProjectsOrNull / bypassesScope и ProjectRbacService.
 */
class LoreAccessExplainTest {

    @SuppressWarnings("unchecked")
    private static List<String> chain(Map<String, Object> r) { return (List<String>) r.get("chain"); }

    @Test
    void scopeOffMeansEveryoneSees() {
        Map<String, Object> r = LoreAccessExplain.explain(false, "viewer", Map.of(), "acme/one");
        assertEquals(true, r.get("sees"));
        assertTrue(String.join(" ", chain(r)).contains("lore.scope.enforce"), "причина названа: " + chain(r));
    }

    @Test
    void adminBypassesTheProjectScope() {
        Map<String, Object> r = LoreAccessExplain.explain(true, "admin", Map.of(), "acme/one");
        assertEquals(true, r.get("sees"));
        assertEquals(true, r.get("can_write"));
        assertTrue(String.join(" ", chain(r)).contains("admin"), chain(r).toString());
    }

    @Test
    void projectRoleGivesVisibilityAndReaderOnlyReads() {
        Map<String, Object> reader = LoreAccessExplain.explain(true, "viewer", Map.of("acme/one", "reader"), "acme/one");
        assertEquals(true, reader.get("sees"));
        assertEquals(false, reader.get("can_write"), "reader видит, но не пишет");
        assertEquals("reader", reader.get("project_role"));
        Map<String, Object> dev = LoreAccessExplain.explain(true, "viewer", Map.of("acme/one", "developer"), "acme/one");
        assertEquals(true, dev.get("can_write"));
        assertTrue(((List<?>) dev.get("agent_profiles")).contains("developer"), "агенты владельца — по матрице D4");
    }

    @Test
    void noRoleInProjectMeansNotVisibleWithReason() {
        Map<String, Object> r = LoreAccessExplain.explain(true, "viewer", Map.of("acme/two", "owner"), "acme/one");
        assertEquals(false, r.get("sees"));
        assertFalse((Boolean) r.get("can_write"));
        assertTrue(String.join(" ", chain(r)).contains("acme/one"), "причина называет проект: " + chain(r));
    }
}
