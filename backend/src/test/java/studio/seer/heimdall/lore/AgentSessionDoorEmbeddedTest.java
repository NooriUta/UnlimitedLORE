package studio.seer.heimdall.lore;

import com.arcadedb.database.Database;
import com.arcadedb.database.DatabaseFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Дверь сессии в MCP. Слово владельца 26.11.2026:
 * «у нас же при аутентификации через MCP2 должна быть регистрация сессии теперь, как у minilore»;
 * «потому как не все будут подключены к minilore — это не должно мешать»; «дописывай и исправляй дверь в MCP».
 *
 * <p>Сервер сам заводит {@link AgentSessionDoor#TYPE} по заголовку X-Lore-Session-Id — без хука репо и без
 * miniLORE. Срез {@code session_coverage} показывает записи агентов в истории задач с сессией и без —
 * «сколько заблокируем», если включить отказ. Скрипт гоняется на настоящей ArcadeDB (встроенный движок).
 */
class AgentSessionDoorEmbeddedTest {

    private Path dir;
    private DatabaseFactory factory;
    private Database db;

    @BeforeEach
    void open() throws Exception {
        dir = Files.createTempDirectory("lore-session-door-");
        factory = new DatabaseFactory(dir.resolve("db").toString());
        db = factory.create();
        db.transaction(() -> {
            for (String t : List.of("KnowActor", "KnowAgentSession", "KnowTask", "KnowTaskHist")) db.command("sql", "CREATE VERTEX TYPE " + t);
            for (String e : List.of("LOGGED_BY", "HAS_STATE")) db.command("sql", "CREATE EDGE TYPE " + e);
            // Как на проде (LoreSchemaMigrations, шаг 25 agent_session_log): session_id уникален — на нём держится UPSERT.
            db.command("sql", "CREATE PROPERTY KnowAgentSession.session_id STRING");
            db.command("sql", "CREATE INDEX ON KnowAgentSession (session_id) UNIQUE");
            db.command("sql", "INSERT INTO KnowActor SET actor_id = 'AGENT-FULL_ARHARAGA', client_id = 'lore-mcp-full_arharaga', kind = 'agent'");
        });
    }

    @AfterEach
    void close() {
        if (db != null) db.drop();
        if (factory != null) factory.close();
    }

    private void door(String sid, String client, String machine, String now) {
        AgentSessionDoor.Script s = AgentSessionDoor.script(sid, client, machine, now);
        db.transaction(() -> db.command("sqlscript", s.sql(), s.params()));
    }

    private List<Map<String, Object>> sessions() {
        List<Map<String, Object>> out = new ArrayList<>();
        db.query("sql", "SELECT session_id, machine_id, started_at, last_activity_at, out('LOGGED_BY').actor_id AS actors FROM KnowAgentSession")
            .stream().forEach(r -> out.add(r.toMap()));
        return out;
    }

    @Test
    void первый_вызов_заводит_сессию_с_машиной_и_агентом() {
        door("c12e671c", "lore-mcp-full_arharaga", "arharaga", "2026-11-26T12:00:00Z");
        List<Map<String, Object>> s = sessions();
        assertEquals(1, s.size(), String.valueOf(s));
        assertEquals("arharaga", s.get(0).get("machine_id"));
        assertEquals("2026-11-26T12:00:00Z", s.get(0).get("started_at"));
        assertEquals(List.of("AGENT-FULL_ARHARAGA"), s.get(0).get("actors"), "LOGGED_BY → агент по client_id токена");
    }

    @Test
    void повтор_двигает_активность_но_не_начало_и_не_плодит_рёбра() {
        door("c12e671c", "lore-mcp-full_arharaga", "arharaga", "2026-11-26T12:00:00Z");
        door("c12e671c", "lore-mcp-full_arharaga", "arharaga", "2026-11-26T12:30:00Z");
        List<Map<String, Object>> s = sessions();
        assertEquals(1, s.size(), "одна строка на сессию: " + s);
        assertEquals("2026-11-26T12:00:00Z", s.get(0).get("started_at"), "начало не переписывается");
        assertEquals("2026-11-26T12:30:00Z", s.get(0).get("last_activity_at"));
        assertEquals(1, ((List<?>) s.get(0).get("actors")).size(), "ребро LOGGED_BY одно: " + s);
    }

    @Test
    void сессия_из_хука_без_машины_получает_машину_и_не_теряет_имя() {
        db.transaction(() -> db.command("sql",
            "INSERT INTO KnowAgentSession SET session_id = 'b3eb9f1c', started_at = '2026-11-25T17:49:59Z', dialogue_name = 'Релиз'"));
        door("b3eb9f1c", "lore-mcp-full_arharaga", "arharaga", "2026-11-26T12:00:00Z");
        Map<String, Object> s = db.query("sql", "SELECT FROM KnowAgentSession WHERE session_id = 'b3eb9f1c'").next().toMap();
        assertEquals("arharaga", s.get("machine_id"));
        assertEquals("Релиз", s.get("dialogue_name"), "имя, записанное хуком или miniLORE, не затирается");
        assertEquals("2026-11-25T17:49:59Z", s.get("started_at"));
    }

    @Test
    void агента_нет_в_графе__сессия_заводится_без_ребра_и_без_падения() {
        door("x-1", "lore-mcp-unknown", null, "2026-11-26T12:00:00Z");
        List<Map<String, Object>> s = sessions();
        assertEquals(1, s.size());
        assertEquals(List.of(), s.get(0).get("actors"));
        assertNull(s.get(0).get("machine_id"), "машины нет — пусто, а не догадка");
    }

    @Test
    void код_сессии_вне_канона_не_пишется() {
        assertNull(AgentSessionDoor.canon("a b; DROP"));
        assertNull(AgentSessionDoor.canon("   "));
        assertNull(AgentSessionDoor.canon(null));
        assertEquals("c12e671c-5f69", AgentSessionDoor.canon(" c12e671c-5f69 "));
    }

    @Test
    void троттлинг__первый_раз_и_раз_в_пять_минут() {
        AgentSessionDoor.Throttle t = new AgentSessionDoor.Throttle(300);
        Instant t0 = Instant.parse("2026-11-26T12:00:00Z");
        assertTrue(t.due("s", t0), "первый вызов — пишем");
        assertFalse(t.due("s", t0.plusSeconds(60)), "через минуту — нет");
        assertTrue(t.due("s", t0.plusSeconds(301)), "через пять минут — снова");
        assertTrue(t.due("other", t0.plusSeconds(61)), "другая сессия — своя отметка");
    }

    @Test
    void срез_session_coverage_считает_записи_агентов_с_сессией_и_без() {
        db.transaction(() -> {
            db.command("sql", "INSERT INTO KnowTaskHist SET valid_from = '2026-11-25T10:00:00Z', changed_by = 'lore-mcp-full_arharaga', changed_by_kind = 'agent', changed_by_session = 'c12e', changed_by_machine = 'arharaga'");
            db.command("sql", "INSERT INTO KnowTaskHist SET valid_from = '2026-11-25T11:00:00Z', changed_by = 'lore-mcp-full_arharaga', changed_by_kind = 'agent', changed_by_session = 'c12e', changed_by_machine = 'arharaga'");
            db.command("sql", "INSERT INTO KnowTaskHist SET valid_from = '2026-11-25T12:00:00Z', changed_by = 'lore-mcp-full', changed_by_kind = 'agent', changed_by_machine = 'lorcetus'");
            db.command("sql", "INSERT INTO KnowTaskHist SET valid_from = '2026-11-25T12:30:00Z', changed_by = 'sub-ann', changed_by_kind = 'human'");
            db.command("sql", "INSERT INTO KnowTaskHist SET valid_from = '2026-11-10T12:00:00Z', changed_by = 'lore-mcp-full', changed_by_kind = 'agent', changed_by_machine = 'lorcetus'");
        });
        LoreSlices.Composed c = LoreSlices.compose("session_coverage", Map.of("from", "2026-11-19"));
        List<Map<String, Object>> rows = new ArrayList<>();
        db.query("sql", c.sql(), c.params()).stream().forEach(r -> rows.add(r.toMap()));
        assertEquals(2, rows.size(), "только агенты и только с даты: " + rows);
        Map<String, Object> withS = rows.stream().filter(r -> "arharaga".equals(r.get("machine"))).findFirst().orElseThrow();
        Map<String, Object> noS = rows.stream().filter(r -> "lorcetus".equals(r.get("machine"))).findFirst().orElseThrow();
        assertEquals(2L, ((Number) withS.get("writes")).longValue());
        assertEquals(2L, ((Number) withS.get("with_session")).longValue());
        assertEquals(1L, ((Number) noS.get("writes")).longValue());
        assertEquals(0L, ((Number) noS.get("with_session")).longValue(), "без сессии — это и есть «заблокируем»: " + noS);
    }
}
