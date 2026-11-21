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
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13 · Одна связь «зависит от» (DEPENDS_ON) между задачей, фазой, спринтом и
 * вехой — на настоящей ArcadeDB (встроенный движок, без сервера и без Quarkus).
 *
 * <p>Что проверяется: запись в любых сочетаниях четырёх типов с видом и причиной; неизвестный вид — 422;
 * связь с собой — 400; нет конца — 404; цикл (в том числе через разные типы) — 409 с путём цикла; связь
 * историчная — снятие и смена вида закрывают ребро {@code valid_to}, а не стирают; срезы {@code deps} /
 * {@code deps_of} / {@code sprint_deps} / {@code sprint_deps_of} видят только текущие рёбра.
 */
class LoreDependencyEmbeddedTest {

    private static final List<String> KINDS = LoreDependency.DEFAULT_KINDS;

    private Path dir;
    private DatabaseFactory factory;
    private Database db;
    private LoreDependency.Graph g;
    private int tick;

    @BeforeEach
    void open() throws Exception {
        dir = Files.createTempDirectory("lore-dependency-");
        factory = new DatabaseFactory(dir.resolve("db").toString());
        db = factory.create();
        db.transaction(() -> {
            for (String t : List.of("KnowTask", "KnowPhase", "KnowSprint", "KnowMilestone", "KnowADR", "KnowGitProject"))
                db.command("sql", "CREATE VERTEX TYPE " + t);
            for (String e : List.of("DEPENDS_ON", "PART_OF", "HAS_STATE", "BELONGS_TO_PROJECT"))
                db.command("sql", "CREATE EDGE TYPE " + e);
            db.command("sql", "INSERT INTO KnowSprint SET sprint_id = 'SPRINT_A', name = 'Спринт А'");
            db.command("sql", "INSERT INTO KnowSprint SET sprint_id = 'SPRINT_B', name = 'Спринт Б'");
            db.command("sql", "INSERT INTO KnowSprint SET sprint_id = 'SPRINT_C', name = 'Спринт В'");
            db.command("sql", "INSERT INTO KnowTask SET task_uid = 'SPRINT_A/T1', title = 'Задача 1'");
            db.command("sql", "INSERT INTO KnowTask SET task_uid = 'SPRINT_A/T2', title = 'Задача 2'");
            db.command("sql", "INSERT INTO KnowPhase SET phase_uid = 'SPRINT_B/PHASE_1', name = 'Фаза 1'");
            db.command("sql", "INSERT INTO KnowMilestone SET milestone_id = 'M-1', label = 'Веха 1'");
            db.command("sql", "INSERT INTO KnowADR SET adr_id = 'ADR-1'");
            db.command("sql", "INSERT INTO KnowADR SET adr_id = 'ADR-2'");
            // ADR → ADR — та же связь DEPENDS_ON, но не планирование: срезы deps её не показывают.
            db.command("sql", "CREATE EDGE DEPENDS_ON FROM (SELECT FROM KnowADR WHERE adr_id = 'ADR-1') TO (SELECT FROM KnowADR WHERE adr_id = 'ADR-2')");
            // Старое ребро спринтов без valid_from (так лежат 117 связей прода) — текущее.
            db.command("sql", "CREATE EDGE DEPENDS_ON FROM (SELECT FROM KnowSprint WHERE sprint_id = 'SPRINT_C') TO (SELECT FROM KnowSprint WHERE sprint_id = 'SPRINT_B') SET kind = 'hard', reason = 'старое'");
        });
        g = new LoreDependency.Graph() {
            @Override
            public List<Map<String, Object>> query(String sql, Map<String, Object> params) {
                List<Map<String, Object>> out = new ArrayList<>();
                db.query("sql", sql, params).stream().forEach(r -> out.add(r.toMap()));
                return out;
            }
            @Override
            public void exec(String sql, Map<String, Object> params) {
                db.transaction(() -> db.command("sql", sql, params));
            }
        };
    }

    @AfterEach
    void close() {
        if (db != null) db.drop();
        if (factory != null) factory.close();
    }

    private String now() {
        return String.format("2026-11-20T10:%02d:00Z", tick++);
    }

    private LoreDependency.Ref ref(String type, String id) {
        return new LoreDependency.Ref(type, id);
    }

    private LoreDependency.Result link(String ft, String fid, String tt, String tid, String kind, String reason) {
        return LoreDependency.link(g, ref(ft, fid), ref(tt, tid), kind, reason, "add", KINDS, now());
    }

