package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-05 · S7B-09 · S7B-13 — массовая смена ролей человека:
 * план «было → станет» (дифф для одного подтверждения) и обратный пакет для отката.
 */
class LoreRoleBatchTest {

    private static Map<String, Object> ch(String project, String role) {
        return role == null ? Map.of("project", project, "action", "remove") : Map.of("project", project, "role", role);
    }

    @Test
    void planShowsBeforeAndAfterForEveryKind() {
        Map<String, String> cur = Map.of("a/one", "reader", "a/two", "owner");
        List<Map<String, Object>> plan = LoreRoleBatch.plan(cur, List.of(
            ch("a/one", "developer"),   // update
            ch("a/two", null),          // remove
            ch("a/three", "tester"),    // grant
            ch("a/one-same", null)));   // remove of nothing → unchanged
        assertEquals("update", plan.get(0).get("kind"));
        assertEquals("reader", plan.get(0).get("before"));
        assertEquals("developer", plan.get(0).get("after"));
        assertEquals("remove", plan.get(1).get("kind"));
        assertEquals("owner", plan.get(1).get("before"));
        assertNull(plan.get(1).get("after"));
        assertEquals("grant", plan.get(2).get("kind"));
        assertEquals("unchanged", plan.get(3).get("kind"));
    }

    @Test
    void undoRestoresWhatWasBefore() {
        Map<String, String> cur = Map.of("a/one", "reader", "a/two", "owner");
        List<Map<String, Object>> plan = LoreRoleBatch.plan(cur, List.of(
            ch("a/one", "developer"), ch("a/two", null), ch("a/three", "tester")));
        List<Map<String, Object>> undo = LoreRoleBatch.undo(plan);
        assertEquals(Map.of("project", "a/one", "role", "reader"), undo.get(0));
        assertEquals(Map.of("project", "a/two", "role", "owner"), undo.get(1));
        assertEquals(Map.of("project", "a/three", "action", "remove"), undo.get(2));
    }

    @Test
    void sameRoleIsUnchangedAndHasNoUndo() {
        List<Map<String, Object>> plan = LoreRoleBatch.plan(Map.of("a/one", "reader"), List.of(ch("a/one", "reader")));
        assertEquals("unchanged", plan.get(0).get("kind"));
        assertEquals(0, LoreRoleBatch.undo(plan).size());
    }

    @Test
    void badBatchIsRefused() {
        assertNotNull(LoreRoleBatch.error(List.of()));
        assertNotNull(LoreRoleBatch.error(List.of(Map.of("role", "reader"))), "нет project");
        assertNotNull(LoreRoleBatch.error(List.of(Map.of("project", "a/one"))), "нет role и не remove");
        assertNotNull(LoreRoleBatch.error(List.of(ch("a/one", "x"), ch("a/one", "y"))), "один проект дважды");
        assertNull(LoreRoleBatch.error(List.of(ch("a/one", "reader"), ch("a/two", null))));
    }
}
