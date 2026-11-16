package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_QG_REBUILD/QG-BRANCH-TASK-STATUS: в ветке стенда/релиза лежит код задач,
 * которые ещё не приняты. Слово владелицы 15.11: «пока только предупреждением».
 */
class QgBranchTaskStatusRoutineTest {

    private static Map<String, LoreQgResource.QGMetricEntry> byKey(List<LoreQgResource.QGMetricEntry> ms) {
        Map<String, LoreQgResource.QGMetricEntry> out = new HashMap<>();
        for (LoreQgResource.QGMetricEntry m : ms) out.put(m.key(), m);
        return out;
    }

    @Test
    void taskCodesAreTakenFromCommitMessages() {
        Set<String> uids = QgBranchTaskStatusRoutine.taskUids(List.of(
            "feat(record): блок (SPRINT_LORE_MODEL_DOCS_TIDY/MDL-10)",
            "fix(kit): плашка (SPRINT_LORE_ADMIN_POLISH/AP-SESSION-BANNER-NARROW) и [[task:SPRINT_UXR_S13_KIT4/K4-MENTION-LOOK]]",
            "Merge pull request 'record: …' (#1520) from feat/record-unmodeled into develop",
            "docs: опечатка"));
        assertEquals(Set.of("SPRINT_LORE_MODEL_DOCS_TIDY/MDL-10", "SPRINT_LORE_ADMIN_POLISH/AP-SESSION-BANNER-NARROW",
            "SPRINT_UXR_S13_KIT4/K4-MENTION-LOOK"), uids);
    }

    @Test
    void notAcceptedTaskWarnsWithItsCode() {
        List<String> commits = List.of(
            "feat: a (SPRINT_X/T-1)", "feat: b (SPRINT_X/T-2)", "feat: c (SPRINT_X/T-3)",
            "Merge pull request 'a' (#1) from f into develop", "docs: без задачи");
        Map<String, String> status = new LinkedHashMap<>();
        status.put("SPRINT_X/T-1", "🔄 IN PROGRESS");
        status.put("SPRINT_X/T-2", "🧪 UAT TESTING");
        status.put("SPRINT_X/T-3", "🚀 READY FOR DEPLOY");
        Map<String, LoreQgResource.QGMetricEntry> m =
            byKey(QgBranchTaskStatusRoutine.normalizeFacts(QgBranchTaskStatusRoutine.facts("preprod", commits, status)));

        LoreQgResource.QGMetricEntry na = m.get("branch_preprod_tasks_not_accepted");
        assertEquals(1.0, na.value());
        assertEquals("WARN", na.status(), "слово владелицы — только предупреждение, не FAIL");
        assertTrue(na.source().contains("SPRINT_X/T-1"), na.source());
        assertFalse(na.source().contains("SPRINT_X/T-2"), "принятые в список не попадают");
        assertEquals(1.0, m.get("branch_preprod_commits_without_task").value(), "слияния PR не считаются");
        assertEquals(0.0, m.get("branch_preprod_tasks_unknown").value());
    }

    @Test
    void allAcceptedPassesAndUnknownCodeIsCountedSeparately() {
        Map<String, String> status = new HashMap<>();
        status.put("SPRINT_X/T-1", "✅ DONE");
        Map<String, LoreQgResource.QGMetricEntry> m = byKey(QgBranchTaskStatusRoutine.normalizeFacts(
            QgBranchTaskStatusRoutine.facts("main", List.of("a (SPRINT_X/T-1)", "b (SPRINT_X/T-404)"), status)));
        assertEquals("PASS", m.get("branch_main_tasks_not_accepted").status());
        assertEquals(1.0, m.get("branch_main_tasks_unknown").value(), "кода нет в LORE — неизвестно, а не «всё в порядке»");
        assertEquals("WARN", m.get("branch_main_tasks_unknown").status());
    }

    @Test
    void forgejoDownIsNotMeasured() {
        for (LoreQgResource.QGMetricEntry e : QgBranchTaskStatusRoutine.normalizeFacts(
                QgBranchTaskStatusRoutine.facts("preprod", null, Map.of()))) {
            assertEquals("NOT_MEASURED", e.status(), e.key());
            assertEquals("source_unreachable", e.not_measured_reason(), e.key());
            assertNull(e.value(), e.key());
        }
    }

    @Test
    void acceptedMeansReadyUatDoneOrReview() {
        assertTrue(QgBranchTaskStatusRoutine.accepted("🚀 READY FOR DEPLOY"));
        assertTrue(QgBranchTaskStatusRoutine.accepted("🧪 UAT TESTING"));
        assertTrue(QgBranchTaskStatusRoutine.accepted("✅ DONE"));
        assertTrue(QgBranchTaskStatusRoutine.accepted("🔍 REVIEW"));
        assertFalse(QgBranchTaskStatusRoutine.accepted("🔄 IN PROGRESS"));
        assertFalse(QgBranchTaskStatusRoutine.accepted("🔴 BLOCKED"));
        assertFalse(QgBranchTaskStatusRoutine.accepted("🟡 PARTIAL"));
        assertFalse(QgBranchTaskStatusRoutine.accepted(null));
    }
}
