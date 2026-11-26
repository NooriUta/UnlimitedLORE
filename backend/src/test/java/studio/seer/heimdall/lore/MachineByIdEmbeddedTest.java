package studio.seer.heimdall.lore;

import com.arcadedb.database.Database;
import com.arcadedb.database.DatabaseFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_ADMIN_POLISH/AP-MACHINE-PASSPORT · срезы паспорта машины на настоящей ArcadeDB (встроенный движок,
 * без сервера). Машина — вершина KnowMachine; шлюз — актор {@code minilore-link-<id>} с владельцем (OWNED_BY);
 * агенты — рёбра USES_MACHINE. Машина без шлюза (решение 3б) — строка с пустым шлюзом, а не пропажа из списка.
 */
class MachineByIdEmbeddedTest {

    private Path dir;
    private DatabaseFactory factory;
    private Database db;

    @BeforeEach
    void open() throws Exception {
        dir = Files.createTempDirectory("lore-machine-by-id-");
        factory = new DatabaseFactory(dir.resolve("db").toString());
        db = factory.create();
        db.transaction(() -> {
            for (String t : List.of("KnowMachine", "KnowActor", "KnowUser", "KnowAgentSession")) db.command("sql", "CREATE VERTEX TYPE " + t);
            for (String e : List.of("USES_MACHINE", "OWNED_BY", "LOGGED_BY")) db.command("sql", "CREATE EDGE TYPE " + e);
            db.command("sql", "INSERT INTO KnowUser SET kc_sub = 'sub-ann', display_name = 'Ann So'");
            db.command("sql", "INSERT INTO KnowMachine SET machine_id = 'lorcetus', first_seen_at = '2026-11-11T08:00:00Z', last_seen_at = '2026-11-22T15:46:00Z'");
            db.command("sql", "INSERT INTO KnowMachine SET machine_id = 'argharaga', first_seen_at = '2026-11-20T08:00:00Z', last_seen_at = '2026-11-23T07:44:00Z'");
            db.command("sql", "INSERT INTO KnowActor SET actor_id = 'minilore-link-lorcetus', client_id = 'minilore-link-lorcetus', kind = 'agent', "
                + "machine_id = 'lorcetus', harness = 'kimi', name = 'lorcetus (машина владелицы, miniLORE link)'");
            db.command("sql", "INSERT INTO KnowActor SET actor_id = 'AGENT-FULL', client_id = 'lore-mcp-full', kind = 'agent', machine_id = 'lorcetus', harness = 'claude'");
            db.command("sql", "INSERT INTO KnowActor SET actor_id = 'AGENT-FULL_ARHARAGA', client_id = 'lore-mcp-full_arharaga', kind = 'agent', machine_id = 'argharaga'");
            db.command("sql", "CREATE EDGE OWNED_BY FROM (SELECT FROM KnowActor WHERE actor_id = 'minilore-link-lorcetus') TO (SELECT FROM KnowUser WHERE kc_sub = 'sub-ann')");
            for (String a : List.of("minilore-link-lorcetus", "AGENT-FULL"))
                db.command("sql", "CREATE EDGE USES_MACHINE FROM (SELECT FROM KnowActor WHERE actor_id = '" + a + "') TO (SELECT FROM KnowMachine WHERE machine_id = 'lorcetus')");
            db.command("sql", "CREATE EDGE USES_MACHINE FROM (SELECT FROM KnowActor WHERE actor_id = 'AGENT-FULL_ARHARAGA') TO (SELECT FROM KnowMachine WHERE machine_id = 'argharaga')");
            db.command("sql", "INSERT INTO KnowAgentSession SET session_id = 's-dev', machine_id = 'lorcetus', last_activity_at = '2026-11-20T09:14:00Z'");
            db.command("sql", "INSERT INTO KnowAgentSession SET session_id = 's-other', machine_id = 'midgard', last_activity_at = '2026-11-21T09:14:00Z'");
        });
    }

    @AfterEach
    void close() {
        if (db != null) db.drop();
        if (factory != null) factory.close();
    }

    private List<Map<String, Object>> run(String slice, Map<String, String> params) {
        LoreSlices.Composed c = LoreSlices.compose(slice, params);
        List<Map<String, Object>> out = new ArrayList<>();
        db.query("sql", c.sql(), c.params()).stream().forEach(r -> out.add(r.toMap()));
        return out;
    }

    @Test
    void паспорт_машины_со_шлюзом_владельцем_и_агентами() {
        List<Map<String, Object>> rows = run("machine_by_id", Map.of("id", "lorcetus"));
        assertEquals(1, rows.size());
        Map<String, Object> row = rows.get(0);
        assertEquals("minilore-link-lorcetus", row.get("gateway"), "шлюз — актор minilore-link-<id>: " + row);
        assertEquals("sub-ann", row.get("owner"), "владелец — OWNED_BY шлюза: " + row);
        assertEquals("Ann So", row.get("owner_name"));
        assertEquals("kimi", row.get("harness"));
        assertEquals("2026-11-22T15:46:00Z", row.get("last_seen_at"));
        Map<String, Object> v = LoreRecordValues.values("machine", row);
        assertEquals("lorcetus", v.get("title"));
        assertEquals("minilore-link-lorcetus", v.get("gateway"));
        assertEquals("sub-ann", v.get("owner"));
        @SuppressWarnings("unchecked") List<String> agents = (List<String>) row.get("agent_ids");
        assertEquals(List.of("AGENT-FULL", "minilore-link-lorcetus"), agents.stream().sorted().toList(), "агенты — по ребру USES_MACHINE");
    }

    @Test
    void машина_без_шлюза_видна_с_пустым_шлюзом() {
        List<Map<String, Object>> rows = run("machine_by_id", Map.of("id", "argharaga"));
        assertEquals(1, rows.size());
        Map<String, Object> row = rows.get(0);
        assertNull(row.get("gateway"), "шлюза нет — пусто, а не чужой шлюз: " + row);
        assertNull(row.get("owner"));
        assertEquals(List.of("AGENT-FULL_ARHARAGA"), row.get("agent_ids"));
    }

    @Test
    void список_машин_графа_и_со_шлюзом_и_без() {
        // Порядок строк — у потребителя: срез без ORDER BY (LetCorrelationNoOrderByGuardTest).
        List<Map<String, Object>> rows = new java.util.ArrayList<>(run("machines_graph", Map.of()));
        rows.sort(java.util.Comparator.comparing(r -> String.valueOf(r.get("machine_id"))));
        assertEquals(List.of("argharaga", "lorcetus"), rows.stream().map(r -> String.valueOf(r.get("machine_id"))).toList());
        assertNull(rows.get(0).get("gateway"), "argharaga — без шлюза (решение 3б)");
        assertEquals("minilore-link-lorcetus", rows.get(1).get("gateway"));
    }

    @Test
    void сессии_на_машине_фильтром_machine() {
        List<Map<String, Object>> rows = run("agent_sessions", Map.of("machine", "lorcetus"));
        assertEquals(List.of("s-dev"), rows.stream().map(r -> String.valueOf(r.get("session_id"))).toList(),
            "решение 2б: блок «были сессией» — сессии этой машины, не все");
    }
}
