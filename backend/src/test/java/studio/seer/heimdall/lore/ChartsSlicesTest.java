package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Графики из предложения 19.11.2026 («добавляй графики», первая пачка: 2, 7, 1, 13, 14).
 *
 * <p>{@code task_status_versions} — версии статуса задач SCD2 целиком (начало и конец каждой):
 * на них стоят накопительный поток (CFD) и время цикла. Прежние срезы этого не давали:
 * task_starts — только моменты без статуса, task_done_dates — только открытая DONE-версия,
 * history_task — одна задача за запрос.
 *
 * <p>{@code agent_action_points} — действия агентов точками (момент, профиль, клиент, код ответа)
 * за период: на них «действия по дням» и «отказы по кодам». agent_actions обрезан 500 последними
 * строками всех исходов — за месяц это пара дней, график по нему врал бы.
 */
class ChartsSlicesTest {

    @Test
    void taskStatusVersionsCarriesEveryVersionWithBothEnds() {
        String sql = LoreSlices.compose("task_status_versions", Map.of()).sql();
        for (String col : new String[]{"AS task_uid", "AS sprint_id", "status_raw", "valid_from", "valid_to", "version_kind"})
            assertTrue(sql.contains(col), "нет колонки " + col + ": " + sql);
        assertTrue(sql.contains("FROM KnowTaskHist"), sql);
        assertFalse(sql.contains("valid_to IS NULL"), "нужны ВСЕ версии, а не только открытая: " + sql);
    }

    @Test
    void taskStatusVersionsNarrowsBySprintAndProjectThroughEdges() {
        String bySprint = LoreSlices.compose("task_status_versions", Map.of("sprint", "SPRINT_X")).sql();
        assertTrue(bySprint.contains("out('PART_OF').sprint_id CONTAINS :sprint"), bySprint);
        String byProject = LoreSlices.compose("task_status_versions", Map.of("project", "org/a")).sql();
        assertTrue(byProject.contains("in('HAS_STATE').out('PART_OF').out('BELONGS_TO_PROJECT').slug CONTAINS :project"), byProject);
    }

    @Test
    void taskStatusVersionsIsProjectScopedLikeOtherTaskHistory() {
        assertEquals(LoreSlices.PROJECT_SCOPED.get("task_created_dates"), LoreSlices.PROJECT_SCOPED.get("task_status_versions"));
        String sql = LoreSlices.compose("task_status_versions", Map.of(), Set.of("org/a")).sql();
        assertTrue(sql.contains(":__scope0"), sql);
    }

    @Test
    void agentActionPointsAreAgentRowsWithTypedSince() {
        LoreSlices.Composed c = LoreSlices.compose("agent_action_points", Map.of("since", "2026-11-01"));
        assertTrue(c.sql().contains("FROM AgentActionLog"), c.sql());
        assertTrue(c.sql().contains("segment = 'agent'"), c.sql());
        assertTrue(c.sql().contains("ts >= :since"), c.sql());
        for (String col : new String[]{"ts", "AS caller", "client", "AS status"})
            assertTrue(c.sql().contains(col), "нет " + col + ": " + c.sql());
        assertEquals(1793491200000L, c.params().get("since"), "since — число epoch-мс: ts у ряда LONG");
    }

    @Test
    void agentActionPointsAreAdminOnlyLikeTheJournal() {
        assertTrue(LoreSlices.ADMIN_ONLY.contains("agent_action_points"));
        assertTrue(LoreSlices.adminOnlyDenied("agent_action_points", "viewer"));
        assertFalse(LoreSlices.adminOnlyDenied("agent_action_points", "admin"));
    }
}
