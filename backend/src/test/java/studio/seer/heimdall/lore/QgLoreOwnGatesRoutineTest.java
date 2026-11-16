package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_QG_REBUILD/QG-01: собственные гейты LORE переезжают из инструкций-текстов
 * (content_md гейта: «query_slice … → qg_run_log») в рутины канала 2 по ADR-LORE-053.
 * Числа — код (чистые функции ниже), источник — те же срезы, что в админке.
 */
class QgLoreOwnGatesRoutineTest {

    private static Map<String, Object> row(Object... kv) {
        Map<String, Object> m = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    private static Map<String, LoreQgResource.QGMetricEntry> byKey(List<LoreQgResource.QGMetricEntry> ms) {
        Map<String, LoreQgResource.QGMetricEntry> out = new HashMap<>();
        for (LoreQgResource.QGMetricEntry m : ms) out.put(m.key(), m);
        return out;
    }

    // ── qg-lore-blocked-reason (QG-LORE-BLOCKED-REASON, пять информационных проверок) ──

    @Test
    void blockedReasonCountsFiveChecks() {
        List<Map<String, Object>> blocked = List.of(
            // объяснён текстом — не находка
            row("sprint_id", "S1", "block_reason", "ждём ключ", "task_count", 3, "deps", List.of(), "open_deps", List.of(), "open_questions", List.of()),
            // ничем не объяснён
            row("sprint_id", "S2", "block_reason", null, "task_count", 2, "deps", List.of(), "open_deps", List.of(), "open_questions", List.of()),
            // протухший: зависимости есть, все закрыты; и пустая оболочка
            row("sprint_id", "S3", "block_reason", "", "task_count", 0, "deps", List.of("S9"), "open_deps", List.of(), "open_questions", List.of()),
            // объяснён открытым вопросом
            row("sprint_id", "S4", "block_reason", null, "task_count", 1, "deps", List.of(), "open_deps", List.of(), "open_questions", List.of("Q-1")));
        List<Map<String, Object>> sprints = List.of(
            row("sprint_id", "SPRINT_X_BACKLOG", "name", "Backlog of X", "status_raw", "🔴 BLOCKED"),
            row("sprint_id", "SPRINT_Y_BACKLOG", "name", "Y backlog", "status_raw", "📋 PLANNED"),
            row("sprint_id", "SPRINT_Z", "name", "Z", "status_raw", "🔄 IN PROGRESS"));
        List<QgRoutine.RawFact> raw = QgLoreBlockedReasonRoutine.facts(blocked, sprints, 2);
        Map<String, LoreQgResource.QGMetricEntry> m = byKey(QgLoreBlockedReasonRoutine.normalizeFacts(raw));

        assertEquals(1.0, m.get("blocked_unexplained").value(), "S3 объяснён зависимостью, хоть и протухшей");
        assertEquals(1.0, m.get("blocked_stale_deps").value());
        assertEquals(1.0, m.get("blocked_empty_shell").value());
        assertEquals(1.0, m.get("backlog_status_mismatch").value());
        assertEquals(2.0, m.get("questions_gating_closed_tasks").value());
        assertEquals("WARN", m.get("blocked_unexplained").status(), "информационный гейт — WARN, не FAIL");
    }

    @Test
    void blockedReasonUnreachableSourceIsNotMeasuredNotZero() {
        List<QgRoutine.RawFact> raw = QgLoreBlockedReasonRoutine.facts(null, null, null);
        for (LoreQgResource.QGMetricEntry e : QgLoreBlockedReasonRoutine.normalizeFacts(raw)) {
            assertNull(e.value(), e.key());
            assertEquals("NOT_MEASURED", e.status(), e.key());
            assertEquals("source_unreachable", e.not_measured_reason(), e.key());
        }
    }

    @Test
    void blockedReasonCleanCorpusPasses() {
        List<QgRoutine.RawFact> raw = QgLoreBlockedReasonRoutine.facts(List.of(), List.of(), 0);
        for (LoreQgResource.QGMetricEntry e : QgLoreBlockedReasonRoutine.normalizeFacts(raw))
            assertEquals("PASS", e.status(), e.key());
    }

    // ── qg-lore-project-binding (QG-LORE-PROJECT-BINDING) ──

    @Test
    void projectBindingCountsPerTypeAndTotal() {
        List<Map<String, Object>> rows = new ArrayList<>();
        rows.add(row("entity_type", "question", "ref_id", "Q-1"));
        rows.add(row("entity_type", "question", "ref_id", "Q-2"));
        rows.add(row("entity_type", "runbook", "ref_id", "RB-1"));
        Map<String, LoreQgResource.QGMetricEntry> m =
            byKey(QgLoreProjectBindingRoutine.normalizeFacts(QgLoreProjectBindingRoutine.facts(rows)));
        assertEquals(3.0, m.get("entities_without_project_total").value());
        assertEquals(2.0, m.get("entities_without_project_question").value());
        assertEquals(1.0, m.get("entities_without_project_runbook").value());
        assertEquals("WARN", m.get("entities_without_project_total").status());
    }

    @Test
    void projectBindingUnreachableIsNotMeasured() {
        List<LoreQgResource.QGMetricEntry> ms =
            QgLoreProjectBindingRoutine.normalizeFacts(QgLoreProjectBindingRoutine.facts(null));
        assertEquals(1, ms.size());
        assertEquals("NOT_MEASURED", ms.get(0).status());
        assertEquals("source_unreachable", ms.get(0).not_measured_reason());
    }

    // ── qg-lore-project-roles (QG-LORE-PROJECT-ROLES: 0 → PASS, ≥1 → FAIL) ──

    @Test
    void projectRolesFailsOnAnyProjectWithoutRole() {
        Map<String, LoreQgResource.QGMetricEntry> none =
            byKey(QgLoreProjectRolesRoutine.normalizeFacts(QgLoreProjectRolesRoutine.facts(List.of())));
        assertEquals("PASS", none.get("projects_without_role").status());
        Map<String, LoreQgResource.QGMetricEntry> two = byKey(QgLoreProjectRolesRoutine.normalizeFacts(
            QgLoreProjectRolesRoutine.facts(List.of(row("slug", "AIDA/MIDGARD"), row("slug", "AIDA/GLADSHEIM")))));
        assertEquals(2.0, two.get("projects_without_role").value());
        assertEquals("FAIL", two.get("projects_without_role").status());
        assertTrue(two.get("projects_without_role").source().contains("AIDA/MIDGARD"), "список проектов — в источнике метрики");
        LoreQgResource.QGMetricEntry nm = QgLoreProjectRolesRoutine.normalizeFacts(QgLoreProjectRolesRoutine.facts(null)).get(0);
        assertEquals("NOT_MEASURED", nm.status());
    }

    // ── общие требования ADR-LORE-053 ──

    @Test
    void routinesReadOnlyExistingSlicesAndAreDaily() {
        for (String s : List.of("blocked_sprints_reason", "sprints", "questions_gating_closed_tasks",
                "entities_without_project", "projects_without_role"))
            assertNotNull(LoreSlices.get(s), "рутина ссылается на несуществующий срез " + s + " — исходная болезнь QG-01");
        assertEquals("qg-lore-blocked-reason", new QgLoreBlockedReasonRoutine().name());
        assertEquals("qg-lore-project-binding", new QgLoreProjectBindingRoutine().name());
        assertEquals("qg-lore-project-roles", new QgLoreProjectRolesRoutine().name());
        assertEquals(java.time.Duration.ofDays(1), new QgLoreProjectRolesRoutine().cadence());
    }
}
