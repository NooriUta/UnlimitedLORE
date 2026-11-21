package studio.seer.heimdall.lore;

import com.arcadedb.database.Database;
import com.arcadedb.database.DatabaseFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13 · трек спринта — ребро {@code ON_TRACK} спринт → трек ({@code KnowTrack}), а не строка
 * {@code track_id} версии (владелица 20.11.2026: «треки б»; «трек как веха но меньше паспорт ему тоже сделай»).
 *
 * <p>SQL на настоящей ArcadeDB (встроенный движок, без сервера и Quarkus), на двух базах:
 * <ul>
 *   <li>база 1.18 (собрана из модели): трек — вершина KnowTrack, связь — историчное ребро; смена трека закрывает
 *       прежнее ребро {@code valid_to}, а не стирает; срезы читают трек по ребру;</li>
 *   <li>старая схема (до переноса): рёбер нет, трек — строка версии и вершина PlanTrack; те же срезы не падают и
 *       отдают прежнее значение (отрицательный контроль: типа ребра нет вовсе).</li>
 * </ul>
 */
class SprintTrackEmbeddedTest {

    private Path dir;
    private DatabaseFactory factory;
    private Database db;
    private SprintTrack.Graph g;

    private void open(boolean model) throws Exception {
        ModelSchemaAdapter.enable(model);
        dir = Files.createTempDirectory("lore-sprint-track-");
        factory = new DatabaseFactory(dir.resolve("db").toString());
        db = factory.create();
        db.transaction(() -> {
            for (String t : List.of("KnowSprint", "KnowSprintHist", model ? "KnowTrack" : "PlanTrack"))
                db.command("sql", "CREATE VERTEX TYPE " + t);
            for (String e : List.of("HAS_STATE", "BELONGS_TO_PROJECT", "BELONGS_TO", "IMPLEMENTED_IN_RELEASE", "TARGETS_MILESTONE",
                    "DEPENDS_ON", "IMPLEMENTED_IN"))
                db.command("sql", "CREATE EDGE TYPE " + e);
            String tracks = model ? "KnowTrack" : "PlanTrack";
            db.command("sql", "INSERT INTO " + tracks + " SET track_id = '2', label = 'Hound / Parser', area = 'engine'");
            db.command("sql", "INSERT INTO " + tracks + " SET track_id = '11', label = 'ANVIL + MIMIR', area = 'service'");
            for (String s : List.of("SPRINT_HOUND_S3", "SPRINT_ANVIL_CORE")) {
                db.command("sql", "INSERT INTO KnowSprint SET sprint_id = '" + s + "', name = '" + s + " name'");
                // старая схема: трек — строка версии; 1.18: поля в версии нет
                db.command("sql", "INSERT INTO KnowSprintHist SET state_uid = '" + s + "-v1', valid_from = '2026-06-01T00:00:00Z', "
                    + "status_raw = '🔄 IN PROGRESS'" + (model ? "" : ", track_id = '2'"));
                db.command("sql", "CREATE EDGE HAS_STATE FROM (SELECT FROM KnowSprint WHERE sprint_id = '" + s + "') "
                    + "TO (SELECT FROM KnowSprintHist WHERE state_uid = '" + s + "-v1')");
            }
        });
        g = new SprintTrack.Graph() {
            @Override
            public List<Map<String, Object>> query(String sql, Map<String, Object> params) {
                List<Map<String, Object>> out = new ArrayList<>();
                db.query("sql", sql, params).stream().forEach(r -> out.add(r.toMap()));
                return out;
            }
            @Override
            public void exec(String sql, Map<String, Object> params) {
                if (sql.startsWith("CREATE EDGE TYPE")) db.command("sql", sql, params);
                else db.transaction(() -> db.command("sql", sql, params));
            }
        };
    }

    @AfterEach
    void close() {
        ModelSchemaAdapter.enable(false);
        if (db != null) db.drop();
        if (factory != null) factory.close();
    }

    private List<Map<String, Object>> slice(String id, Map<String, String> p) {
        LoreSlices.Composed c = LoreSlices.compose(id, p);
        return g.query(c.sql(), c.params());
    }

    private Map<String, Object> sprint(String id) {
        List<Map<String, Object>> rows = slice("sprint_tree", Map.of("id", id));
        assertEquals(1, rows.size(), id);
        return rows.get(0);
    }

    private Map<String, Object> inSprints(String id) {
        for (Map<String, Object> r : slice("sprints", Map.of())) if (id.equals(r.get("sprint_id"))) return r;
        throw new AssertionError("нет " + id + " в срезе sprints");
    }

