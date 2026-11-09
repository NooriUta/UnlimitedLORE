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

    @Test
    void matrixIsClassifiedForScope() {
        assertTrue(LoreSlices.SCOPE_PENDING.containsKey("role_matrix")
                || LoreSlices.SHARED_SLICES.containsKey("role_matrix"),
            "срез обязан быть классифицирован для скоупа");
    }
}
