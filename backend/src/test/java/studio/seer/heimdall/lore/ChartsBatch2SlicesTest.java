package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Графики второй пачки (предложение 19.11.2026, «добавляй графики»: 9, 11, 16) — срезы, которых не было.
 *
 * <p>{@code pr_ship_lag} — PR с моментом мержа и датой его релиза: «от мержа до прода» (№9). Прежние
 * срезы PR отдают merged_at без релиза (project_prs) или требуют тег (release_prs_by_tag).
 *
 * <p>{@code decision_status_versions} — версии решений СО СТАТУСОМ и пометкой бэкфилла: «поток решений» (№11).
 * decision_history_all статуса не несёт и обрезан 300 строками.
 *
 * <p>{@code qg_run_outcomes} — прогоны гейтов за период без потолка 200: «доля пройденных по неделям» (№16).
 * qg_routine_runs — 200 последних, а супервизор пишет прогон раз в час: это неделя, не квартал.
 */
class ChartsBatch2SlicesTest {

    @Test
    void prShipLagCarriesMergeMomentAndReleaseDate() {
        String sql = LoreSlices.compose("pr_ship_lag", Map.of()).sql();
        for (String col : new String[]{"pr_uid", "merged_at", "AS release_date", "AS released_at", "AS release_id"})
            assertTrue(sql.contains(col), "нет " + col + ": " + sql);
        assertTrue(sql.contains("FROM KnowPR"), sql);
        assertTrue(sql.contains("out('SHIPPED_IN').size() > 0"), "только выпущенные PR: " + sql);
        String byProject = LoreSlices.compose("pr_ship_lag", Map.of("project", "org/a")).sql();
        assertTrue(byProject.contains("out('SHIPPED_IN').out('BELONGS_TO_PROJECT').slug CONTAINS :project"), byProject);
        assertTrue(LoreSlices.SCOPE_PENDING.containsKey("pr_ship_lag"), "KnowPR — как release_prs: путь через релиз, решение");
    }

    @Test
    void decisionStatusVersionsCarryStatusAndBackfillMark() {
        String sql = LoreSlices.compose("decision_status_versions", Map.of()).sql();
        for (String col : new String[]{"AS decision_id", "status_raw", "valid_from", "status_backfilled"})
            assertTrue(sql.contains(col), "нет " + col + ": " + sql);
        assertTrue(sql.contains("FROM KnowDecisionHist"), sql);
        assertFalse(sql.contains("LIMIT"), "без потолка 300 — поток за квартал: " + sql);
        assertEquals(LoreSlices.PROJECT_SCOPED.get("decision_history_all"), LoreSlices.PROJECT_SCOPED.get("decision_status_versions"));
        assertTrue(LoreSlices.compose("decision_status_versions", Map.of(), Set.of("org/a")).sql().contains(":__scope0"));
    }

    @Test
    void qgRunOutcomesFromSinceWithoutTheLastTwoHundredCap() {
        String sql = LoreSlices.compose("qg_run_outcomes", Map.of("since", "2026-08-01")).sql();
        assertTrue(sql.contains("FROM ClRoutineRun"), sql);
        assertTrue(sql.contains("routine_name LIKE 'qg-%'"), sql);
        assertTrue(sql.contains("run_date >= :since"), sql);
        assertFalse(sql.contains("LIMIT"), sql);
        for (String col : new String[]{"routine_name", "run_date", "started_at", "status"})
            assertTrue(sql.contains(col), "нет " + col + ": " + sql);
        assertTrue(LoreSlices.SCOPE_PENDING.containsKey("qg_run_outcomes"), "QG — как qg_routine_runs (QG-04)");
    }
}