    private List<Map<String, Object>> slice(String id, Map<String, String> params) {
        LoreSlices.Composed c = LoreSlices.compose(id, params);
        return g.query(c.sql(), c.params());
    }

    @Test
    void anyPairOfTheFourTypesLinksWithKindAndReason() {
        LoreDependency.Result r = link("task", "SPRINT_A/T1", "phase", "SPRINT_B/PHASE_1", "hard", "ждём схему");
        assertEquals(200, r.status(), r.body().toString());
        assertEquals("created", r.body().get("outcome"));
        assertEquals(200, link("milestone", "M-1", "sprint", "SPRINT_A", "gate", "r").status());
        assertEquals(200, link("phase", "SPRINT_B/PHASE_1", "milestone", "M-1", null, "r").status());
        List<Map<String, Object>> e = g.query("SELECT kind, reason, valid_from, valid_to FROM DEPENDS_ON "
            + "WHERE @out.task_uid = 'SPRINT_A/T1'", Map.of());
        assertEquals(1, e.size());
        assertEquals("blocks", e.get(0).get("kind"), "hard — синоним blocks в объединённом справочнике");
        assertEquals("ждём схему", e.get(0).get("reason"));
        assertNotNull(e.get(0).get("valid_from"), "связь историчная — у нового ребра есть «действует с»");
        assertNull(e.get(0).get("valid_to"));
        List<Map<String, Object>> noKind = g.query("SELECT kind FROM DEPENDS_ON WHERE @out.phase_uid = 'SPRINT_B/PHASE_1'", Map.of());
        assertEquals(LoreDependency.DEFAULT_KIND, noKind.get(0).get("kind"), "вид не назван — вид по умолчанию, как у спринтов");
    }

    @Test
    void unknownKindIs422AndNothingIsWritten() {
        LoreDependency.Result r = link("task", "SPRINT_A/T1", "task", "SPRINT_A/T2", "blocker", null);
        assertEquals(422, r.status());
        assertEquals("UNKNOWN_KIND", r.body().get("error"));
        assertEquals(KINDS, r.body().get("allowed"));
        assertEquals(0, g.query("SELECT FROM DEPENDS_ON WHERE @out.task_uid = 'SPRINT_A/T1'", Map.of()).size());
    }

    @Test
    void newDependencyWithoutReasonIs422() {
        LoreDependency.Result r = link("task", "SPRINT_A/T1", "task", "SPRINT_A/T2", "blocks", null);
        assertEquals(422, r.status());
        assertEquals("REASON_REQUIRED", r.body().get("error"));
        assertTrue(String.valueOf(r.body().get("detail")).contains("укажите причину"));
        assertEquals(422, link("task", "SPRINT_A/T1", "task", "SPRINT_A/T2", "blocks", "   ").status(), "пробелы — не причина");
        assertEquals(0, g.query("SELECT FROM DEPENDS_ON WHERE @out.task_uid = 'SPRINT_A/T1'", Map.of()).size());
        // старая связь без причины (до 1.18): смена вида без причины открыла бы новое ребро без причины — тоже 422
        g.exec("CREATE EDGE DEPENDS_ON FROM (SELECT FROM KnowSprint WHERE sprint_id = 'SPRINT_A') TO (SELECT FROM KnowSprint WHERE sprint_id = 'SPRINT_C') SET kind = 'soft'", Map.of());
        assertEquals(422, link("sprint", "SPRINT_A", "sprint", "SPRINT_C", "gate", null).status());
        assertEquals("unchanged", link("sprint", "SPRINT_A", "sprint", "SPRINT_C", null, null).body().get("outcome"),
            "повтор без изменений не пишет и причины не требует");
    }

    @Test
    void mergedDictionaryAcceptsSpecKindsAndMapsHardToBlocks() {
        assertEquals(List.of("blocks", "waits", "soft", "gate", "informs", "relates"), LoreDependency.DEFAULT_KINDS);
        assertEquals(200, link("task", "SPRINT_A/T1", "task", "SPRINT_A/T2", "waits", "ждём ответ").status());
        assertEquals(200, link("task", "SPRINT_A/T2", "sprint", "SPRINT_B", "relates", "см.").status());
        LoreDependency.Result r = link("milestone", "M-1", "sprint", "SPRINT_A", "hard", "старый код");
        assertEquals("blocks", r.body().get("kind"));
    }

