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
 * SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH A6 · SQL ответственного вопроса на настоящей ArcadeDB (встроенный движок,
 * без сервера и без Quarkus): запись ребра ANSWERABLE_BY с историей, перевод на автора решения и чтение срезами
 * {@code questions} / {@code question_by_id} — по ребру, а без ребра прежний текст поля owner.
 *
 * <p>Отрицательный контроль: база, где типа ребра ещё нет вовсе (до переноса 1.18), — срез не падает и отдаёт текст.
 */
class QuestionOwnerEmbeddedTest {

    private Path dir;
    private DatabaseFactory factory;
    private Database db;
    private QuestionOwner.Graph g;

    @BeforeEach
    void open() throws Exception {
        dir = Files.createTempDirectory("lore-question-owner-");
        factory = new DatabaseFactory(dir.resolve("db").toString());
        db = factory.create();
        db.transaction(() -> {
            for (String t : List.of("KnowQuestion", "KnowUser", "KnowActor", "KnowDecision", "KnowDecisionHist"))
                db.command("sql", "CREATE VERTEX TYPE " + t);
            for (String e : List.of("HAS_STATE", "ANSWERS", "BELONGS_TO", "BELONGS_TO_PROJECT", "GATES", "RAISED_IN"))
                db.command("sql", "CREATE EDGE TYPE " + e);
            db.command("sql", "INSERT INTO KnowUser SET kc_sub = '52f6-uuid', display_name = 'omiloreadmin'");
            db.command("sql", "INSERT INTO KnowUser SET kc_sub = '77aa-uuid', display_name = 'ivanovalex32'");
            db.command("sql", "INSERT INTO KnowActor SET actor_id = 'AGENT-LORE-ARCH', client_id = 'lore-arch', kind = 'agent'");
            db.command("sql", "INSERT INTO KnowQuestion SET question_id = 'Q-OLD', title = 'старый', status = 'open', owner = 'серверная половина шлюза'");
            db.command("sql", "INSERT INTO KnowQuestion SET question_id = 'Q-NEW', title = 'новый', status = 'open', owner = 'owner'");
            db.command("sql", "INSERT INTO KnowDecision SET decision_id = 'D-1', title = 'ответ'");
            db.command("sql", "INSERT INTO KnowDecisionHist SET valid_from = '2026-11-19T10:00:00Z', changed_by = 'lore-arch', changed_by_kind = 'agent'");
            db.command("sql", "INSERT INTO KnowDecisionHist SET valid_from = '2026-11-19T12:00:00Z', changed_by = '52f6-uuid', changed_by_kind = 'human'");
            db.command("sql", "CREATE EDGE HAS_STATE FROM (SELECT FROM KnowDecision WHERE decision_id = 'D-1') TO (SELECT FROM KnowDecisionHist)");
            db.command("sql", "INSERT INTO KnowDecision SET decision_id = 'D-NOHIST', title = 'без истории'");
        });
        g = new QuestionOwner.Graph() {
            @Override
            public List<Map<String, Object>> query(String sql, Map<String, Object> params) {
                List<Map<String, Object>> out = new ArrayList<>();
                db.query("sql", sql, params).stream().forEach(r -> out.add(r.toMap()));
                return out;
            }
            @Override
            public void exec(String sql, Map<String, Object> params) {
                // схема — вне транзакции (как отдельная команда REST у сервера)
                if (sql.startsWith("CREATE EDGE TYPE")) db.command("sql", sql, params);
                else db.transaction(() -> db.command("sql", sql, params));
            }
        };
    }

    @AfterEach
    void close() {
        if (db != null) db.drop();
        if (factory != null) factory.close();
    }

    private Map<String, Object> byId(String id) {
        LoreSlices.Composed c = LoreSlices.compose("question_by_id", Map.of("id", id));
        List<Map<String, Object>> rows = g.query(c.sql(), c.params());
        assertEquals(1, rows.size(), id);
        return rows.get(0);
    }

