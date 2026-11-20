package studio.seer.heimdall.lore;

import com.arcadedb.database.Database;
import com.arcadedb.database.DatabaseFactory;
import com.arcadedb.query.sql.executor.ResultSet;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MD-02 8а · пустые типы «только схема» в базе 1.18 принимают запись ровно тем SQL, что
 * пишет код сервера. Владелица 19.11.2026: «функции оставить, алгоритмами и здравым смыслом подобрать типы».
 *
 * <p>Схема заводится так же, как её заводит установщик ({@code transfer.mjs}): тип, свойства схемы 1.18
 * ({@code scripts/model-migration/schema/all-objects.json}, записи с {@code schema_only}) с их типами, ключ
 * {@code mig_src_rid}, индексы схемы; связи «только схема» — по {@code map/all.edges.json}. Затем исполняется SQL кода
 * (строка сверяется с исходником — правка кода без правки теста валит тест) с параметрами тех же типов, что даёт код.
 * Чистый JUnit на встроенном движке ArcadeDB (временная папка, без Quarkus и без общей базы).
 */
class EmptyTypesSchemaOnlyWriteTest {

    private static final Path MIG = Path.of("..", "scripts", "model-migration");
    private static final Path SRC = Path.of("src", "main", "java", "studio", "seer", "heimdall", "lore");
    private static Path dir;
    private static DatabaseFactory factory;
    private static Database db;
    private static JsonNode schema;
    private static JsonNode edges;

    @BeforeAll
    static void open() throws Exception {
        ObjectMapper m = new ObjectMapper();
        schema = m.readTree(MIG.resolve("schema/all-objects.json").toFile()).get("types");
        edges = m.readTree(MIG.resolve("map/all.edges.json").toFile()).get("edges");
        dir = Files.createTempDirectory("lore-empty-types-");
        factory = new DatabaseFactory(dir.resolve("db").toString());
        db = factory.create();
        // концы связей — типы с данными, в 1.18 они есть картой; здесь — минимально
        for (String t : List.of("QualityGate", "KnowUser", "KnowActor", "KnowTask", "KnowDoc", "KnowFinding")) db.getSchema().createVertexType(t);
        db.getSchema().createEdgeType("HAS_STATE");
        // как transfer.mjs: тип, свойства схемы 1.18, mig_src_rid + индекс, затем индексы схемы (schemaIndexDdl)
        for (Iterator<Map.Entry<String, JsonNode>> it = schema.fields(); it.hasNext(); ) {
            Map.Entry<String, JsonNode> e = it.next();
            if (!e.getValue().path("schema_only").asBoolean(false)) continue;
            String T = e.getKey();
            ddl("CREATE VERTEX TYPE " + T);
            for (Iterator<Map.Entry<String, JsonNode>> f = e.getValue().get("fields").fields(); f.hasNext(); ) {
                Map.Entry<String, JsonNode> fe = f.next();
                ddl("CREATE PROPERTY " + T + ".`" + fe.getKey() + "` " + fe.getValue().get("db_type").asText());
            }
            ddl("CREATE PROPERTY " + T + ".mig_src_rid STRING");
            ddl("CREATE INDEX ON " + T + " (mig_src_rid) UNIQUE");
            for (JsonNode ix : e.getValue().get("indexes")) {
                StringBuilder fs = new StringBuilder();
                for (JsonNode f : ix.get("fields")) fs.append(fs.length() > 0 ? ", " : "").append('`').append(f.asText()).append('`');
                ddl("CREATE INDEX IF NOT EXISTS ON " + T + " (" + fs + ") " + ix.get("kind").asText());
            }
        }
        // как transfer-edges.mjs (schemaOnlyEdgeDdl)
        for (Iterator<Map.Entry<String, JsonNode>> it = edges.fields(); it.hasNext(); ) {
            Map.Entry<String, JsonNode> e = it.next();
            if (!e.getValue().path("schema_only").asBoolean(false)) continue;
            ddl("CREATE EDGE TYPE " + e.getKey() + " IF NOT EXISTS");
            for (Iterator<Map.Entry<String, JsonNode>> p = e.getValue().path("props").fields(); p.hasNext(); ) {
                Map.Entry<String, JsonNode> pe = p.next();
                ddl("CREATE PROPERTY " + e.getKey() + ".`" + pe.getKey() + "` IF NOT EXISTS " + pe.getValue().asText());
            }
        }
    }

