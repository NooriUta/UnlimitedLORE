package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-07 — «MCP: подключения и честное здоровье».
 * MCP-сервер работает у агента на машине; LORE видит только его вызовы. Поэтому
 * здоровье подключения — то, что LORE наблюдал: когда агент звал в последний раз,
 * сколько, и сколько его записей упало. Не звал ни разу — строки нет («не видели»),
 * а не «здоров».
 */
class McpHealthSlicesTest {

    @Test
    void connectionsAreAgentCallsGroupedByProfileWithLastSeen() {
        String sql = LoreSlices.compose("mcp_connections", Map.of()).sql();
        assertTrue(sql.contains("metric = 'lore.requests'"), sql);
        assertTrue(sql.contains("segment = 'agent'"), "только агентская ось: " + sql);
        assertTrue(sql.contains("max(ts) AS last_seen"), sql);
        assertTrue(sql.contains("sum(value) AS calls"), sql);
        assertTrue(sql.contains("GROUP BY object_id"), sql);
    }

    @Test
    void failuresAreAgentWritesAnsweredWithAnErrorCode() {
        String sql = LoreSlices.compose("mcp_failures", Map.of()).sql();
        assertTrue(sql.contains("FROM AgentActionLog"), sql);
        assertTrue(sql.contains("segment = 'agent'"), sql);
        assertTrue(sql.contains("value >= 400"), "упавшая запись — код ответа ≥ 400: " + sql);
        assertTrue(sql.contains("max(ts) AS last_failure"), sql);
        assertTrue(sql.contains("GROUP BY source"), sql);
    }

    @Test
    void failuresFilterByAgent() {
        String sql = LoreSlices.compose("mcp_failures", Map.of("caller", "full")).sql();
        assertTrue(sql.contains("source = :caller"), sql);
        assertEquals(1, sql.toUpperCase().split(" WHERE ", -1).length - 1, "один WHERE: " + sql);
    }

    /**
     * SPRINT_UXR_S7B_ADMIN/S7B-26: Главной админки нужно «403 за сутки», а срез не принимал ни окна
     * времени, ни кода — карточка честно показывала «код ≥ 400 за всё время». {@code since} — ISO-дата
     * или момент (UTC), уходит в базу ЧИСЛОМ epoch-мс: {@code ts} в MetricSnapshot — LONG, и строка
     * против числа сравнивалась бы не так, как ждёт читатель. {@code code} — точный код ответа.
     */
    @Test
    void failuresAcceptSinceAndCodeAsTypedParams() {
        LoreSlices.Composed c = LoreSlices.compose("mcp_failures",
            new java.util.LinkedHashMap<>(Map.of("since", "2026-11-10", "code", "403")));
        assertTrue(c.sql().contains("ts >= :since"), c.sql());
        assertTrue(c.sql().contains("value = :code"), c.sql());
        assertEquals(1, c.sql().toUpperCase().split(" WHERE ", -1).length - 1, "один WHERE: " + c.sql());
        assertEquals(java.time.Instant.parse("2026-11-10T00:00:00Z").toEpochMilli(), c.params().get("since"),
            "дата — полночь UTC, epoch-мс числом");
        assertEquals(403L, c.params().get("code"));

        LoreSlices.Composed t = LoreSlices.compose("mcp_failures", Map.of("since", "2026-11-10T12:30:00Z"));
        assertEquals(java.time.Instant.parse("2026-11-10T12:30:00Z").toEpochMilli(), t.params().get("since"));
    }

    @Test
    void failuresRefuseMalformedSinceAndCode() {
        assertThrows(IllegalArgumentException.class, () -> LoreSlices.compose("mcp_failures", Map.of("since", "yesterday")));
        assertThrows(IllegalArgumentException.class, () -> LoreSlices.compose("mcp_failures", Map.of("code", "4xx")));
        assertThrows(IllegalArgumentException.class, () -> LoreSlices.compose("mcp_failures", Map.of("code", "99")),
            "код ответа HTTP — 100..599");
    }

    /**
     * SPRINT_UXR_S7B_ADMIN/S7B-30: карточка Главной «N отказов ≥ 400» считала СОБЫТИЯ (count(*) в
     * {@code mcp_failures}), а экран, куда она вела, показывал только свёртку по профилю — сами
     * отказы не было видно нигде: журнал действий админки ({@code admin_actions}) режет агентские
     * записи по админским семействам, {@code agent_actions} — по 500 последним действиям всех
     * исходов. Детализация — тот же ряд и то же условие, что у счётчика, построчно.
     */
    @Test
    void failureRowsAreTheSameEventsTheCounterCounts() {
        String count = LoreSlices.compose("mcp_failures", Map.of()).sql();
        String rows = LoreSlices.compose("mcp_failure_rows", Map.of()).sql();
        String cond = "FROM AgentActionLog WHERE segment = 'agent' AND value >= 400";
        assertTrue(count.contains(cond), count);
        assertTrue(rows.contains(cond), "то же условие, что у счётчика: " + rows);
        assertTrue(rows.contains("object_type AS family"), rows);
        assertTrue(rows.contains("object_id AS entity_id"), rows);
        assertTrue(rows.contains("value AS status"), rows);
        assertTrue(rows.contains("ORDER BY ts DESC"), "свежие сверху: " + rows);
        assertFalse(rows.contains("GROUP BY"), "строки, а не свёртка: " + rows);
    }

    @Test
    void failureRowsAcceptTheCounterFilters() {
        LoreSlices.Composed c = LoreSlices.compose("mcp_failure_rows",
            new java.util.LinkedHashMap<>(Map.of("caller", "full", "since", "2026-11-10", "code", "403")));
        assertTrue(c.sql().contains("source = :caller"), c.sql());
        assertTrue(c.sql().contains("ts >= :since"), c.sql());
        assertTrue(c.sql().contains("value = :code"), c.sql());
        assertEquals(1, c.sql().toUpperCase().split(" WHERE ", -1).length - 1, "один WHERE: " + c.sql());
        assertEquals(java.time.Instant.parse("2026-11-10T00:00:00Z").toEpochMilli(), c.params().get("since"));
        assertEquals(403L, c.params().get("code"));
    }
}