    @Test
    void selfLoopIs400AndMissingEndIs404() {
        assertEquals(400, link("task", "SPRINT_A/T1", "task", "SPRINT_A/T1", "hard", null).status());
        LoreDependency.Result r = link("task", "SPRINT_A/T1", "sprint", "SPRINT_NOPE", "hard", null);
        assertEquals(404, r.status());
        assertEquals("TARGET_NOT_FOUND", r.body().get("error"));
        assertEquals(400, link("adr", "ADR-1", "task", "SPRINT_A/T1", "hard", null).status(), "ADR — не тип планирования");
    }

    @Test
    void cycleThroughDifferentTypesIs409WithThePath() {
        assertEquals(200, link("task", "SPRINT_A/T1", "phase", "SPRINT_B/PHASE_1", "hard", "r").status());
        assertEquals(200, link("phase", "SPRINT_B/PHASE_1", "milestone", "M-1", "soft", "r").status());
        assertEquals(200, link("milestone", "M-1", "sprint", "SPRINT_C", "informs", "r").status());
        // SPRINT_C → SPRINT_B (старое ребро без valid_from); SPRINT_B → задача замкнёт цикл? нет: задача → фаза.
        LoreDependency.Result r = link("sprint", "SPRINT_C", "task", "SPRINT_A/T1", "hard", "r");
        assertEquals(409, r.status(), r.body().toString());
        assertEquals("CYCLE", r.body().get("error"));
        @SuppressWarnings("unchecked") List<String> path = (List<String>) r.body().get("cycle");
        assertEquals(List.of("sprint:SPRINT_C", "task:SPRINT_A/T1", "phase:SPRINT_B/PHASE_1", "milestone:M-1", "sprint:SPRINT_C"), path);
        assertEquals(0, g.query("SELECT FROM DEPENDS_ON WHERE @out.sprint_id = 'SPRINT_C' AND @in.task_uid = 'SPRINT_A/T1'", Map.of()).size());
    }

    @Test
    void closedEdgeDoesNotCloseACycle() {
        assertEquals(200, link("task", "SPRINT_A/T1", "task", "SPRINT_A/T2", "hard", "r").status());
        assertEquals(200, LoreDependency.link(g, ref("task", "SPRINT_A/T1"), ref("task", "SPRINT_A/T2"), null, null, "remove", KINDS, now()).status());
        assertEquals(200, link("task", "SPRINT_A/T2", "task", "SPRINT_A/T1", "hard", "r").status(),
            "снятая (закрытая) зависимость цикла не образует");
    }

    @Test
    void removeClosesTheEdgeInsteadOfErasingIt() {
        link("task", "SPRINT_A/T1", "sprint", "SPRINT_B", "hard", "r");
        LoreDependency.Result r = LoreDependency.link(g, ref("task", "SPRINT_A/T1"), ref("sprint", "SPRINT_B"), null, null, "remove", KINDS, now());
        assertEquals(200, r.status());
        assertEquals("deleted", r.body().get("outcome"));
        List<Map<String, Object>> all = g.query("SELECT valid_from, valid_to FROM DEPENDS_ON WHERE @out.task_uid = 'SPRINT_A/T1'", Map.of());
        assertEquals(1, all.size(), "ребро не стёрто");
        assertNotNull(all.get(0).get("valid_to"), "ребро закрыто");
        assertEquals("unchanged", LoreDependency.link(g, ref("task", "SPRINT_A/T1"), ref("sprint", "SPRINT_B"), null, null, "remove", KINDS, now()).body().get("outcome"));
    }

    @Test
    void sameLinkIsUnchangedAndNewKindReplacesWithHistory() {
        link("task", "SPRINT_A/T1", "sprint", "SPRINT_B", "hard", "r");
        assertEquals("unchanged", link("task", "SPRINT_A/T1", "sprint", "SPRINT_B", "hard", "r").body().get("outcome"));
        assertEquals("unchanged", link("task", "SPRINT_A/T1", "sprint", "SPRINT_B", null, null).body().get("outcome"),
            "без вида и причины — связь та же");
        LoreDependency.Result r = link("task", "SPRINT_A/T1", "sprint", "SPRINT_B", "soft", null);
        assertEquals("updated", r.body().get("outcome"));
        assertEquals("blocks", r.body().get("previous_kind"));
        List<Map<String, Object>> all = g.query("SELECT kind, reason, valid_to FROM DEPENDS_ON WHERE @out.task_uid = 'SPRINT_A/T1' ORDER BY valid_from", Map.of());
        assertEquals(2, all.size());
        assertNotNull(all.get(0).get("valid_to"));
        assertNull(all.get(1).get("valid_to"));
        assertEquals("soft", all.get(1).get("kind"));
        assertEquals("r", all.get(1).get("reason"), "причина не названа — переносится из прежней связи");
    }

