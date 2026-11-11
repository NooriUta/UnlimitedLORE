package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Части 3–5 общего PR контрактов (ADR-LORE-047): версия записи, права и переходы,
 * сторож закрытия спринта, путь привязки по (тип, ребро), недостающие срезы.
 * Чистые юниты — без Quarkus и БД.
 */
class LoreRecordContractUnitTest {

    // ── A3: версия = valid_from открытой Hist-строки ────────────────────────

    @Test
    void versionIsIsoAndMatchesWhatTheClientGotBack() {
        // ArcadeDB печатает DATETIME без зоны; наружу он уходит ISO-Z (LoreTimeFormat).
        String fromDb = "2026-11-08 15:14:03.730";
        String sent = LoreRecordVersion.normalize(fromDb);
        assertEquals("2026-11-08T15:14:03.730Z", sent);
        assertTrue(LoreRecordVersion.matches(sent, fromDb), "клиент вернул то, что получил, — совпадение");
        assertFalse(LoreRecordVersion.matches("2026-11-08T15:14:03.729Z", fromDb));
        assertFalse(LoreRecordVersion.matches(sent, null), "версии нет, а клиент её назвал — конфликт");
        assertNull(LoreRecordVersion.normalize(null));
    }

    @Test
    void versionSqlForEveryPassportType() {
        for (String t : LoreRecordRegistry.TYPES) {
            if (LoreRecordRegistry.READ_ONLY.contains(t)) continue;   // без истории SCD2 — версии нет, фасад её не спрашивает
            String sql = LoreRecordVersion.sql(t);
            assertTrue(sql.contains("valid_to IS NULL") && sql.contains("valid_from"), t + ": " + sql);
        }
        assertThrows(IllegalArgumentException.class, () -> LoreRecordVersion.sql("decision"));
    }

    // ── S5-08: правка на месте обязана двигать версию ───────────────────────
    // Правка текста спринта/задачи/спеки/ADR без checkpoint пишет открытую строку
    // истории на месте — valid_from стоит, двигается только updated_at вершины.
    // Версия из одного valid_from пропускала вторую правку поверх первой.

    private static Map<String, Object> vrow(Object validFrom, Object touchedAt) {
        Map<String, Object> r = new HashMap<>();
        r.put("version", validFrom);
        r.put(LoreRecordVersion.TOUCHED, touchedAt);
        return r;
    }

    @Test
    void inPlaceEditMovesTheVersion() {
        String before = LoreRecordVersion.of(vrow("2026-11-08 15:14:03.730", null));
        String after = LoreRecordVersion.of(vrow("2026-11-08 15:14:03.730", "2026-11-09T10:00:00.123456Z"));
        assertEquals("2026-11-08T15:14:03.730Z", before, "без правки на месте — прежняя форма (черновики S5-09 не протухают)");
        assertEquals("2026-11-09T10:00:00.123456Z", after);
        assertNotEquals(before, after, "правка на месте — новая версия: устаревший expected_version получит 409");
    }

    @Test
    void twoInPlaceEditsInOneMillisecondAreDifferentVersions() {
        String a = LoreRecordVersion.of(vrow("2026-11-08 15:14:03.730", "2026-11-09T10:00:00.123456Z"));
        String b = LoreRecordVersion.of(vrow("2026-11-08 15:14:03.730", "2026-11-09T10:00:00.123789Z"));
        assertNotEquals(a, b);
        assertFalse(LoreRecordVersion.matchesCurrent(a, b));
        assertTrue(LoreRecordVersion.matchesCurrent(" " + b + " ", b));
        assertFalse(LoreRecordVersion.matchesCurrent(b, null), "версии нет, а клиент её назвал — конфликт");
    }

