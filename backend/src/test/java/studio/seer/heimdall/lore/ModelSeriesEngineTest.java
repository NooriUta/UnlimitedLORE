package studio.seer.heimdall.lore;

import com.arcadedb.database.Database;
import com.arcadedb.database.DatabaseFactory;
import com.arcadedb.query.sql.executor.ResultSet;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Дефект 1.18 (19.11.2026): на базе, собранной из модели 1.18, рядов {@code AgentActionLog} и {@code MetricSnapshot}
 * не было — их заводили только шаги V (V86, ARC-02), а база из модели шагов V не знает. Запись журнала действий
 * асинхронно падала «Type with name 'AgentActionLog' was not found», и в логе оставалась строка
 * «[LORE ACTION] точка … не записана»; «Журнал действий» и срезы agent_actions/admin_actions были пусты.
 *
 * <p>Чистый JUnit на встроенном движке ArcadeDB (по образцу {@code DoneDateOpenVersionEngineTest}): схема рядов —
 * ровно DDL из модели ({@link LoreModelSeries#ddl}, тот же текст, что у установщика series.mjs), никакого шага V.
 * SQL писателей и читателей сервера исполняется как есть.
 */
class ModelSeriesEngineTest {

    private static Path dir;
    private static DatabaseFactory factory;
    private static Database db;

    @BeforeAll
    static void open() throws Exception {
        dir = Files.createTempDirectory("lore-model-series-");
        factory = new DatabaseFactory(dir.resolve("db").toString());
        db = factory.create();
        Map<String, LoreModelSeries.Series> series =
            LoreModelFile.parse(LoreModelFileTest.read(LoreModelFileTest.CANON)).series();
        // база из модели: ряды — только по разделу series
        for (Map.Entry<String, LoreModelSeries.Series> e : series.entrySet())
            db.command("sql", LoreModelSeries.ddl(e.getKey(), e.getValue()));
    }

    @AfterAll
    static void close() {
        if (db != null) db.drop();
        if (factory != null) factory.close();
    }

    private static List<Map<String, Object>> rows(String sql, Map<String, Object> p) {
        List<Map<String, Object>> out = new ArrayList<>();
        try (ResultSet rs = db.query("sql", sql, p)) {
            while (rs.hasNext()) out.add(rs.next().toMap());
        }
        return out;
    }

    private static void write(String sql, Map<String, Object> p) {
        db.transaction(() -> db.command("sql", sql, p).close());
    }

    @Test
    void действие_агента_попадает_в_журнал_и_читается_разделом_и_квотой() {
        long now = System.currentTimeMillis();
        String family = LoreSlices.ADMIN_FAMILIES.stream().sorted().findFirst().orElseThrow();
        // те же параметры, что у LoreRequestStats.journalAction
        Map<String, Object> p = new HashMap<>();
        p.put("ts", now);
        p.put("fam", family);
        p.put("oid", "ENT-118");
        p.put("src", "agent-scope-118");
        p.put("seg", "agent");
        p.put("client", "lore-agent-client");
        p.put("machine", "ryzenai");
        p.put("v", 200.0);
        write(LoreRequestStats.ACTION_INSERT_SQL, p);

        LoreAdminActions.Query q = LoreAdminActions.build(null, null, null, null, null, null, 50);
        List<Map<String, Object>> journal = rows(q.sql(), q.params());
        assertEquals(1, journal.size(), "«Журнал действий» видит точку: " + journal);
        Map<String, Object> r = journal.get(0);
        assertEquals("ENT-118", r.get("entity_id"));
        assertEquals("agent-scope-118", r.get("caller"));
        assertEquals("lore-agent-client", r.get("client"));
        assertEquals("ryzenai", r.get("machine"));

        assertEquals(1, rows("SELECT " + AgentActionLog.ROW_COLUMNS + " FROM AgentActionLog WHERE client = :client",
            Map.of("client", "lore-agent-client")).size(), "срез agent_actions (фильтр client)");
        assertEquals(1, rows(LoreEntityHistory.JOURNAL_SQL, Map.of("id", "ENT-118")).size(), "история сущности");
        List<Map<String, Object>> quota = rows(AgentQuota.AGENT_SQL, Map.of("scope", "agent-scope-118", "from", now - 60_000));
        assertEquals(1L, ((Number) quota.get(0).get("n")).longValue(), "квота агента считает точку");
    }

    @Test
    void точка_метрик_пишется_в_MetricSnapshot() {
        long now = System.currentTimeMillis();
        write(LoreRequestStats.METRIC_INSERT_SQL, Map.of("ts", now, "caller", "owner", "metric", LoreRequestStats.M_REQUESTS,
            "src", "slice:agent_actions", "seg", "human", "v", 3.0));
        List<Map<String, Object>> got = rows("SELECT object_id, metric, value FROM MetricSnapshot WHERE metric = :m",
            Map.of("m", LoreRequestStats.M_REQUESTS));
        assertEquals(1, got.size(), "окно счётчиков записано: " + got);
        assertEquals(3.0, ((Number) got.get(0).get("value")).doubleValue());
    }

    @Test
    void все_ряды_модели_созданы() {
        List<String> types = new ArrayList<>();
        for (Map<String, Object> r : rows("SELECT name FROM schema:types", Map.of())) types.add(String.valueOf(r.get("name")));
        assertTrue(types.containsAll(List.of("AgentActionLog", "MetricSnapshot", "AuditDbLogin")), "типы базы: " + types);
    }
}
