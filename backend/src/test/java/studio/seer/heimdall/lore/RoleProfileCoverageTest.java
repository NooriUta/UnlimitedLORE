package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_AGENT_OBSERVABILITY/AO-06 — «ни один срез не отдаёт profile по корпусу»:
 * task_roles — только по одной задаче, поэтому «сколько ролей несут профиль» было
 * неотвечаемо. Срез role_profile_coverage: открытые роли по (role, profile) — строка с
 * profile = null и есть непокрытое. Агрегат без записей проектов — общий срез.
 * Форма запроса — здесь; живой ответ — RoleProfileCoverageLiveDbTest (CI).
 */
class RoleProfileCoverageTest {

    @Test
    void sliceRegistered_openRolesOnly_groupedByRoleAndProfile() {
        LoreSlices.SliceDef d = LoreSlices.get("role_profile_coverage");
        assertNotNull(d, "среза нет");
        String sql = LoreSlices.compose("role_profile_coverage", Map.of(), null).sql();
        assertTrue(sql.contains("FROM ROLE_HELD_BY"), sql);
        assertTrue(sql.contains("valid_to IS NULL"), "закрытые роли не считаются: " + sql);
        assertTrue(sql.contains("GROUP BY role, profile"), sql);
    }

    @Test
    void classifiedAsShared_notProjectData() {
        assertTrue(LoreSlices.SHARED_SLICES.containsKey("role_profile_coverage"));
        // под скоупом агрегат не режется: compose с множеством проектов SQL не меняет
        String a = LoreSlices.compose("role_profile_coverage", Map.of(), null).sql();
        String b = LoreSlices.compose("role_profile_coverage", Map.of(), Set.of("org/a")).sql();
        assertTrue(a.equals(b), "агрегат покрытия не должен скоупиться");
    }
}