    @AfterAll
    static void close() {
        if (db != null) db.drop();
        if (factory != null) factory.close();
    }

    private static void ddl(String sql) { db.command("sql", sql); }

    /** SQL кода: строка обязана быть в исходнике (склейка «"…" + "…"» снята). */
    private static String code(String file, String sql) throws Exception {
        String src = Files.readString(SRC.resolve(file)).replaceAll("\"\\s*\\+\\s*\"", "");
        assertTrue(src.contains(sql), file + ": код пишет другое — тест сверяет запись тем SQL, что в коде:\n" + sql);
        return sql;
    }

    private static void write(String sql, Map<String, Object> p) {
        db.transaction(() -> db.command("sql", sql, p));
    }

    private static long count(String sql, Object... kv) {
        Map<String, Object> p = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) p.put((String) kv[i], kv[i + 1]);
        try (ResultSet rs = db.query("sql", sql, p)) { long n = 0; while (rs.hasNext()) { rs.next(); n++; } return n; }
    }

    @Test
    void схема_1_18_несёт_все_11_пустых_типов_и_3_пустые_связи() {
        for (String t : List.of("KnowCanvas", "KnowCanvasItem", "KnowCanvasLink", "KnowFindingHist", "KnowSavedView", "KnowUserFavorite",
                "KnowUserHabit", "KnowUserMemoryPref", "KnowUserRecent", "LoreRefDismissal", "QGMetric", "MEASURED_BY", "MACHINE_ACCESS", "SOURCED_FROM"))
            assertTrue(db.getSchema().existsType(t), t + " есть в базе 1.18");
    }

    @Test
    void холст_холст_элемент_связь_холста() throws Exception {
        String now = Instant.now().toString();
        Map<String, Object> p = new HashMap<>(Map.of("u", "cv-1", "t", "VP", "tpl", "vp", "pr", "NooriUta/UnlimitedLORE", "now", now));
        write(code("LoreCanvasResource.java", "INSERT INTO KnowCanvas SET canvas_uid = :u, title = :t, template = :tpl, project = :pr, "
            + "row_version = 1, created_at = :now, updated_at = :now"), p);
        write(code("LoreCanvasResource.java", "UPDATE KnowCanvas SET title = :t, template = :tpl, project = :pr, updated_at = :now, "
            + "row_version = ifnull(row_version, 0) + 1 WHERE canvas_uid = :u"), p);
        assertEquals(1, count("SELECT FROM KnowCanvas WHERE canvas_uid = :u AND row_version = 2", "u", "cv-1"));

        Map<String, Object> it = new HashMap<>();
        it.put("u", "cv-1"); it.put("i", "st-1"); it.put("k", "sticker"); it.put("txt", "боль"); it.put("x", 10); it.put("y", 20.5);
        it.put("w", 120); it.put("h", 80); it.put("c", "amber"); it.put("s", "pains"); it.put("rt", "pain"); it.put("ri", "PAIN-1"); it.put("now", now);
        String item = code("LoreCanvasResource.java", "UPDATE KnowCanvasItem SET canvas_uid = :u, item_uid = :i, kind = :k, text = :txt, "
            + "x = :x, y = :y, w = :w, h = :h, color = :c, slot = :s, ref_type = :rt, ref_id = :ri, "
            + "updated_at = :now UPSERT WHERE canvas_uid = :u AND item_uid = :i");
        write(item, it);
        write(item, it); // UPSERT по уникальному индексу (canvas_uid, item_uid): повтор не плодит строк
        assertEquals(1, count("SELECT FROM KnowCanvasItem WHERE canvas_uid = :u AND x = 10.0", "u", "cv-1"));

        Map<String, Object> l = Map.of("u", "cv-1", "l", "ln-1", "f", "st-1", "t", "st-2", "e", "ADDRESSES", "g", "drawing");
        write(code("LoreCanvasResource.java", "UPDATE KnowCanvasLink SET canvas_uid = :u, link_uid = :l, from_uid = :f, to_uid = :t, edge = :e, "
            + "graph_state = :g UPSERT WHERE canvas_uid = :u AND link_uid = :l"), l);
        assertEquals(1, count("SELECT FROM KnowCanvasLink WHERE graph_state = 'drawing'"));
    }

    @Test
    void сохранённый_вид_избранное_недавнее() throws Exception {
        String at = Instant.now().toString();
        Map<String, Object> v = new HashMap<>();
        v.put("u", "view-1"); v.put("me", "sub-1"); v.put("n", "Мои задачи"); v.put("s", "tasks"); v.put("q", "status=ACTIVE");
        v.put("vis", "personal"); v.put("r", ""); v.put("td", false); v.put("pd", true); v.put("at", at);
        write(code("LoreMeResource.java", "INSERT INTO KnowSavedView SET view_uid=:u, owner_sub=:me, name=:n, section=:s, query=:q, "
            + "visibility=:vis, roles=:r, is_team_default=:td, is_personal_default=:pd, row_version=1, "
            + "created_at=:at, updated_at=:at"), v);
        assertEquals(1, count("SELECT FROM KnowSavedView WHERE is_personal_default = true AND row_version = 1"));

        Map<String, Object> f = Map.of("me", "sub-1", "t", "task", "i", "S/T-1", "at", at);
        String fav = code("LoreMeResource.java", "UPDATE KnowUserFavorite SET owner_sub=:me, ref_type=:t, ref_id=:i, added_at=:at "
            + "UPSERT WHERE owner_sub=:me AND ref_type=:t AND ref_id=:i");
        write(fav, f);
        write(fav, f);
        assertEquals(1, count("SELECT FROM KnowUserFavorite"));

        Map<String, Object> r = new HashMap<>(Map.of("me", "sub-1", "t", "task", "i", "S/T-1", "at", at));
        r.put("v", 1);
        write(code("LoreMeResource.java", "UPDATE KnowUserRecent SET owner_sub=:me, ref_type=:t, ref_id=:i, visited_at=:at, visits=:v "
            + "UPSERT WHERE owner_sub=:me AND ref_type=:t AND ref_id=:i"), r);
        write(code("LoreMeResource.java", "UPDATE KnowUserRecent SET first_seen=:at WHERE owner_sub=:me AND ref_type=:t AND ref_id=:i "
            + "AND first_seen IS NULL"), r);
        assertEquals(1, count("SELECT FROM KnowUserRecent WHERE visits = 1 AND first_seen IS NOT NULL"));
    }

    @Test
    void привычка_и_предпочтение_памяти() throws Exception {
        String at = Instant.now().toString();
        Map<String, Object> h = Map.of("id", "mem-1", "me", "sub-1", "k", "filter", "hk", "status=ACTIVE", "l", "Активные", "at", at);
        String habit = code("LoreMemoryResource.java", "UPDATE KnowUserHabit SET memory_id = :id, owner_sub = :me, kind = :k, habit_key = :hk, "
            + "label = :l, hits = 1, first_seen = :at, last_seen = :at "
            + "UPSERT WHERE owner_sub = :me AND kind = :k AND habit_key = :hk");
        write(habit, h);
        write(habit, h);
        assertEquals(1, count("SELECT FROM KnowUserHabit WHERE hits = 1"));

        Map<String, Object> m = Map.of("me", "sub-1", "r", false, "at", at);
        String pref = code("LoreMemoryResource.java", "UPDATE KnowUserMemoryPref SET owner_sub = :me, remembering = :r, updated_at = :at "
            + "UPSERT WHERE owner_sub = :me");
        write(pref, m);
        write(pref, m);
        assertEquals(1, count("SELECT FROM KnowUserMemoryPref WHERE remembering = false"));
    }

    @Test
    void отметка_не_ссылка() throws Exception {
        String tail = code("LoreTidyResource.java", " SET dismissal_key = :k, record_type = :t, record_id = :i, kind = :kind,"
            + " created_by = :who, created_at = :at UPSERT WHERE dismissal_key = :k");
        assertEquals("LoreRefDismissal", MdRefDismissals.TYPE);
        Map<String, Object> p = Map.of("k", "spec|S-1|code", "t", "spec", "i", "S-1", "kind", "code", "who", "owner", "at", Instant.now().toString());
        write("UPDATE " + MdRefDismissals.TYPE + tail, p);
        write("UPDATE " + MdRefDismissals.TYPE + tail, p);
        assertEquals(1, count("SELECT FROM LoreRefDismissal"));
    }

    @Test
    void метрика_гейта_и_связь_measured_by() throws Exception {
        Map<String, Object> p = Map.of("metric_id", "QG-1/coverage", "name", "Покрытие", "threshold", ">= 80%");
        String up = code("LoreIngestService.java", "UPDATE QGMetric SET metric_id=:metric_id, name=:name, threshold=:threshold "
            + "UPSERT WHERE metric_id=:metric_id");
        write(up, p);
        write(up, p);
        assertEquals(1, count("SELECT FROM QGMetric WHERE threshold = '>= 80%'"));
        // createEdgeIfVerticesExist("MEASURED_BY", "QualityGate", "qg_id", …, "QGMetric", "metric_id", …) — тот же шаблон
        code("LoreIngestService.java", "createEdgeIfVerticesExist(\"MEASURED_BY\",");
        code("LoreIngestService.java", "exec(\"CREATE EDGE \" + edgeType +");
        write("INSERT INTO QualityGate SET qg_id = 'QG-1'", Map.of());
        write("CREATE EDGE MEASURED_BY FROM (SELECT FROM QualityGate WHERE qg_id=:from_val) TO   (SELECT FROM QGMetric WHERE metric_id=:to_val) IF NOT EXISTS",
            Map.of("from_val", "QG-1", "to_val", "QG-1/coverage"));
        assertEquals(1, count("SELECT FROM MEASURED_BY"));
    }

    @Test
    void допуск_к_машине_и_опора_агента() throws Exception {
        write("INSERT INTO KnowUser SET kc_sub = 'sub-1'", Map.of());
        write("INSERT INTO KnowActor SET client_id = 'minilore-link-m1'", Map.of());
        write(code("LoreUserResource.java", "CREATE EDGE MACHINE_ACCESS FROM (SELECT FROM KnowUser WHERE kc_sub = :sub) "
            + "TO (SELECT FROM KnowActor WHERE client_id = :c) IF NOT EXISTS"), Map.of("sub", "sub-1", "c", "minilore-link-m1"));
        write(code("LoreUserResource.java", "UPDATE MACHINE_ACCESS SET role = :grole, granted_by = :gwho, granted_at = :gwhen "
            + "WHERE @out.kc_sub = :sub AND @in.client_id = :c"), Map.of("grole", "member", "gwho", "owner", "gwhen", Instant.now().toString(), "sub", "sub-1", "c", "minilore-link-m1"));
        code("LoreUserResource.java", "UPDATE MACHINE_ACCESS SET projects = ");
        write("UPDATE MACHINE_ACCESS SET projects = ['NooriUta/UnlimitedLORE'], harnesses = ['claude'] WHERE @out.kc_sub = :sub AND @in.client_id = :c",
            Map.of("sub", "sub-1", "c", "minilore-link-m1"));
        assertEquals(1, count("SELECT FROM MACHINE_ACCESS WHERE role = 'member' AND projects CONTAINS 'NooriUta/UnlimitedLORE'"));

        write("INSERT INTO KnowTask SET task_uid = 'S/T-1'", Map.of());
        write("INSERT INTO KnowDoc SET doc_id = 'D-1'", Map.of());
        code("AgentSourceTrail.java", "return \"CREATE EDGE SOURCED_FROM FROM (SELECT FROM \" + from.vertex() + \" WHERE \" + from.key() + \" = :tid) TO (SELECT FROM \" + to.vertex()");
        code("AgentSourceTrail.java", " = :sid) IF NOT EXISTS SET at = :at, via = :via\";");
        write("CREATE EDGE SOURCED_FROM FROM (SELECT FROM KnowTask WHERE task_uid = :tid) TO (SELECT FROM KnowDoc WHERE doc_id = :sid) IF NOT EXISTS SET at = :at, via = :via",
            Map.of("tid", "S/T-1", "sid", "D-1", "at", Instant.now().toString(), "via", "doc_get"));
        assertEquals(1, count("SELECT FROM SOURCED_FROM WHERE via = 'doc_get'"));
    }

    @Test
    void версии_находки_читаются_кодом() {
        // HistAuthorIndex читает каждую цепочку LoreSlices.HIST_PARENT — тип KnowFindingHist обязан быть
        try (ResultSet rs = db.query("sql", HistAuthorIndex.sql("KnowFindingHist"), Map.of())) {
            assertTrue(!rs.hasNext(), "версий нет — но тип есть, чтение не падает");
        }
        write("INSERT INTO KnowFindingHist SET valid_from = :f, changed_by = 'owner', changed_by_kind = 'human'", Map.of("f", "2026-11-19 10:00:00"));
        assertEquals(1, count(HistAuthorIndex.sql("KnowFindingHist")));
    }
}
