package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

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

    /**
     * Kit 2 (K2-DIFF, владелица 09.11 через S7A-12): строка диффа несёт знак — что изменится
     * (+ добавится, − снимется, ~ сменится, = уже есть) — и состояние проверки ПО СТРОКЕ:
     * «проверено» здесь честное, текущие роли прочитаны из графа.
     */
    @Test
    @SuppressWarnings("unchecked")
    void planRowCarriesSignAndCheckState() {
        List<Map<String, Object>> plan = LoreRoleBatch.plan(Map.of("a/one", "reader", "a/two", "reader"), List.of(
            ch("a/new", "reader"), ch("a/one", null), ch("a/two", "developer"), ch("a/three", null)));
        assertEquals(List.of("+", "−", "~", "="), plan.stream().map(p -> p.get("sign")).toList());
        for (Map<String, Object> p : plan) {
            Map<String, Object> check = (Map<String, Object>) p.get("check");
            assertEquals("checked", check.get("state"), "текущая роль прочитана — проверено");
            assertEquals("graph", check.get("source"));
        }
    }

    /** Kit 2 (K2-BATCH-UNDO): у пачки идентификатор и окно отмены; отмена после окна — отказ по имени. */
    @Test
    void batchIdCarriesItsUndoWindow() {
        java.time.Instant t = java.time.Instant.parse("2026-11-09T12:00:00Z");
        String id = LoreRoleBatch.batchId(t);
        assertTrue(id.startsWith("rb-"), id);
        assertEquals(t.plus(LoreRoleBatch.UNDO_WINDOW), LoreRoleBatch.undoUntil(id));
        assertNull(LoreRoleBatch.undoError(id, t.plusSeconds(60)), "внутри окна — можно");
        assertNotNull(LoreRoleBatch.undoError(id, t.plus(LoreRoleBatch.UNDO_WINDOW).plusSeconds(1)), "окно вышло");
        assertNotNull(LoreRoleBatch.undoError("rb-garbage", t), "чужой идентификатор");
        assertNotNull(LoreRoleBatch.undoError(null, t));
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