    @Test
    void touchBeforeOpenVersionLosesToIt() {
        // Смена статуса после правки на месте открыла новую строку — версия = её valid_from.
        assertEquals("2026-11-10T08:00:00.000Z",
            LoreRecordVersion.of(vrow("2026-11-10 08:00:00.000", "2026-11-09T10:00:00.123456Z")));
        // Та же миллисекунда (путь: поля, затем статус) — побеждает открытая версия, как в LoreChangedAt.
        assertEquals("2026-11-10T08:00:00.000Z",
            LoreRecordVersion.of(vrow("2026-11-10 08:00:00.000", "2026-11-10T08:00:00.000400Z")));
    }

    @Test
    void touchWithoutHistoryAndGarbage() {
        assertEquals("2026-11-09T10:00:00.123Z", LoreRecordVersion.of(vrow(null, "2026-11-09 10:00:00.123")),
            "DATETIME из ArcadeDB — та же ISO-форма");
        assertEquals("2026-11-08T15:14:03.730Z", LoreRecordVersion.of(vrow("2026-11-08 15:14:03.730", "не время")),
            "нечитаемая отметка версию не выигрывает");
        assertNull(LoreRecordVersion.of(vrow(null, null)));
        assertNull(LoreRecordVersion.of(null));
    }

    @Test
    void versionSqlReadsTheInPlaceTouch() {
        for (String t : LoreRecordRegistry.TYPES) {
            if (LoreRecordRegistry.READ_ONLY.contains(t)) continue;
            assertTrue(LoreRecordVersion.sql(t).contains("updated_at AS " + LoreRecordVersion.TOUCHED), t);
        }
    }

    @Test
    void versionConflictBodyNamesCurrentVersion() {
        Map<String, Object> b = LoreRecordVersion.conflictBody("task", "S/T-1", "old", "2026-11-08T00:00:00Z", "agent-x");
        assertEquals("VERSION_CONFLICT", b.get("error"));
        @SuppressWarnings("unchecked") Map<String, Object> cur = (Map<String, Object>) b.get("current");
        assertEquals("2026-11-08T00:00:00Z", cur.get("version"));
        assertEquals("agent-x", cur.get("updated_by"));
    }

    // ── A5: сторож закрытия спринта ─────────────────────────────────────────

    @Test
    void onlyDoneAndCancelledCloseASprint() {
        assertTrue(SprintCloseGuard.closing("done"));
        assertTrue(SprintCloseGuard.closing("cancelled"));
        for (String s : List.of("active", "blocked", "ready_for_deploy", "planned", "todo"))
            assertFalse(SprintCloseGuard.closing(s), s);
    }

    @Test
    void openTasksAreThoseNotInAClosedCategory() {
        List<Map<String, Object>> rows = List.of(
            row("S/T-1", "сделана", "✅ DONE"),
            row("S/T-2", "отменена", "🚫 CANCELLED"),
            row("S/T-3", "в работе", "🔄 IN PROGRESS"),
            row("S/T-4", "без статуса", null),
            row("S/T-5", "влита словом", "MERGED — ветка влита"));
        List<Map<String, Object>> open = SprintCloseGuard.openTasks(rows);
        assertEquals(List.of("S/T-3", "S/T-4"), open.stream().map(r -> r.get("task_uid")).toList(),
            "закрыты done и cancelled (и слово MERGED); статус не опознан — задача считается открытой");
        assertEquals("active", open.get(0).get("status"));
        assertEquals("в работе", open.get(0).get("title"));
    }

    @Test
    void closeConflictListsOpenTasks() {
        List<Map<String, Object>> open = SprintCloseGuard.openTasks(List.of(row("S/T-3", "в работе", "🔄 IN PROGRESS")));
        Map<String, Object> b = SprintCloseGuard.conflictBody("S", "done", open);
        assertEquals("SPRINT_HAS_OPEN_TASKS", b.get("error"));
        assertEquals(1, b.get("open_count"));
        assertEquals(open, b.get("open_tasks"));
        assertTrue(String.valueOf(b.get("detail")).contains("1"));
    }

