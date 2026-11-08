package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-13 — один сервис смены статуса, одна схема версии.
 * Подставная БД: проверяется ровно то, что уходит в движок.
 */
class StatusHistoryServiceTest {

    /** Подставная БД: вершина, открытая строка и что вернёт скрипт. */
    static final class FakeDb implements StatusHistoryService.Db {
        Map<String, Object> vertex;            // null — вершины нет
        Map<String, Object> open;              // null — открытой версии нет
        Object scriptResult = List.of();
        final List<String> scripts = new ArrayList<>();
        final List<Map<String, Object>> scriptParams = new ArrayList<>();

        @Override public List<Map<String, Object>> query(String sql, Map<String, Object> params) {
            if (sql.contains(" AS cur FROM ")) return vertex == null ? List.of() : List.of(vertex);
            if (sql.contains("valid_to IS NULL")) return open == null ? List.of() : List.of(open);
            return List.of();
        }
        @Override public Object script(String sql, Map<String, Object> params) {
            scripts.add(sql); scriptParams.add(params); return scriptResult;
        }
    }

    private static final ChangeAuthor AGENT = new ChangeAuthor("lore-mcp-probe", ChangeAuthor.KIND_AGENT);

    private static Map<String, Object> row(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    @Test
    void every_kind_opens_a_version_with_the_unified_status_schema() {
        for (StatusHistoryService.Kind k : StatusHistoryService.KINDS.values()) {
            FakeDb db = new FakeDb();
            db.vertex = row("cur", "x");
            db.open = row("@rid", "#1:2", "status_raw", "x", "state_uid", "old");
            var o = StatusHistoryService.transition(db, k.type(), "ID-1", null, "done", AGENT, "2026-11-07T10:00:00Z", "NSID");
            assertInstanceOf(StatusHistoryService.Outcome.Ok.class, o, k.type());
            assertEquals(1, db.scripts.size(), k.type() + ": один sqlscript на переход");
            String s = db.scripts.get(0);
            Map<String, Object> p = db.scriptParams.get(0);
            assertTrue(s.contains("UPDATE " + k.hist() + " SET valid_to = :now RETURN AFTER WHERE @rid = :oldrid AND valid_to IS NULL"),
                k.type() + ": закрытие условное (S2-09): " + s);
            assertTrue(s.contains("INSERT INTO " + k.hist() + " SET "), k.type() + ": " + s);
            for (String f : List.of("state_uid = :nsid", "status_raw = :ns", "status_category = :cat",
                    "valid_from = :now", "changed_by = :changed_by", "changed_by_kind = :changed_by_kind"))
                assertTrue(s.contains(f), k.type() + ": в версии нет " + f + ": " + s);
            assertTrue(s.contains("CREATE EDGE HAS_STATE FROM (SELECT FROM " + k.vertex()), k.type());
            assertTrue(s.contains("UPDATE " + k.vertex() + " SET " + k.vertexField() + " = :ns"),
                k.type() + ": денормализованный статус на вершине: " + s);
            assertEquals("lore-mcp-probe", p.get("changed_by"));
            assertEquals("agent", p.get("changed_by_kind"));
            assertEquals("finished", p.get("cat"), k.type() + ": категория статуса на оси D-2026-UXR-STATUS-AXIS");
        }
    }

    @Test
    void category_and_raw_value_follow_the_type() {
        FakeDb db = new FakeDb();
        db.vertex = row("cur", "PROPOSED");
        StatusHistoryService.transition(db, "adr", "ADR-X", null, "accepted", AGENT, "t", "n");
        assertEquals("ACCEPTED", db.scriptParams.get(0).get("ns"), "ADR хранит статус верхним регистром");
        assertEquals("in_force", db.scriptParams.get(0).get("cat"));

        FakeDb t = new FakeDb();
        t.vertex = row("cur", "📋 PLANNED");
        StatusHistoryService.transition(t, "task", "S/T1", null, "done", AGENT, "t", "n");
        assertEquals("✅ DONE", t.scriptParams.get(0).get("ns"));
        assertEquals("finished", t.scriptParams.get(0).get("cat"));
    }

    @Test
    void all_fields_of_the_open_version_are_carried_except_state_owned_ones() {
        FakeDb db = new FakeDb();
        db.vertex = row("cur", "🔴 BLOCKED");
        db.open = row("@rid", "#5:1", "@type", "KnowSprintHist", "status_raw", "🔴 BLOCKED",
            "context_md", "эссе", "priority", "high", "pr_refs", List.of("#1"), "block_reason", "ждём KC",
            "changed_by", "old-author", "valid_from", "2026-01-01", "bad name", "x");
        StatusHistoryService.transition(db, "sprint", "SPRINT_X", null, "active", AGENT, "t", "n");
        String s = db.scripts.get(0);
        Map<String, Object> p = db.scriptParams.get(0);
        assertEquals("эссе", p.get("c_context_md"));
        assertEquals("high", p.get("c_priority"));
        assertEquals(List.of("#1"), p.get("c_pr_refs"));
        assertFalse(s.contains("block_reason"), "причина блокировки принадлежит состоянию: " + s);
        assertFalse(p.containsKey("c_changed_by"), "автор — новый, не перенесённый");
        assertFalse(p.containsKey("c_valid_from"));
        assertFalse(s.contains("bad name"), "имя поля не идентификатор — в SQL не идёт");
        assertFalse(s.contains("@type"));
    }

    @Test
    void spec_keeps_its_legacy_status_field_in_step_with_status_raw() {
        FakeDb db = new FakeDb();
        db.vertex = row("cur", null);
        db.open = row("@rid", "#7:1", "status", "proposed", "content_md", "тело");
        var o = StatusHistoryService.transition(db, "spec", "SPEC-X", "proposed", "accepted", AGENT, "t", "n");
        Map<String, Object> p = db.scriptParams.get(0);
        assertEquals("proposed", ((StatusHistoryService.Outcome.Ok) o).oldStatus());
        assertTrue(db.scripts.get(0).contains(", status = :ns"), "срезы читают status спеки");
        assertEquals("тело", p.get("c_content_md"));
        assertFalse(p.containsKey("c_status"));
    }

    // S2-15: «открытой версии не видно» — это снимок на момент чтения, а не факт на
    // момент записи. Соседний писатель мог как раз закрыть старую строку и ещё не
    // вставить свою: тогда план без защиты открывал вторую версию (CI #925: одна
    // закрытая, две открытые). Скрипт обязан сам проверить, что открытой нет.
    @Test
    void no_visible_open_version_is_still_guarded_inside_the_script() {
        for (StatusHistoryService.Kind k : StatusHistoryService.KINDS.values()) {
            FakeDb db = new FakeDb();
            db.vertex = row("cur", "x");
            db.open = null;
            StatusHistoryService.transition(db, k.type(), "ID-1", null, "done", AGENT, "t", "n");
            String s = db.scripts.get(0);
            int guard = s.indexOf("valid_to IS NULL");
            int insert = s.indexOf("INSERT INTO " + k.hist());
            assertTrue(guard >= 0 && guard < insert,
                k.type() + ": проверка «открытой версии нет» до вставки: " + s);
            assertTrue(s.contains(Scd2Guard.CONFLICT_MARK), k.type() + ": при найденной открытой — маркер конфликта: " + s);
        }
    }

    @Test
    void expected_mismatch_is_a_conflict_without_any_write() {
        FakeDb db = new FakeDb();
        db.vertex = row("cur", "🔄 IN PROGRESS");
        db.open = row("@rid", "#1:1", "status_raw", "🔄 IN PROGRESS");
        var o = StatusHistoryService.transition(db, "task", "S/T1", "planned", "done", AGENT, "t", "n");
        assertInstanceOf(StatusHistoryService.Outcome.Conflict.class, o);
        assertTrue(db.scripts.isEmpty());
    }

    @Test
    void expected_match_guards_the_close_by_status() {
        FakeDb db = new FakeDb();
        db.vertex = row("cur", "🔄 IN PROGRESS");
        db.open = row("@rid", "#1:1", "status_raw", "🔄 IN PROGRESS");
        StatusHistoryService.transition(db, "task", "S/T1", "active", "done", AGENT, "t", "n");
        assertTrue(db.scripts.get(0).contains("AND status_raw = :expected_raw"));
        assertEquals("🔄 IN PROGRESS", db.scriptParams.get(0).get("expected_raw"));
    }

    @Test
    void concurrent_close_marker_is_a_conflict() {
        FakeDb db = new FakeDb();
        db.vertex = row("cur", "PROPOSED");
        db.open = row("@rid", "#1:1", "status_raw", "PROPOSED");
        db.scriptResult = List.of(Map.of("value", Scd2Guard.CONFLICT_MARK));
        assertInstanceOf(StatusHistoryService.Outcome.Conflict.class,
            StatusHistoryService.transition(db, "adr", "ADR-X", null, "accepted", AGENT, "t", "n"));
    }

    @Test
    void unknown_entity_and_unknown_type_are_named_not_swallowed() {
        FakeDb db = new FakeDb();
        assertInstanceOf(StatusHistoryService.Outcome.NotFound.class,
            StatusHistoryService.transition(db, "decision", "D-NONE", null, "accepted", AGENT, "t", "n"));
        assertInstanceOf(StatusHistoryService.Outcome.BadType.class,
            StatusHistoryService.transition(db, "bragi_pub", "P", null, "x", AGENT, "t", "n"));
        assertTrue(db.scripts.isEmpty());
    }

    @Test
    void first_status_version_without_open_row_has_no_close_and_takes_vertex_status_as_old() {
        FakeDb db = new FakeDb();
        db.vertex = row("cur", "proposed");
        var o = StatusHistoryService.transition(db, "decision", "D-1", null, "accepted", null, "t", "n");
        assertEquals("proposed", ((StatusHistoryService.Outcome.Ok) o).oldStatus());
        assertFalse(db.scripts.get(0).contains("valid_to = :now"));
        assertEquals("unknown", db.scriptParams.get(0).get("changed_by_kind"), "без токена — неизвестно, не человек");
        assertNull(db.scriptParams.get(0).get("changed_by"));
    }

    // ── бэкфилл ──

    @Test
    void backfill_stamps_open_rows_and_opens_honest_versions_only_for_doc_types() {
        List<String> scripts = new ArrayList<>();
        List<Map<String, Object>> params = new ArrayList<>();
        StatusHistoryService.Db db = new StatusHistoryService.Db() {
            @Override public List<Map<String, Object>> query(String sql, Map<String, Object> p) {
                if (sql.contains("FROM KnowADRHist WHERE valid_to IS NULL AND status_raw IS NULL"))
                    return List.of(row("rid", "#3:1", "cur", "ACCEPTED"));
                if (sql.contains("FROM KnowDecision WHERE status_raw IS NOT NULL AND out('HAS_STATE').size() = 0"))
                    return List.of(row("id", "D-1", "cur", "accepted"));
                return List.of();
            }
            @Override public Object script(String sql, Map<String, Object> p) {
                scripts.add(sql); params.add(new HashMap<>(p)); return List.of();
            }
        };
        var counts = StatusHistoryService.backfill(db, "2026-11-08T00:00:00Z");
        assertEquals(List.of("adr", "spec", "decision"), counts.stream().map(StatusHistoryService.BackfillCount::type).toList());
        assertEquals(2, scripts.size());
        assertTrue(scripts.get(0).startsWith("UPDATE KnowADRHist SET status_raw = :ns"));
        assertTrue(scripts.get(0).contains("status_backfilled = true"));
        assertTrue(scripts.get(0).contains("AND status_raw IS NULL"), "повтор не перезапишет");
        assertFalse(scripts.get(0).contains("valid_from"), "существующие даты версий не трогаются");
        assertTrue(scripts.get(1).startsWith("INSERT INTO KnowDecisionHist"));
        assertTrue(scripts.get(1).contains("status_backfilled = true"));
        assertEquals("2026-11-08T00:00:00Z", params.get(1).get("now"));
        assertEquals("unknown", params.get(1).get("changed_by_kind"));
        for (String s : scripts) assertFalse(s.contains("KnowTaskHist") || s.contains("KnowSprintHist"),
            "задачи — предмет S2-11");
    }

    // S2-11 (V71): задачи без единой версии истории (запись мимо SCD2) получают одну
    // честную версию — текущий статус, известен с момента бэкфилла, без выдуманных дат.
    @Test
    void task_backfill_opens_one_honest_version_for_tasks_without_history() {
        List<String> scripts = new ArrayList<>();
        List<Map<String, Object>> params = new ArrayList<>();
        StatusHistoryService.Db db = new StatusHistoryService.Db() {
            @Override public List<Map<String, Object>> query(String sql, Map<String, Object> p) {
                if (sql.contains("FROM KnowTask WHERE status_raw IS NOT NULL AND out('HAS_STATE').size() = 0"))
                    return List.of(row("id", "SPRINT_SITE_SEO_PRERENDER/PRE-03", "cur", "✅ DONE"),
                                   row("id", "SPRINT_DALI_DIALECTS_LORE_VIZ/DLG-08", "cur", "PARTIAL"));
                return List.of();
            }
            @Override public Object script(String sql, Map<String, Object> p) {
                scripts.add(sql); params.add(new HashMap<>(p)); return List.of();
            }
        };
        var counts = StatusHistoryService.backfill(db, "2026-11-08T23:00:00Z", StatusHistoryService.TASK_BACKFILL_TYPES);
        assertEquals(List.of("task"), counts.stream().map(StatusHistoryService.BackfillCount::type).toList());
        assertEquals(2, counts.get(0).opened());
        assertEquals(2, scripts.size());
        for (int i = 0; i < 2; i++) {
            String s = scripts.get(i);
            assertTrue(s.startsWith("INSERT INTO KnowTaskHist"), s);
            assertTrue(s.contains("status_backfilled = true"), "пометка «время восстановлено»: " + s);
            assertTrue(s.contains("out('HAS_STATE').size() = 0"), "повтор не откроет вторую: " + s);
            assertEquals("2026-11-08T23:00:00Z", params.get(i).get("now"), "дата — момент бэкфилла, не выдуманная");
            assertEquals("unknown", params.get(i).get("changed_by_kind"));
        }
        assertEquals("in_progress", params.get(1).get("cat"), "PARTIAL без эмодзи всё равно встаёт на ось");
        // По умолчанию (V68) задачи по-прежнему не трогаются.
        assertFalse(StatusHistoryService.BACKFILL_TYPES.contains("task"));
    }

    /** Разбор V68 на аддитивность (V1SchemaSafetyChecklist.JAVA_STEPS_REVIEWED). */
    @Test
    void backfill_writes_only_v67_properties_and_never_moves_version_dates() {
        List<String> scripts = new ArrayList<>();
        StatusHistoryService.Db db = new StatusHistoryService.Db() {
            @Override public List<Map<String, Object>> query(String sql, Map<String, Object> p) {
                if (sql.contains("status_raw IS NULL")) return List.of(row("rid", "#1:1", "cur", "x", "mirror", "y"));
                if (sql.contains("out('HAS_STATE').size() = 0")) return List.of(row("id", "I", "cur", "x"));
                return List.of();
            }
            @Override public Object script(String sql, Map<String, Object> p) { scripts.add(sql); return List.of(); }
        };
        StatusHistoryService.backfill(db, "t");
        java.util.Set<String> v67 = new java.util.HashSet<>(StatusHistoryService.STATUS_FIELDS);
        java.util.regex.Pattern setField = java.util.regex.Pattern.compile("(\\w+) = :");
        for (String s : scripts) {
            if (!s.startsWith("UPDATE ")) continue;
            String set = s.substring(s.indexOf(" SET ") + 5, s.indexOf(" WHERE "));
            java.util.regex.Matcher m = setField.matcher(set);
            while (m.find()) assertTrue(v67.contains(m.group(1)), "UPDATE бэкфилла трогает не-V67 поле: " + m.group(1));
            assertTrue(set.contains("status_backfilled = true"));
            assertTrue(s.endsWith("AND status_raw IS NULL"), s);
        }
        assertEquals(6, scripts.size(), "3 типа × (пометка + первая версия)");
    }
}