    private Map<String, Object> inList(String id) {
        LoreSlices.Composed c = LoreSlices.compose("questions", Map.of());
        for (Map<String, Object> r : g.query(c.sql(), c.params())) if (id.equals(r.get("question_id"))) return r;
        throw new AssertionError("нет " + id + " в срезе questions");
    }

    @Test
    void withoutTheEdgeTypeTheSliceReadsTheOldText() {
        assertFalse(db.getSchema().existsType("ANSWERABLE_BY"), "контроль: типа ребра нет");
        assertEquals("серверная половина шлюза", byId("Q-OLD").get("owner"));
        assertEquals("text", byId("Q-OLD").get("owner_source"));
        assertEquals("owner", inList("Q-NEW").get("owner"));
    }

    @Test
    void assignedOwnerIsReadFromTheEdgeAndOldTextIsOnlyAFallback() {
        QuestionOwner.Target t = QuestionOwner.resolve(g, "владелица").target();
        Map<String, Object> out = QuestionOwner.assign(g, "Q-NEW", t, "question_set", "2026-11-19T13:00:00Z");
        assertEquals("created", out.get("outcome"));
        assertEquals("omiloreadmin", byId("Q-NEW").get("owner"));
        assertEquals("edge", byId("Q-NEW").get("owner_source"));
        assertEquals("omiloreadmin", inList("Q-NEW").get("owner"));
        assertEquals("серверная половина шлюза", byId("Q-OLD").get("owner"), "у вопроса без ребра — прежний текст");
        List<Map<String, Object>> e = g.query("SELECT valid_from, valid_to, origin FROM ANSWERABLE_BY", Map.of());
        assertEquals(1, e.size());
        assertEquals("2026-11-19T13:00:00Z", e.get(0).get("valid_from"));
        assertEquals("question_set", e.get(0).get("origin"));
        assertEquals("unchanged", QuestionOwner.assign(g, "Q-NEW", t, "question_set", "2026-11-19T14:00:00Z").get("outcome"));
        assertEquals(1L, ((Number) g.query("SELECT count(*) AS n FROM ANSWERABLE_BY", Map.of()).get(0).get("n")).longValue());
    }

    @Test
    void changingTheOwnerClosesThePreviousEdgeInsteadOfErasingIt() {
        QuestionOwner.assign(g, "Q-NEW", QuestionOwner.resolve(g, "omiloreadmin").target(), "question_new", "2026-11-19T13:00:00Z");
        Map<String, Object> out = QuestionOwner.assign(g, "Q-NEW", QuestionOwner.resolve(g, "AGENT-LORE-ARCH").target(),
            "question_set", "2026-11-19T14:00:00Z");
        assertEquals("replaced", out.get("outcome"));
        assertEquals(List.of("omiloreadmin"), out.get("previous"));
        assertEquals("AGENT-LORE-ARCH", byId("Q-NEW").get("owner"));
        List<Map<String, Object>> all = g.query("SELECT valid_from, valid_to FROM ANSWERABLE_BY ORDER BY valid_from", Map.of());
        assertEquals(2, all.size(), "история в ребре: прежний ответственный не стёрт");
        assertEquals("2026-11-19T14:00:00Z", all.get(0).get("valid_to"));
        assertNull(all.get(1).get("valid_to"));
    }

    @Test
    void decisionAuthorIsTheAuthorOfItsFirstVersion() {
        QuestionOwner.Resolved r = QuestionOwner.decisionAuthor(g, "D-1");
        assertEquals(new QuestionOwner.Target("agent", "AGENT-LORE-ARCH", "AGENT-LORE-ARCH"), r.target(),
            "автор — первая версия (lore-arch), а не поздняя правка человека");
        QuestionOwner.Resolved none = QuestionOwner.decisionAuthor(g, "D-NOHIST");
        assertNull(none.target());
        assertNotNull(none.refusal());
    }

    @Test
    void unknownOwnerReadsRegistryAndRefuses() {
        QuestionOwner.Resolved r = QuestionOwner.resolve(g, "серверная половина шлюза");
        assertNull(r.target());
        assertNotNull(r.refusal());
    }
}
