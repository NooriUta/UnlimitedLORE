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
        LoreRoleMatrix.fold(body, null);
        java.util.List<Map<String, Object>> rows = (java.util.List<Map<String, Object>>) body.get("rows");
        java.util.List<Map<String, Object>> cells = cellsOf(rows.get(0), "graph");
        assertEquals(2, cells.size());
        assertEquals(Map.of("project", "a/one", "role", "reader", "state", "checked", "source", "graph"), cells.get(0));
        assertEquals(java.util.List.of(), cellsOf(rows.get(1), "graph"), "ролей нет — пусто, но строка проверена");
        assertEquals("checked", rows.get(1).get("state"), "у строки своё состояние: граф прочитан");
        assertTrue(rows.get(0).containsKey("projects"), "старые поля не убраны — обратная совместимость");
        assertEquals(java.util.List.of("checked", "unavailable", "forbidden"), LoreRoleMatrix.STATES);
        // Kit 09.11: «не спрашивали» ≠ «спросили, роли нет». Список опрошенных источников — в теле:
        // по нему kit говорит «Keycloak не спрашивали», а не рисует пустую ячейку как «нет роли».
        assertEquals(java.util.List.of("graph"), body.get("sources_asked"));
    }

    @SuppressWarnings("unchecked")
    private static java.util.List<Map<String, Object>> cellsOf(Map<String, Object> row, String source) {
        return ((java.util.List<Map<String, Object>>) row.get("cells")).stream()
            .filter(c -> source.equals(c.get("source"))).toList();
    }

    private static Map<String, Object> twoPeople() {
        Map<String, Object> body = new java.util.HashMap<>();
        body.put("rows", java.util.List.of(
            new java.util.HashMap<>(Map.of("kc_sub", "u1", "projects", java.util.List.of("a/one"),
                "roles", java.util.List.of("owner"))),
            new java.util.HashMap<>(Map.of("kc_sub", "u2", "projects", java.util.List.of(), "roles", java.util.List.of()))));
        return body;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> row(Map<String, Object> body, int i) {
        return ((java.util.List<Map<String, Object>>) body.get("rows")).get(i);
    }

    /**
     * Решение владелицы D-2026-UXR-OWNER-DELEGATED-ANSWERS-10-11 (31а): у Keycloak проектных
     * ролей нет — ячейка KC одна на человека, project «*», роль — его realm-роли
     * (служебные роли KC не права LORE и не показываются). Человек сопоставлен по kc_sub.
     */
    @Test
    void keycloakCellIsOnePerPersonWithRealmRoles() {
        Map<String, Object> body = twoPeople();
        LoreRoleMatrix.fold(body, LoreRoleMatrix.KcResult.answered(Map.of(
            "u1", new LoreRoleMatrix.KcLookup(200, java.util.List.of("viewer", "default-roles-omilore", "admin", "offline_access")),
            "u2", new LoreRoleMatrix.KcLookup(404, java.util.List.of()))));

        java.util.List<Map<String, Object>> kc1 = cellsOf(row(body, 0), "kc");
        assertEquals(1, kc1.size(), "ячейка KC — одна на человека");
        assertEquals("*", kc1.get(0).get("project"));
        assertEquals("checked", kc1.get(0).get("state"));
        assertEquals("admin, viewer", kc1.get(0).get("role"));
        assertEquals(java.util.List.of("admin", "viewer"), kc1.get(0).get("roles"));

        // Спросили, человека в KC нет — «проверено, роли нет» с причиной, а не «не смогли».
        Map<String, Object> kc2 = cellsOf(row(body, 1), "kc").get(0);
        assertEquals("checked", kc2.get("state"));
        assertNull(kc2.get("role"));
        assertEquals("нет пользователя в Keycloak", kc2.get("reason"));

        assertEquals(java.util.List.of("graph", "kc"), body.get("sources_asked"));
    }

    /** KC не ответил (или не настроен) — каждая ячейка KC «не смогли» с причиной, не пустая роль. */
    @Test
    void keycloakFailureMakesCellsUnavailableWithReason() {
        Map<String, Object> body = twoPeople();
        LoreRoleMatrix.fold(body, LoreRoleMatrix.KcResult.failed("Keycloak не настроен"));
        for (int i = 0; i < 2; i++) {
            Map<String, Object> c = cellsOf(row(body, i), "kc").get(0);
            assertEquals("unavailable", c.get("state"));
            assertNull(c.get("role"));
            assertEquals("Keycloak не настроен", c.get("reason"));
        }
        assertEquals(java.util.List.of("graph", "kc"), body.get("sources_asked"), "спросить пытались");

        Map<String, Object> partial = twoPeople();
        LoreRoleMatrix.fold(partial, LoreRoleMatrix.KcResult.answered(Map.of(
            "u1", new LoreRoleMatrix.KcLookup(500, java.util.List.of()))));
        Map<String, Object> c1 = cellsOf(row(partial, 0), "kc").get(0);
        assertEquals("unavailable", c1.get("state"));
        assertTrue(String.valueOf(c1.get("reason")).contains("500"), String.valueOf(c1.get("reason")));
        assertEquals("unavailable", cellsOf(row(partial, 1), "kc").get(0).get("state"), "человека не спрашивали");
    }

    /**
     * 32а: связи «KnowUser ↔ пользователь Forgejo» в графе нет — ячейка Forgejo у каждого
     * человека честно «не смогли» с причиной; Forgejo не опрашивался и в sources_asked не входит.
     */
    @Test
    void forgejoCellIsUnavailableWithoutUserLink() {
        Map<String, Object> body = twoPeople();
        LoreRoleMatrix.fold(body, null);
        for (int i = 0; i < 2; i++) {
            java.util.List<Map<String, Object>> fj = cellsOf(row(body, i), "forgejo");
            assertEquals(1, fj.size());
            assertEquals("*", fj.get(0).get("project"));
            assertEquals("unavailable", fj.get(0).get("state"));
            assertNull(fj.get(0).get("role"));
            assertEquals("нет связи с пользователем Forgejo", fj.get(0).get("reason"));
        }
        assertEquals(java.util.List.of("graph"), body.get("sources_asked"), "KC не спрашивали — его нет в списке");
        assertFalse(((java.util.List<?>) body.get("sources_asked")).contains("forgejo"));
    }

    @Test
    void matrixIsClassifiedForScope() {
        assertTrue(LoreSlices.SCOPE_PENDING.containsKey("role_matrix")
                || LoreSlices.SHARED_SLICES.containsKey("role_matrix"),
            "срез обязан быть классифицирован для скоупа");
    }
}