    private static Map<String, Object> row(String uid, String title, String raw) {
        Map<String, Object> m = new HashMap<>();
        m.put("task_uid", uid);
        m.put("title", title);
        if (raw != null) m.put("status_raw", raw);
        return m;
    }

    // ── A4: права и переходы ────────────────────────────────────────────────

    @Test
    void adminGetsEditStatusCreateAndPlanLifecycle() {
        Map<String, Object> p = LoreRecordPerms.of("task", "admin", true, "active", 0);
        assertEquals(true, p.get("can_edit"));
        assertEquals(true, p.get("can_status"));
        assertEquals(true, p.get("can_create"));
        @SuppressWarnings("unchecked") List<String> next = (List<String>) p.get("status_next");
        assertFalse(next.contains("active"), "текущий статус в переходах не повторяется");
        assertTrue(next.containsAll(List.of("done", "cancelled", "blocked")));
        assertNull(p.get("reason"));
    }

    @Test
    void sprintWithOpenTasksCannotGoToClosingStatuses() {
        Map<String, Object> p = LoreRecordPerms.of("sprint", "admin", true, "active", 3);
        @SuppressWarnings("unchecked") List<String> next = (List<String>) p.get("status_next");
        assertFalse(next.contains("done"));
        assertFalse(next.contains("cancelled"));
        assertTrue(next.contains("blocked"));
        assertEquals("открыто 3 задач", p.get("reason"));
    }

    @Test
    void reasonSeparatesNoRightsFromNotIdentified() {
        Map<String, Object> noRights = LoreRecordPerms.of("adr", "viewer", true, "proposed", 0);
        Map<String, Object> unknown = LoreRecordPerms.of("adr", null, false, "proposed", 0);
        assertEquals(false, noRights.get("can_edit"));
        assertEquals(false, unknown.get("can_edit"));
        assertTrue(String.valueOf(noRights.get("reason")).startsWith("нет прав"), noRights.toString());
        assertTrue(String.valueOf(unknown.get("reason")).startsWith("не опознан"), unknown.toString());
        assertEquals(List.of(), noRights.get("status_next"));
    }

    @Test
    void adrStatusesComeFromAdrLifecycle() {
        @SuppressWarnings("unchecked") List<String> next =
            (List<String>) LoreRecordPerms.of("adr", "superadmin", true, "proposed", 0).get("status_next");
        assertTrue(next.contains("accepted"));
        assertFalse(next.contains("done"), "у ADR нет плановых статусов");
    }

    // ── A2: один путь привязки по (тип, ребро, направление) ─────────────────

    @Test
    void relationRoutesResolveToExistingHandlers() {
        assertEquals(LoreRecordRelationRoutes.Handler.SPRINT_DEP,
            LoreRecordRelationRoutes.find("sprint", "DEPENDS_ON", "out").handler());
        LoreRecordRelationRoutes.Route blocks = LoreRecordRelationRoutes.find("sprint", "DEPENDS_ON", "in");
        assertTrue(blocks.reversed(), "«блокирует» — то же ребро, прочитанное входящим");
        assertEquals(LoreRecordRelationRoutes.Handler.TASK_ADR,
            LoreRecordRelationRoutes.find("adr", "JUSTIFIED_BY", "in").handler());
        assertEquals(LoreRecordRelationRoutes.Handler.QUESTION_RAISED_IN,
            LoreRecordRelationRoutes.find("task", "RAISED_IN", "in").handler());
        assertNull(LoreRecordRelationRoutes.find("sprint", "NOPE", "out"));
        assertNull(LoreRecordRelationRoutes.find("spec", "BELONGS_TO", "in"), "направление входит в ключ");
    }

    @Test
    void unknownRelationListsAllowedOnesForType() {
        List<String> allowed = LoreRecordRelationRoutes.allowed("adr");
        assertTrue(allowed.contains("DEPENDS_ON:out") && allowed.contains("SUPERSEDES:in"), allowed.toString());
        assertEquals(List.of(), LoreRecordRelationRoutes.allowed("decision"));
    }

