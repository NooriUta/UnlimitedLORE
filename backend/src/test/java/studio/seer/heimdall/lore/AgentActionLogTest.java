package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.OptionalInt;

import static org.junit.jupiter.api.Assertions.*;

/**
 * D-2026-LORE-AGENT-MACHINE-EVERYWHERE, п.4 (вариант А): журнал действий — свой временной ряд
 * AgentActionLog с тегами client и machine (к TIMESERIES MetricSnapshot теги не добавить —
 * проба 14.11). Прежние точки lore.action копируются один раз с отметкой «неизвестно», пишет
 * журнал только сюда, все читатели — отсюда. Без живой базы: форма ряда, шаг V86, план
 * копирования, писатель, читатели, квота по клиенту.
 */
class AgentActionLogTest {

    // ── ряд и шаг миграции ─────────────────────────────────────────────────

    @Test
    void seriesCarriesClientAndMachineTagsAndIsIdempotent() {
        String ddl = AgentActionLog.DDL;
        assertTrue(ddl.startsWith("CREATE TIMESERIES TYPE AgentActionLog IF NOT EXISTS"), ddl);
        assertTrue(ddl.contains("client STRING") && ddl.contains("machine STRING"), ddl);
        for (String tag : List.of("object_type", "object_id", "source", "segment"))
            assertTrue(ddl.contains(tag + " STRING"), "тег прежнего ряда " + tag + ": " + ddl);
        assertTrue(ddl.contains("FIELDS (value DOUBLE)"), ddl);
    }

    @Test
    void v86CreatesTheSeriesAndCopiesInJava() {
        LoreSchemaMigrations.Step v86 = LoreSchemaMigrations.STEPS.stream()
            .filter(s -> s.version() == 86).findFirst().orElseThrow(() -> new AssertionError("нет шага V86"));
        assertEquals("java__agent_action_log", v86.name());
        assertEquals(17, v86.compatMajor(), "аддитивно — major тот же");
        assertEquals(List.of(AgentActionLog.DDL), v86.sql());
        assertTrue(V1SchemaSafetyChecklist.JAVA_STEPS_REVIEWED.containsKey("java__agent_action_log"));
    }

    // ── отметки клиента ────────────────────────────────────────────────────

    @Test
    void clientIsMarkedLikeMachine() {
        assertEquals("lore-mcp-full", AgentActionLog.clientMark(true, " lore-mcp-full "));
        assertEquals(AgentMachine.UNKNOWN, AgentActionLog.clientMark(true, null));
        assertEquals(AgentMachine.UNKNOWN, AgentActionLog.clientMark(true, "  "));
        assertEquals(AgentMachine.NOT_APPLICABLE, AgentActionLog.clientMark(false, "lore-web"));
    }

    // ── копирование прежних точек ──────────────────────────────────────────

    private static Map<String, Object> row(long ms, String oid) {
        return Map.of("ms", ms, "object_type", "task", "object_id", oid, "source", "full", "segment", "agent", "value", 200.0);
    }

    @Test
    void partialPageIsCopiedWholeAndEndsTheCopy() {
        AgentActionLog.Page p = AgentActionLog.nextPage(List.of(row(1, "a"), row(2, "b")), 0, 0, 5);
        assertEquals(2, p.rows().size());
        assertTrue(p.done());
    }

    @Test
    void fullPageStopsBeforeTheTrailingTieSoTheNextPageTakesItWhole() {
        List<Map<String, Object>> raw = List.of(row(1, "a"), row(2, "b"), row(3, "c"), row(3, "d"));
        AgentActionLog.Page p = AgentActionLog.nextPage(raw, 0, 0, 4);
        assertEquals(List.of("a", "b"), p.rows().stream().map(r -> r.get("object_id")).toList());
        assertEquals(3, p.nextFrom(), "следующая страница с ts >= 3 — связка целиком");
        assertFalse(p.done());
    }

    @Test
    void fullPageOfOneMomentIsTakenAndTheMomentIsPassed() {
        List<Map<String, Object>> raw = List.of(row(7, "a"), row(7, "b"));
        AgentActionLog.Page p = AgentActionLog.nextPage(raw, 7, 0, 2);
        assertEquals(2, p.rows().size());
        assertEquals(8, p.nextFrom(), "иначе та же страница по кругу");
    }

    @Test
    void resumeSkipsWhatWasCopiedAtTheResumeMoment() {
        List<Map<String, Object>> raw = List.of(row(5, "a"), row(5, "b"), row(6, "c"));
        AgentActionLog.Page p = AgentActionLog.nextPage(raw, 5, 1, 10);
        assertEquals(List.of("b", "c"), p.rows().stream().map(r -> r.get("object_id")).toList());
    }

    @Test
    void copiedRowsAreMarkedUnknownWithoutGuessing() {
        AgentActionLog.Script s = AgentActionLog.copyScript(List.of(row(1000, "S/T1"), row(2000, "S/T2")));
        assertEquals(2, s.sql().split(";").length, s.sql());
        assertTrue(s.sql().startsWith("INSERT INTO AgentActionLog SET ts=:t0"), s.sql());
        assertFalse(s.sql().toUpperCase().contains("BEGIN"), "sqlscript с BEGIN валит TIMESERIES (nested transactions)");
        assertEquals(1000L, s.params().get("t0"));
        assertEquals("S/T2", s.params().get("o1"));
        assertEquals(AgentMachine.UNKNOWN, s.params().get("cl"));
        assertEquals(AgentMachine.UNKNOWN, s.params().get("ma"));
        assertTrue(s.sql().contains("client=:cl") && s.sql().contains("machine=:ma"), s.sql());
    }

