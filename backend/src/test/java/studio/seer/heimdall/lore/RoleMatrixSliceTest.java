package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-11 — матрица «проект × люди» в «Ролях и правах».
 * Вся матрица одним запросом (а не user_project_roles по каждому человеку):
 * люди × их проекты × роль на ребре HAS_PROJECT_ROLE. Правка ячейки — существующие
 * POST /lore/user/role и /lore/user/role/batch.
 */
class RoleMatrixSliceTest {

    @Test
    void matrixReadsEveryUserWithProjectsAndRolesFromTheGraph() {
        String sql = LoreSlices.compose("role_matrix", Map.of()).sql();
        assertTrue(sql.contains("FROM KnowUser"), sql);
        assertTrue(sql.contains("out('HAS_PROJECT_ROLE').slug AS projects"), sql);
        assertTrue(sql.contains("outE('HAS_PROJECT_ROLE').role AS roles"), "роль — с ребра: " + sql);
        assertFalse(sql.contains(":kc_sub"), "вся матрица, без обязательного человека: " + sql);
        assertTrue(sql.contains("ORDER BY display_name"), sql);
    }

    /**
     * Kit 2 (K2-MATRIX, владелица 09.11 через S7A-12): ячейка несёт СОСТОЯНИЕ, а не роль|null —
     * «проверено / не смогли / нет прав». Для графа LORE ячейка честно «проверено»: роли прочитаны.
     * Источники Keycloak/Forgejo добавятся своими ячейками со своим состоянием.
     */
    @Test
    @SuppressWarnings("unchecked")
    void matrixRowGetsCellsWithState() {
        Map<String, Object> body = new java.util.HashMap<>();
        body.put("rows", java.util.List.of(
            new java.util.HashMap<>(Map.of("kc_sub", "u1", "projects", java.util.List.of("a/one", "a/two"),
                "roles", java.util.List.of("reader", "developer"))),
            new java.util.HashMap<>(Map.of("kc_sub", "u2", "projects", java.util.List.of(), "roles", java.util.List.of()))));
        LoreRoleMatrix.fold(body);
        java.util.List<Map<String, Object>> rows = (java.util.List<Map<String, Object>>) body.get("rows");
        java.util.List<Map<String, Object>> cells = (java.util.List<Map<String, Object>>) rows.get(0).get("cells");
        assertEquals(2, cells.size());
        assertEquals(Map.of("project", "a/one", "role", "reader", "state", "checked", "source", "graph"), cells.get(0));
        assertEquals(java.util.List.of(), rows.get(1).get("cells"), "ролей нет — пусто, но строка проверена");
        assertEquals("checked", rows.get(1).get("state"), "у строки своё состояние: граф прочитан");
        assertTrue(rows.get(0).containsKey("projects"), "старые поля не убраны — обратная совместимость");
        assertEquals(java.util.List.of("checked", "unavailable", "forbidden"), LoreRoleMatrix.STATES);
        // Kit 09.11: «не спрашивали» ≠ «спросили, роли нет». Список опрошенных источников — в теле:
        // по нему kit говорит «Keycloak не спрашивали», а не рисует пустую ячейку как «нет роли».
        assertEquals(java.util.List.of("graph"), body.get("sources_asked"));
    }

    @Test
    void matrixIsClassifiedForScope() {
        assertTrue(LoreSlices.SCOPE_PENDING.containsKey("role_matrix")
                || LoreSlices.SHARED_SLICES.containsKey("role_matrix"),
            "срез обязан быть классифицирован для скоупа");
    }
}