    @Test
    void everyRouteIsAnEdgeTheRegistryKnowsAndMarksManageable() {
        for (LoreRecordRelationRoutes.Route r : LoreRecordRelationRoutes.ROUTES) {
            LoreRecordRegistry.TypeDef d = LoreRecordRegistry.get(r.type());
            assertNotNull(d, r.toString());
            assertTrue(d.relations().stream().anyMatch(x -> x.rel().equals(r.rel()) && x.dir().equals(r.dir()) && x.manageable()),
                "маршрут без ребра в реестре (или не помечен manageable): " + r);
        }
        // и обратно: управляемое в реестре обязано иметь маршрут
        for (String t : LoreRecordRegistry.TYPES)
            for (LoreRecordRegistry.Relation x : LoreRecordRegistry.get(t).relations())
                if (x.manageable())
                    assertNotNull(LoreRecordRelationRoutes.find(t, x.rel(), x.dir()), t + " " + x);
    }

    // ── Часть 5: недостающие срезы ──────────────────────────────────────────

    @Test
    void newSlicesAreRegisteredWithParamsAndProjectScope() {
        Map<String, List<String>> want = Map.of(
            "questions_of_task", List.of("id"),
            "tasks_of_adr", List.of("id"),
            "adrs_of_task", List.of("id"),
            "closed_sprints_with_open_tasks", List.of());
        for (Map.Entry<String, List<String>> e : want.entrySet()) {
            LoreSlices.SliceDef d = LoreSlices.get(e.getKey());
            assertNotNull(d, "срез " + e.getKey() + " не зарегистрирован");
            assertEquals(e.getValue(), d.required(), e.getKey());
            assertTrue(LoreSlices.PROJECT_SCOPED.containsKey(e.getKey()), e.getKey() + " обязан быть под проектным скоупом");
        }
        assertTrue(LoreSlices.get("questions_of_task").baseSql().contains("out('RAISED_IN').task_uid CONTAINS :id"));
        assertTrue(LoreSlices.get("tasks_of_adr").baseSql().contains("out('JUSTIFIED_BY').adr_id CONTAINS :id"));
        assertTrue(LoreSlices.get("adrs_of_task").baseSql().contains("in('JUSTIFIED_BY').task_uid CONTAINS :id"));
        // вопрос, поднятый в задаче, виден по проекту спринта задачи
        assertTrue(LoreSlices.PROJECT_SCOPED.get("questions_of_task").contains("out('RAISED_IN').out('PART_OF').out('BELONGS_TO_PROJECT').slug"));
    }

    @Test
    void sprintTreeCarriesOutcomeFromVertexAndTaskByUidCarriesPhaseAndUc() {
        String tree = LoreSlices.get("sprint_tree").baseSql();
        assertTrue(tree.contains("outcome_md"), "sprint_tree обязан отдавать outcome_md: " + tree);
        String byUid = LoreSlices.get("tasks_by_uids").baseSql();
        assertTrue(byUid.contains("AS phase_uid") && byUid.contains("AS realizes_uc"), byUid);
    }

    @Test
    void closedSprintsWithOpenTasksFiltersClosedSprintAndOpenTasks() {
        String sql = LoreSlices.get("closed_sprints_with_open_tasks").baseSql();
        assertTrue(sql.contains("FROM KnowSprint"), sql);
        assertTrue(sql.contains("@type = 'KnowTask'"), "фазы тоже PART_OF спринта — их не считать: " + sql);
        assertTrue(sql.contains("NOT LIKE '✅%'"), "открытая задача — не done: " + sql);
        assertTrue(sql.contains("LIKE '🚫%'"), "закрытый спринт — done или cancelled: " + sql);
        String composed = LoreSlices.compose("closed_sprints_with_open_tasks", Map.of(), Set.of("org/a")).sql();
        assertTrue(composed.indexOf(":__scope0") < composed.lastIndexOf(" ORDER BY "), composed);
    }
}