    @Test
    void resumeLooksOnlyAtLegacyRange() {
        assertTrue(AgentActionLog.RESUME_SQL.contains("ts <= :legacy_max"), AgentActionLog.RESUME_SQL);
        assertTrue(AgentActionLog.LEGACY_PAGE_SQL.contains("(ts).asLong() AS ms"), "ts.asLong() ArcadeDB не разбирает");
        assertTrue(AgentActionLog.LEGACY_PAGE_SQL.contains("metric = 'lore.action'"));
    }

    // ── писатель ───────────────────────────────────────────────────────────

    @Test
    void journalWritesOnlyToTheNewSeriesWithClientAndMachine() {
        String sql = LoreRequestStats.ACTION_INSERT_SQL;
        assertTrue(sql.startsWith("INSERT INTO AgentActionLog"), sql);
        assertTrue(sql.contains("client=:client") && sql.contains("machine=:machine"), sql);
        assertFalse(sql.contains("MetricSnapshot"), sql);
    }

    // ── читатели: один источник ────────────────────────────────────────────

    @Test
    void everyActionSliceReadsTheNewSeries() {
        for (String slice : List.of("agent_actions", "admin_actions", "mcp_failures", "mcp_failure_rows")) {
            String sql = LoreSlices.compose(slice, Map.of()).sql();
            assertTrue(sql.contains("FROM AgentActionLog"), slice + ": " + sql);
            assertFalse(sql.contains("MetricSnapshot"), slice + ": " + sql);
        }
        for (String slice : List.of("agent_actions", "admin_actions", "mcp_failure_rows")) {
            String sql = LoreSlices.compose(slice, Map.of()).sql();
            assertTrue(sql.contains("client") && sql.contains("machine"), slice + " отдаёт клиента и машину: " + sql);
        }
    }

    @Test
    void actionSlicesFilterByMachineAndClient() {
        String sql = LoreSlices.compose("agent_actions", Map.of("machine", "lorcetus", "client", "lore-mcp-full")).sql();
        assertTrue(sql.contains("machine = :machine") && sql.contains("client = :client"), sql);
    }

    @Test
    void adminJournalEndpointReadsTheNewSeries() {
        LoreAdminActions.Query q = LoreAdminActions.build(null, null, null, null, null, null, 10);
        assertTrue(q.sql().contains("FROM AgentActionLog") && q.countSql().contains("FROM AgentActionLog"), q.sql());
        assertTrue(q.sql().contains("client") && q.sql().contains("machine"), q.sql());
    }

    @Test
    void entityHistoryReadsTheNewSeriesWithMachine() {
        assertTrue(LoreEntityHistory.JOURNAL_SQL.contains("FROM AgentActionLog"), LoreEntityHistory.JOURNAL_SQL);
        assertTrue(LoreEntityHistory.JOURNAL_SQL.contains("machine"), LoreEntityHistory.JOURNAL_SQL);
    }

    // ── квота: и по клиенту ────────────────────────────────────────────────

    @Test
    void quotaCountsTheNewSeriesAndPerClient() {
        for (String sql : List.of(AgentQuota.AGENT_SQL, AgentQuota.TOTAL_SQL, AgentQuota.CLIENT_SQL)) {
            assertTrue(sql.contains("FROM AgentActionLog"), sql);
            assertFalse(sql.contains("MetricSnapshot"), sql);
        }
        assertTrue(AgentQuota.CLIENT_SQL.contains("client = :client"), AgentQuota.CLIENT_SQL);
        assertEquals("lore.agent.quota.per-client", AgentQuota.PER_CLIENT);
    }

    @Test
    void perClientCeilingDeniesWithItsOwnCode() {
        AgentQuota.Denial d = AgentQuota.judge("full", "lore-mcp-full",
            OptionalInt.empty(), OptionalInt.of(3), OptionalInt.empty(), 0, 3, 0);
        assertNotNull(d);
        assertEquals("CLIENT_QUOTA_EXCEEDED", d.code());
        assertTrue(d.reason().contains("lore-mcp-full"), d.reason());
        assertNull(AgentQuota.judge("full", "lore-mcp-full",
            OptionalInt.empty(), OptionalInt.of(3), OptionalInt.empty(), 0, 2, 0));
    }

    @Test
    void unknownClientIsNotCountedAsOneSharedClient() {
        // «неизвестно» — не клиент: все агенты без client_id не должны делить один потолок.
        assertFalse(AgentQuota.countsPerClient(AgentMachine.UNKNOWN));
        assertFalse(AgentQuota.countsPerClient(null));
        assertTrue(AgentQuota.countsPerClient("lore-mcp-full"));
    }

    @SuppressWarnings("unused")
    private static List<Map<String, Object>> rows(Map<String, Object>... r) { return new ArrayList<>(List.of(r)); }
}
