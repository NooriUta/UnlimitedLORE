package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-NOTE-APPEND п.3 · decision:D-2026-NOTE-APPEND-IS-WORTH-FIXING (вариант А).
 *
 * <p>Правка текста (note_md задачи, context_md / outcome_md спринта) БЕЗ смены статуса меняла
 * открытую строку истории на месте: прежний текст жил только в {@code previous} ответа, откатить
 * правку было нечем. Теперь правка открывает НОВУЮ версию SCD2: открытая строка закрывается
 * условно (Scd2Guard), вставляется копия со всеми полями версии и новым текстом.
 *
 * <p>Обратная сторона, которую сторожат тесты ниже: версия-правка текста НЕ смена статуса.
 * Статус, его категория и момент «статус известен с» переносятся как есть; вершина не трогается;
 * срезы, которые читают момент открытой версии как момент статуса (дата закрытия задачи,
 * «сколько в текущем статусе»), берут {@code status_known_from}, а не {@code valid_from}.
 */
class TextVersionTest {

    private static final ChangeAuthor AGENT = new ChangeAuthor("lore-mcp-probe", ChangeAuthor.KIND_AGENT);

    private static Map<String, Object> row(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    private static Map<String, Object> taskOpen() {
        return row("@rid", "#7:1", "@type", "KnowTaskHist", "state_uid", "OLD",
            "valid_from", "2026-11-10T09:00:00.000Z", "valid_to", null,
            "status_raw", "✅ DONE", "status_category", "finished",
            "status_known_from", "2026-11-10T09:00:00.000Z",
            "changed_by", "someone", "changed_by_kind", "human",
            "note_md", "A", "effort_days", 2, "evidence_md", "PR #1", "workflow_stage", "review",
            "content_hash", "deadbeef");
    }

    @Test
    void taskNoteEditOpensANewVersionCopyingEveryFieldOfTheOldOne() {
        StatusHistoryServiceTest.FakeDb db = new StatusHistoryServiceTest.FakeDb();
        db.open = taskOpen();
        var o = StatusHistoryService.textVersion(db, "task", "S/T-1", Map.of("note_md", "A\n\nB"), AGENT,
            "2026-11-14T12:00:00Z", "NSID");
        assertInstanceOf(StatusHistoryService.Outcome.Ok.class, o);
        assertEquals(1, db.scripts.size(), "один sqlscript на версию");
        String s = db.scripts.get(0);
        Map<String, Object> p = db.scriptParams.get(0);
        assertTrue(s.contains("UPDATE KnowTaskHist SET valid_to = :now RETURN AFTER WHERE @rid = :oldrid AND valid_to IS NULL"),
            "закрытие условное (Scd2Guard): " + s);
        assertEquals("#7:1", p.get("oldrid"));
        assertTrue(s.contains("INSERT INTO KnowTaskHist SET "), s);
        assertTrue(s.contains("CREATE EDGE HAS_STATE FROM (SELECT FROM KnowTask"), s);
        // новый текст
        assertEquals("A\n\nB", p.get("t_note_md"));
        assertTrue(s.contains("note_md = :t_note_md"), s);
        // поля версии, которые ПРОДОЛЖАЮТСЯ: статус тот же, workflow-поля те же
        for (String f : List.of("status_raw", "status_category", "effort_days", "evidence_md", "workflow_stage"))
            assertTrue(s.contains(f + " = :c_" + f), "перенос " + f + ": " + s);
        assertEquals("✅ DONE", p.get("c_status_raw"));
        assertEquals("2026-11-10T09:00:00.000Z", p.get("skf"), "статус известен с прежнего момента, не с правки");
        // новая версия — свои state_uid / valid_from / автор и пометка «правка текста»
        assertTrue(s.contains("state_uid = :nsid") && s.contains("valid_from = :now"), s);
        assertTrue(s.contains("version_kind = :vk"), s);
        assertEquals(StatusHistoryService.TEXT_VERSION, p.get("vk"));
        assertEquals("lore-mcp-probe", p.get("changed_by"));
        // не переносятся: служебные поля старой версии, автор старой версии и хэш старого текста
        assertFalse(p.containsKey("c_state_uid") || p.containsKey("c_valid_from") || p.containsKey("c_valid_to"), p.toString());
        assertFalse(p.containsKey("c_changed_by"), "автор старой версии не переносится");
        assertFalse(p.containsKey("c_content_hash"), "хэш старого текста не выдаётся за хэш нового");
        assertFalse(p.containsKey("c_note_md"), "старая заметка не переносится поверх новой");
        // статус вершины не трогается — это не смена статуса
        assertFalse(s.contains("UPDATE KnowTask SET"), "вершина не трогается: " + s);
        assertEquals("✅ DONE", ((StatusHistoryService.Outcome.Ok) o).newStatus());
        assertEquals("✅ DONE", ((StatusHistoryService.Outcome.Ok) o).oldStatus());
    }

    @Test
    void legacyRowWithoutStatusKnownFromPassesItsValidFromAsTheStatusMoment() {
        StatusHistoryServiceTest.FakeDb db = new StatusHistoryServiceTest.FakeDb();
        Map<String, Object> open = taskOpen();
        open.remove("status_known_from");
        open.put("valid_from", "2026-10-01T08:00:00.000Z");
        db.open = open;
        StatusHistoryService.textVersion(db, "task", "S/T-1", Map.of("note_md", "B"), AGENT, "2026-11-14T12:00:00Z", "N");
        assertEquals("2026-10-01T08:00:00.000Z", db.scriptParams.get(0).get("skf"),
            "без status_known_from момент статуса — начало старой версии, иначе дата закрытия уплыла бы на дату правки");
        assertTrue(db.scripts.get(0).contains("status_known_from = :skf"));
    }

    @Test
    void unchangedTextWritesNothing() {
        StatusHistoryServiceTest.FakeDb db = new StatusHistoryServiceTest.FakeDb();
        db.open = taskOpen();
        var o = StatusHistoryService.textVersion(db, "task", "S/T-1", Map.of("note_md", "A", "effort_days", 2.0), AGENT, "t", "n");
        assertInstanceOf(StatusHistoryService.Outcome.Unchanged.class, o);
        assertTrue(db.scripts.isEmpty(), "тот же текст — версия не открывается");
    }

    @Test
    void noOpenVersionIsNotFoundAndWritesNothing() {
        StatusHistoryServiceTest.FakeDb db = new StatusHistoryServiceTest.FakeDb();
        var o = StatusHistoryService.textVersion(db, "task", "S/T-1", Map.of("note_md", "x"), AGENT, "t", "n");
        assertInstanceOf(StatusHistoryService.Outcome.NotFound.class, o);
        assertTrue(db.scripts.isEmpty());
    }

    @Test
    void concurrentCloseIsAConflictNotASecondOpenVersion() {
        StatusHistoryServiceTest.FakeDb db = new StatusHistoryServiceTest.FakeDb();
        db.open = taskOpen();
        db.scriptResult = List.of(Scd2Guard.CONFLICT_MARK);
        var o = StatusHistoryService.textVersion(db, "task", "S/T-1", Map.of("note_md", "x"), AGENT, "t", "n");
        assertInstanceOf(StatusHistoryService.Outcome.Conflict.class, o);
    }

    @Test
    void onlyTextFieldsOfKnownTypesAreVersionedThisWay() {
        StatusHistoryServiceTest.FakeDb db = new StatusHistoryServiceTest.FakeDb();
        db.open = taskOpen();
        assertInstanceOf(StatusHistoryService.Outcome.BadType.class,
            StatusHistoryService.textVersion(db, "task", "S/T-1", Map.of("status_raw", "x"), AGENT, "t", "n"),
            "статус меняет только transition");
        assertInstanceOf(StatusHistoryService.Outcome.BadType.class,
            StatusHistoryService.textVersion(db, "adr", "ADR-1", Map.of("note_md", "x"), AGENT, "t", "n"));
        assertTrue(db.scripts.isEmpty());
    }

    @Test
    void sprintTextEditCarriesBothTextsWholeAndKeepsTheBlockReasonOfTheContinuingState() {
        StatusHistoryServiceTest.FakeDb db = new StatusHistoryServiceTest.FakeDb();
        db.open = row("@rid", "#9:3", "state_uid", "OLD", "valid_from", "2026-11-01T00:00:00Z",
            "status_raw", "🚫 BLOCKED", "status_known_from", "2026-11-02T00:00:00Z",
            "block_reason", "ждём KC", "priority", "P1", "pr_refs", List.of(12), "context_md", "старый", "outcome_md", "итог");
        Map<String, Object> texts = new LinkedHashMap<>();
        texts.put("context_md", "новый контекст");
        texts.put("outcome_md", null);
        var o = StatusHistoryService.textVersion(db, "sprint", "SPRINT_X", texts, AGENT, "2026-11-14T12:00:00Z", "N");
        assertInstanceOf(StatusHistoryService.Outcome.Ok.class, o);
        String s = db.scripts.get(0);
        Map<String, Object> p = db.scriptParams.get(0);
        assertTrue(s.startsWith(Scd2Guard.lockChain("KnowSprint", "KnowSprintHist")), s);
        assertEquals("новый контекст", p.get("t_context_md"));
        assertTrue(s.contains("outcome_md = :t_outcome_md") && p.containsKey("t_outcome_md") && p.get("t_outcome_md") == null,
            "пустое второе поле пишется как есть (null), а не остаётся прежним: " + s);
        assertEquals("ждём KC", p.get("c_block_reason"), "блокировка продолжается — её причина тоже");
        assertEquals("P1", p.get("c_priority"));
        assertEquals("2026-11-02T00:00:00Z", p.get("skf"));
        assertFalse(s.contains("UPDATE KnowSprint SET"), s);
    }

    @Test
    void statusTransitionAfterATextVersionDoesNotInheritTheTextMark() {
        assertTrue(StatusHistoryService.VERSION_FIELDS.contains("version_kind"),
            "смена статуса после правки текста — уже не правка текста");
        StatusHistoryServiceTest.FakeDb db = new StatusHistoryServiceTest.FakeDb();
        db.vertex = row("cur", "x");
        db.open = row("@rid", "#1:2", "status_raw", "x", "version_kind", StatusHistoryService.TEXT_VERSION);
        StatusHistoryService.transition(db, "task", "S/T-1", null, "done", AGENT, "t", "n");
        assertFalse(db.scriptParams.get(0).containsKey("c_version_kind"), db.scripts.get(0));
    }

    // ── срезы: версия-правка текста не сдвигает момент статуса ──

    @Test
    void taskDoneDateIsTheStatusMomentNotTheLastVersionStart() {
        String sql = LoreSlices.compose("task_done_dates", Map.of()).sql();
        assertTrue(sql.contains("ifnull(status_known_from, valid_from) AS valid_from"),
            "правка заметки закрытой задачи не должна переносить дату закрытия: " + sql);
        assertTrue(sql.contains("out('HAS_STATE')[version_kind IS NULL].size() AS states"),
            "states (>1 — реальная прогрессия) считает смены статуса, не правки текста: " + sql);
    }

    @Test
    void timeInCurrentStatusReadsTheStatusMoment() {
        assertTrue(LoreTaskShapeResource.SQL.contains(LoreSlices.STATUS_SINCE_SQL + " AS state_since"), LoreTaskShapeResource.SQL);
        assertTrue(LoreQualityFacts.Kind.TASK.selectFor(List.of("S/T-1")).contains(LoreSlices.STATUS_SINCE_SQL),
            "застрявший partial судится по моменту статуса");
        assertTrue(LoreSlices.compose("reeng_load", Map.of()).sql().contains(LoreSlices.STATUS_SINCE_SQL + " AS status_since"));
        assertTrue(LoreSlices.STATUS_SINCE_SQL.contains("status_known_from") && !LoreSlices.STATUS_SINCE_SQL.contains(" AND "),
            LoreSlices.STATUS_SINCE_SQL);
    }

    @Test
    void historySlicesShowWhichVersionsAreTextEdits() {
        assertTrue(LoreSlices.compose("history_task", Map.of("id", "S/T-1")).sql().contains("version_kind"));
        assertTrue(LoreSlices.compose("history_sprint", Map.of("id", "SPRINT_X")).sql().contains("version_kind"));
    }

    @Test
    void statusChangeFilterOfTheJournalIgnoresTextVersions() {
        // LoreEntityHistory.CHANGE_FIELDS: фильтр field=status оставляет версии, где status_raw сменился.
        List<Map<String, Object>> rows = List.of(
            row("status_raw", "🔄 IN PROGRESS", "content_hash", "a"),
            row("status_raw", "🔄 IN PROGRESS", "content_hash", "b"),   // правка текста
            row("status_raw", "✅ DONE", "content_hash", "b"));
        Map<String, Object> st = LoreEntityHistory.page(rows, null, "status", "asc", 0, 50);
        assertEquals(2, ((List<?>) st.get("rows")).size(), st.toString());
        Map<String, Object> ct = LoreEntityHistory.page(rows, null, "content", "asc", 0, 50);
        assertEquals(2, ((List<?>) ct.get("rows")).size(), ct.toString());
    }
}
