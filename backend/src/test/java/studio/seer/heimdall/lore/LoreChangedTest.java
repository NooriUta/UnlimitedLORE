package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-MCP-CHANGED-RANGE, остаток (v1.17.14): {@code GET /lore/changed} —
 * «что изменилось с … по …» одной выдачей по многим типам. Повод (владелица 11.11.2026): после
 * ревью «закрыли 27, 42 на доработку» агенту нечем было посмотреть правки за период по всем
 * объектам сразу — только срез за срезом.
 *
 * <p>Чистые функции {@link LoreChanged} — без базы: разбор запроса, отбор по периоду, статус
 * «было → стало» из истории SCD2, кто менял, фильтры, сводка с {@code page} и {@code errors[]}.
 * Честность: тип, который не прочитался, — в {@code errors[]}, и тогда ответ НЕ говорит
 * «ничего не изменилось».</p>
 */
class LoreChangedTest {

    private static Map<String, String> params(String... kv) {
        Map<String, String> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(kv[i], kv[i + 1]);
        return m;
    }

    private static Map<String, Object> task(String uid, String status, String changedAt) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("task_uid", uid);
        r.put("title", "T " + uid);
        r.put("status_raw", status);
        r.put("changed_at", changedAt);
        return r;
    }

    private static Map<String, Object> ver(String id, String validFrom, String status, String by, String kind) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("ref_id", id);
        r.put("valid_from", validFrom);
        r.put("status_v", status);
        r.put("changed_by", by);
        r.put("changed_by_kind", kind);
        return r;
    }

    private static LoreChanged.Query q(String... kv) {
        return LoreChanged.parse(params(kv));
    }

    private static List<String> refs(List<Map<String, Object>> items) {
        List<String> out = new ArrayList<>();
        for (Map<String, Object> i : items) out.add(String.valueOf(i.get("ref_id")));
        return out;
    }

    // ── разбор запроса ────────────────────────────────────────────────────────

    @Test
    void typesDefaultToAllKnownAndUnknownTypeIsRefused() {
        LoreChanged.Query all = q("from", "2026-11-10");
        assertTrue(all.types().containsAll(List.of("task", "adr", "decision", "spec", "question", "release",
            "sprint", "milestone", "component", "feature")), "без types — все типы: " + all.types());
        assertEquals(List.of("task", "adr"), q("from", "2026-11-10", "types", "task, adr").types());
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
            () -> q("from", "2026-11-10", "types", "task,bogus"));
        assertTrue(e.getMessage().contains("bogus") && e.getMessage().contains("task"),
            "отказ называет неизвестный тип и перечисляет известные: " + e.getMessage());
    }

    @Test
    void periodIsRequiredAndValidated() {
        assertThrows(IllegalArgumentException.class, () -> q("types", "task"), "без from и to — «всё», а не «изменённое»");
        assertThrows(IllegalArgumentException.class, () -> q("from", "вчера"));
        assertThrows(IllegalArgumentException.class, () -> q("from", "2026-11-12", "to", "2026-11-10"));
        assertThrows(IllegalArgumentException.class, () -> q("from", "2026-11-10", "status_category", "half-open"));
        assertThrows(IllegalArgumentException.class, () -> q("from", "2026-11-10", "limit", "0"));
        assertThrows(IllegalArgumentException.class, () -> q("from", "2026-11-10", "unknown", "x"),
            "неизвестный параметр — отказ, а не тихое игнорирование");
    }

    // ── отбор по периоду и «было → стало» ─────────────────────────────────────

    @Test
    void periodBoundsAreInclusiveUtcDays() {
        LoreChanged.Source task = LoreChanged.SOURCES.get("task");
        List<Map<String, Object>> rows = List.of(
            task("S/A", "✅ DONE", "2026-11-09T23:59:59.999Z"),
            task("S/B", "✅ DONE", "2026-11-10T00:00:00.000Z"),
            task("S/C", "🔄 IN PROGRESS", "2026-11-11 23:59:59"),
            task("S/D", "✅ DONE", "2026-11-12T00:00:00.000Z"),
            task("S/E", "✅ DONE", null));
        LoreChanged.Query query = q("from", "2026-11-10", "to", "2026-11-11");
        assertEquals(List.of("S/B", "S/C"), LoreChanged.changedIds(task, rows, query));
        assertEquals(List.of("S/B", "S/C"), refs(LoreChanged.items(task, rows, null, query)));
    }

    @Test
    void statusWasIsTheVersionOpenBeforeThePeriodAndAuthorIsTheLastVersionInside() {
        LoreChanged.Source task = LoreChanged.SOURCES.get("task");
        List<Map<String, Object>> rows = List.of(task("S/A", "✅ DONE", "2026-11-11T09:00:00Z"));
        List<Map<String, Object>> hist = List.of(
            ver("S/A", "2026-11-01 10:00:00", "📋 PLANNED", "kimi", "agent"),
            ver("S/A", "2026-11-05 10:00:00", "🔄 IN PROGRESS", "claude", "agent"),
            ver("S/A", "2026-11-11 09:00:00", "✅ DONE", "omiloreadmin", "human"));
        Map<String, Object> it = LoreChanged.items(task, rows, hist, q("from", "2026-11-10", "to", "2026-11-11")).get(0);
        assertEquals("task", it.get("type"));
        assertEquals("T S/A", it.get("title"));
        assertEquals("🔄 IN PROGRESS", it.get("status_was"), "было — версия, открытая к началу периода");
        assertEquals("✅ DONE", it.get("status_now"));
        assertEquals(Boolean.TRUE, it.get("status_changed"));
        assertEquals("finished", it.get("status_category"));
        assertEquals("omiloreadmin", it.get("changed_by"));
        assertEquals("human", it.get("changed_by_kind"));
        assertEquals("versions", it.get("history"));
        assertEquals("2026-11-11T09:00:00.000Z", it.get("changed_at"), "время — ISO UTC");
    }

    @Test
    void createdInPeriodHasNoStatusWasAndSaysSo() {
        LoreChanged.Source task = LoreChanged.SOURCES.get("task");
        List<Map<String, Object>> rows = List.of(task("S/N", "📋 PLANNED", "2026-11-10T08:00:00Z"));
        List<Map<String, Object>> hist = List.of(ver("S/N", "2026-11-10 08:00:00", "📋 PLANNED", "kimi", "agent"));
        Map<String, Object> it = LoreChanged.items(task, rows, hist, q("from", "2026-11-10")).get(0);
        assertNull(it.get("status_was"));
        assertEquals(Boolean.TRUE, it.get("created_in_period"));
        assertEquals(Boolean.FALSE, it.get("status_changed"));
    }

    @Test
    void historyFailureIsNotPassedOffAsNoChange() {
        LoreChanged.Source task = LoreChanged.SOURCES.get("task");
        List<Map<String, Object>> rows = List.of(task("S/A", "✅ DONE", "2026-11-11T09:00:00Z"));
        Map<String, Object> it = LoreChanged.items(task, rows, null, q("from", "2026-11-10")).get(0);
        assertEquals("unavailable", it.get("history"), "история не прочиталась — «было» неизвестно, а не равно «стало»");
        assertNull(it.get("status_changed"));
        Map<String, Object> comp = new LinkedHashMap<>(Map.of("component_id", "OMILORE", "full_name", "omi",
            "changed_at", "2026-11-11T09:00:00Z"));
        Map<String, Object> c = LoreChanged.items(LoreChanged.SOURCES.get("component"), List.of(comp), null,
            q("from", "2026-11-10")).get(0);
        assertEquals("not_tracked", c.get("history"), "у типа без цепочки SCD2 истории нет по модели");
    }

    // ── фильтры ──────────────────────────────────────────────────────────────

    @Test
    void statusCategoryAndActorFilter() {
        LoreChanged.Source task = LoreChanged.SOURCES.get("task");
        List<Map<String, Object>> rows = List.of(
            task("S/A", "✅ DONE", "2026-11-11T09:00:00Z"),
            task("S/B", "🔄 IN PROGRESS", "2026-11-11T10:00:00Z"));
        List<Map<String, Object>> hist = List.of(
            ver("S/A", "2026-11-11 09:00:00", "✅ DONE", "omiloreadmin", "human"),
            ver("S/B", "2026-11-11 10:00:00", "🔄 IN PROGRESS", "kimi", "agent"));
        assertEquals(List.of("S/A"), refs(LoreChanged.items(task, rows, hist, q("from", "2026-11-11", "status_category", "closed"))));
        assertEquals(List.of("S/B"), refs(LoreChanged.items(task, rows, hist, q("from", "2026-11-11", "status_category", "open"))));
        assertEquals(List.of("S/B"), refs(LoreChanged.items(task, rows, hist, q("from", "2026-11-11", "actor", "KIMI"))));
        assertEquals(List.of("open_tasks"), LoreChanged.slicesFor(task, "open"));
        assertEquals(List.of("closed_tasks"), LoreChanged.slicesFor(task, "closed"));
        assertEquals(List.of("open_tasks", "closed_tasks"), LoreChanged.slicesFor(task, null));
    }

    @Test
    void projectFilterIsNeverSilentlyDropped() {
        // Тип со своим параметром project — уходит в срез; тип без проектной оси — причина, а не «всё».
        assertEquals(Map.of("project", "NooriUta/UnlimitedLORE"),
            LoreChanged.sliceParams(LoreChanged.SOURCES.get("task"), "NooriUta/UnlimitedLORE"));
        assertNull(LoreChanged.projectUnsupported(LoreChanged.SOURCES.get("adr"), "NooriUta/UnlimitedLORE"));
        assertNotNull(LoreChanged.projectUnsupported(LoreChanged.SOURCES.get("milestone"), "NooriUta/UnlimitedLORE"),
            "у вех нет проекта — фильтр по проекту к ним неприменим, и это говорится");
        Map<String, Object> adrIn = new LinkedHashMap<>(Map.of("adr_id", "ADR-1", "name", "a", "status", "accepted",
            "changed_at", "2026-11-11T09:00:00Z", "git_projects", List.of("NooriUta/UnlimitedLORE")));
        Map<String, Object> adrOut = new LinkedHashMap<>(Map.of("adr_id", "ADR-2", "name", "b", "status", "accepted",
            "changed_at", "2026-11-11T09:00:00Z", "git_projects", List.of("Other/Repo")));
        assertEquals(List.of("ADR-1"), refs(LoreChanged.items(LoreChanged.SOURCES.get("adr"), List.of(adrIn, adrOut), null,
            q("from", "2026-11-11", "project", "NooriUta/UnlimitedLORE"))));
    }

    // ── сводка ───────────────────────────────────────────────────────────────

    @Test
    @SuppressWarnings("unchecked")
    void assembleSortsDescAcrossTypesAndPages() {
        List<Map<String, Object>> items = new ArrayList<>();
        items.add(new LinkedHashMap<>(Map.of("type", "task", "ref_id", "S/A", "changed_at", "2026-11-10T09:00:00.000Z")));
        items.add(new LinkedHashMap<>(Map.of("type", "adr", "ref_id", "ADR-1", "changed_at", "2026-11-11T09:00:00.000Z")));
        items.add(new LinkedHashMap<>(Map.of("type", "spec", "ref_id", "SPEC-1", "changed_at", "2026-11-10T12:00:00.000Z")));
        Map<String, Object> body = LoreChanged.assemble(q("from", "2026-11-10", "limit", "2"), items, List.of());
        assertEquals(List.of("ADR-1", "SPEC-1"), refs((List<Map<String, Object>>) body.get("rows")));
        Map<String, Object> page = (Map<String, Object>) body.get("page");
        assertEquals(3, page.get("total"));
        assertEquals(Boolean.TRUE, page.get("has_more"));
        assertEquals("UTC", body.get("time_zone"));
        assertEquals(Boolean.TRUE, body.get("complete"));
        assertEquals(Boolean.FALSE, body.get("nothing_changed"));
    }

    @Test
    void unreadTypeMakesTheAnswerIncompleteNotEmpty() {
        List<Map<String, Object>> errors = List.of(Map.of("type", "adr", "stage", "list", "reason", "upstream 502"));
        Map<String, Object> body = LoreChanged.assemble(q("from", "2026-11-10"), List.of(), errors);
        assertEquals(Boolean.FALSE, body.get("complete"));
        assertEquals(Boolean.FALSE, body.get("nothing_changed"), "0 строк при сбое типа — не «ничего не изменилось»");
        assertEquals(errors, body.get("errors"));
        assertNotNull(body.get("warning"));
        Map<String, Object> clean = LoreChanged.assemble(q("from", "2026-11-10"), List.of(), List.of());
        assertEquals(Boolean.TRUE, clean.get("nothing_changed"), "полный ответ без строк — тогда и только тогда «ничего»");
    }

    @Test
    void historySqlSelectsVersionsOfChangedIdsOnly() {
        String sql = LoreChanged.histSql(LoreChanged.SOURCES.get("task"));
        assertTrue(sql.contains("FROM KnowTaskHist"), sql);
        assertTrue(sql.contains("in('HAS_STATE').task_uid[0] IN :ids"), sql);
        assertTrue(sql.contains("changed_by") && sql.contains("valid_from") && sql.contains("AS status_v"), sql);
        assertNull(LoreChanged.histSql(LoreChanged.SOURCES.get("component")), "у компонента цепочки нет");
        // Каждый срез источника существует в реестре — иначе тип молча пустел бы.
        for (LoreChanged.Source s : LoreChanged.SOURCES.values())
            for (String slice : LoreChanged.slicesFor(s, null))
                assertNotNull(LoreSlices.get(slice), s.type() + " → нет среза " + slice);
    }
}