    @Test
    void model118_assignWritesTheEdgeAndSlicesReadIt() throws Exception {
        open(true);
        assertEquals(List.of("11", "2"), slice(LoreSprintTracks.SLICE, Map.of()).stream().map(r -> r.get("code")).toList(),
            "выбор трека — вершины KnowTrack");
        assertNull(sprint("SPRINT_HOUND_S3").get("track_id"), "до записи трека нет");
        Map<String, Object> out = SprintTrack.assign(g, "SPRINT_HOUND_S3", "2", "sprint_plan_set", "2026-11-20T10:00:00Z");
        assertEquals("created", out.get("outcome"));
        assertEquals("2", sprint("SPRINT_HOUND_S3").get("track_id"));
        assertEquals("Hound / Parser", sprint("SPRINT_HOUND_S3").get("track_label"));
        assertEquals("2", inSprints("SPRINT_HOUND_S3").get("track_id"), "список спринтов — тот же трек");
        List<Map<String, Object>> e = g.query("SELECT valid_from, valid_to, origin FROM ON_TRACK WHERE valid_to IS NULL", Map.of());
        assertEquals(1, e.size());
        assertEquals("2026-11-20T10:00:00Z", e.get(0).get("valid_from"));
        assertEquals("sprint_plan_set", e.get(0).get("origin"));
        assertEquals("unchanged", SprintTrack.assign(g, "SPRINT_HOUND_S3", "2", "sprint_plan_set", "2026-11-20T11:00:00Z").get("outcome"));
        // паспорт трека: запись и спринты на треке
        List<Map<String, Object>> t = slice("track_by_id", Map.of("id", "2"));
        assertEquals(1, t.size());
        assertEquals("Hound / Parser", t.get(0).get("label"));
        assertEquals("engine", t.get(0).get("area"));
        assertEquals(List.of("SPRINT_HOUND_S3"), slice("track_sprints", Map.of("id", "2")).stream().map(r -> r.get("sprint_id")).toList());
    }

    @Test
    void model118_changingTheTrackClosesThePreviousEdgeAndHistoryKeepsBoth() throws Exception {
        open(true);
        SprintTrack.assign(g, "SPRINT_HOUND_S3", "2", "sprint_plan_set", "2026-11-20T10:00:00Z");
        Map<String, Object> out = SprintTrack.assign(g, "SPRINT_HOUND_S3", "11", "relation", "2026-11-20T12:00:00Z");
        assertEquals("replaced", out.get("outcome"));
        assertEquals(List.of("2"), out.get("previous"));
        assertEquals("11", sprint("SPRINT_HOUND_S3").get("track_id"));
        List<Map<String, Object>> all = g.query("SELECT valid_from, valid_to FROM ON_TRACK WHERE valid_to IS NULL OR valid_to IS NOT NULL ORDER BY valid_from", Map.of());
        assertEquals(2, all.size(), "история в ребре: прежний трек не стёрт");
        assertEquals("2026-11-20T12:00:00Z", all.get(0).get("valid_to"));
        assertNull(all.get(1).get("valid_to"));
        List<Map<String, Object>> h = slice("track_sprints", Map.of("id", "2"));
        assertEquals(1, h.size(), "история прежнего трека помнит спринт");
        assertEquals("SPRINT_HOUND_S3", h.get(0).get("sprint_id"));
        assertEquals("SPRINT_HOUND_S3 name · 2026-11-20 — 2026-11-20", h.get(0).get("period"), "пришёл и ушёл");
        assertEquals("SPRINT_HOUND_S3 name · 2026-11-20 — сейчас", slice("track_sprints", Map.of("id", "11")).get(0).get("period"),
            "на новом треке — «сейчас»");
        assertNotNull(h.get(0).get("tasks_total"), "колонки спринта-ребёнка (прогресс, даты) — как у спринтов вехи");
        // снять трек: ребро закрывается, трека нет
        assertEquals("removed", SprintTrack.assign(g, "SPRINT_HOUND_S3", "", "relation", "2026-11-20T13:00:00Z").get("outcome"));
        assertNull(sprint("SPRINT_HOUND_S3").get("track_id"));
    }

    @Test
    void model118_unknownTrackIsRefusedAndNothingIsWritten() throws Exception {
        open(true);
        IllegalArgumentException x = assertThrows(IllegalArgumentException.class,
            () -> SprintTrack.assign(g, "SPRINT_HOUND_S3", "99", "sprint_plan_set", "2026-11-20T10:00:00Z"));
        assertTrue(x.getMessage().contains("99"), x.getMessage());
        assertFalse(db.getSchema().existsType("ON_TRACK") && !g.query("SELECT FROM ON_TRACK WHERE valid_to IS NULL", Map.of()).isEmpty(),
            "ребра нет");
    }

    @Test
    void oldSchema_withoutTheEdgeTypeSlicesReadTheVersionField() throws Exception {
        open(false);
        assertFalse(db.getSchema().existsType("ON_TRACK"), "контроль: типа ребра нет");
        assertEquals("2", sprint("SPRINT_HOUND_S3").get("track_id"), "старая схема: трек — строка версии");
        assertEquals("2", inSprints("SPRINT_ANVIL_CORE").get("track_id"));
        assertEquals(List.of("11", "2"), slice(LoreSprintTracks.SLICE, Map.of()).stream().map(r -> r.get("code")).toList(),
            "выбор трека на старой схеме — вершины PlanTrack");
        assertEquals("Hound / Parser", slice("track_by_id", Map.of("id", "2")).get(0).get("label"), "паспорт трека открывается и на старой схеме");
        List<Map<String, Object>> s = slice("track_sprints", Map.of("id", "2"));
        assertEquals(List.of("SPRINT_ANVIL_CORE", "SPRINT_HOUND_S3"), s.stream().map(r -> r.get("sprint_id")).toList());
        assertNull(s.get(0).get("period"), "на старой схеме рёбер нет — периода нет, подпись — название");
    }
}