    @Test
    void endTypeIsResolvedFromTheIdWhenNotGiven() {
        LoreDependency.Resolved r = LoreDependency.resolve(g, null, "SPRINT_B/PHASE_1");
        assertEquals(ref("phase", "SPRINT_B/PHASE_1"), r.ref());
        assertNull(LoreDependency.resolve(g, null, "NOPE").ref());
        assertEquals(404, LoreDependency.resolve(g, null, "NOPE").status());
        assertEquals(ref("milestone", "M-1"), LoreDependency.resolve(g, "milestone", "M-1").ref());
        assertEquals(404, LoreDependency.resolve(g, "task", "M-1").status());
        assertEquals(400, LoreDependency.resolve(g, "adr", "ADR-1").status());
    }

    @Test
    void depsSlicesShowOnlyCurrentPlanningEdges() {
        link("task", "SPRINT_A/T1", "phase", "SPRINT_B/PHASE_1", "hard", "ждём");
        link("milestone", "M-1", "sprint", "SPRINT_A", "gate", "r");
        link("task", "SPRINT_A/T2", "sprint", "SPRINT_B", "soft", "r");
        LoreDependency.link(g, ref("task", "SPRINT_A/T2"), ref("sprint", "SPRINT_B"), null, null, "remove", KINDS, now());

        List<Map<String, Object>> all = slice("deps", Map.of());
        assertEquals(3, all.size(), "ADR → ADR и закрытое ребро не видны: " + all);
        Map<String, Object> t = all.stream().filter(x -> "task".equals(x.get("from_type"))).findFirst().orElseThrow();
        assertEquals("SPRINT_A/T1", t.get("from_id"));
        assertEquals("phase", t.get("to_type"));
        assertEquals("SPRINT_B/PHASE_1", t.get("to_id"));
        assertEquals("blocks", t.get("kind"));
        assertEquals("ждём", t.get("reason"));
        assertEquals(1, slice("deps", Map.of("type", "milestone")).size());
        assertEquals(1, slice("deps", Map.of("kind", "gate")).size());

        List<Map<String, Object>> ofA = slice("deps_of", Map.of("type", "sprint", "id", "SPRINT_A"));
        assertEquals(1, ofA.size(), ofA.toString());
        assertEquals("in", ofA.get(0).get("dir"));
        assertEquals("milestone", ofA.get(0).get("other_type"));
        assertEquals("M-1", ofA.get(0).get("other_id"));
        assertEquals("Веха 1", ofA.get(0).get("other_title"));
        List<Map<String, Object>> ofT = slice("deps_of", Map.of("type", "task", "id", "SPRINT_A/T1"));
        assertEquals(1, ofT.size());
        assertEquals("out", ofT.get(0).get("dir"));
        assertEquals("phase", ofT.get(0).get("other_type"));
        assertEquals(0, slice("deps_of", Map.of("type", "task", "id", "SPRINT_A/T2")).size(), "закрытое ребро — история");
    }

    @Test
    void sprintSlicesKeepTheirShapeAndSkipClosedEdges() {
        link("sprint", "SPRINT_A", "sprint", "SPRINT_B", "hard", "x");
        link("sprint", "SPRINT_B", "sprint", "SPRINT_A", "soft", "r"); // цикл → 409, не записано
        LoreDependency.link(g, ref("sprint", "SPRINT_A"), ref("sprint", "SPRINT_B"), null, null, "remove", KINDS, now());
        link("sprint", "SPRINT_A", "sprint", "SPRINT_C", "gate", "r");
        List<Map<String, Object>> deps = slice("sprint_deps", Map.of());
        assertEquals(2, deps.size(), deps.toString()); // C → B (старое) и A → C
        assertTrue(deps.stream().allMatch(x -> x.containsKey("from_sprint") && x.containsKey("to_sprint") && x.containsKey("kind")));
        List<Map<String, Object>> of = slice("sprint_deps_of", Map.of("id", "SPRINT_A"));
        assertEquals(List.of("SPRINT_C"), of.get(0).get("depends_on"));
        assertEquals(List.of(), of.get(0).get("blocks"));
    }
}
