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
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-05, шаг 1 · «похожие» ({@code search_similar}) почти ничего не находили.
 *
 * <p>Корень (проба 19.11.2026): {@code SEARCH_INDEX_MORE} по умолчанию берёт {@code minTermFreq:2}, а
 * в коротком названии задачи каждое слово встречается один раз — запрос «похожих» вырождается в пустой;
 * и без {@code ORDER BY $similarity} строки шли в порядке хранения.
 *
 * <p>Чистый JUnit на встроенном движке ArcadeDB: индекс создаётся тем же DDL, что миграция
 * ({@link LoreSchemaMigrations.FtIndex#createSql()}), запрос — тем же построителем, что эндпоинт.
 */
class SearchSimilarEngineTest {

    private static Path dir;
    private static DatabaseFactory factory;
    private static Database db;

    @BeforeAll
    static void open() throws Exception {
        dir = Files.createTempDirectory("lore-similar-");
        factory = new DatabaseFactory(dir.resolve("db").toString());
        db = factory.create();
        db.getSchema().createVertexType("KnowTask").createProperty("title", com.arcadedb.schema.Type.STRING);
        db.command("sql", new LoreSchemaMigrations.FtIndex("ftKnowTask", "KnowTask", List.of("title")).createSql());
        db.transaction(() -> {
            // порядок вставки обратный ожидаемому: порядок хранения не должен сойти за ранжирование
            task("T_NONE", "кнопка на панели вех");                          // ничего общего
            task("T_FAR", "журнал релизов и тегов");                        // 1 общее слово
            task("T_MID", "журнал запросов");                               // 2 общих слова
            task("T_CLOSE", "журнал медленных запросов бэкенда к базе");   // 4 общих слова
            task("T_SRC", "журнал медленных запросов к базе");
            // балласт, чтобы IDF «журнал» не был нулевым и у слов был разный вес
            for (int i = 0; i < 20; i++) task("T_BAL_" + i, "графики спринта номер " + i);
        });
    }

    @AfterAll
    static void close() {
        if (db != null) db.drop();
        if (factory != null) factory.close();
    }

    private static void task(String id, String title) {
        db.newVertex("KnowTask").set("task_id", id).set("title", title).save();
    }

    private static List<String> similarTo(String id) {
        String rid;
        try (ResultSet rs = db.query("sql", "SELECT @rid AS rid FROM KnowTask WHERE task_id = :id", Map.of("id", id))) {
            rid = String.valueOf(rs.next().<Object>getProperty("rid"));
        }
        List<String> out = new ArrayList<>();
        try (ResultSet rs = db.query("sql",
                LoreSearchResource.similarSql("KnowTask", "task_id", "title", "ftKnowTask", rid, 10))) {
            while (rs.hasNext()) out.add(String.valueOf(rs.next().<Object>getProperty("ref_id")));
        }
        out.remove(id);
        return out;
    }

    @Test
    void shortTitleFindsSimilar() {
        List<String> hits = similarTo("T_SRC");
        assertFalse(hits.isEmpty(), "короткое название — каждое слово один раз; выдача не должна быть пустой");
        assertTrue(hits.contains("T_CLOSE"), "близкое название найдено: " + hits);
        assertFalse(hits.contains("T_NONE"), "без общих слов не похоже: " + hits);
    }

    @Test
    void orderedBySimilarity() {
        List<String> hits = similarTo("T_SRC");
        assertEquals("T_CLOSE", hits.get(0), "самое похожее — первым: " + hits);
        int mid = hits.indexOf("T_MID");
        int far = hits.indexOf("T_FAR");
        assertTrue(mid > 0, "среднее по похожести найдено: " + hits);
        assertTrue(far < 0 || far > mid, "дальнее — после среднего: " + hits);
    }

    @Test
    void similarityIsNotAConstant() {
        String rid;
        try (ResultSet rs = db.query("sql", "SELECT @rid AS rid FROM KnowTask WHERE task_id = 'T_SRC'")) {
            rid = String.valueOf(rs.next().<Object>getProperty("rid"));
        }
        List<Double> scores = new ArrayList<>();
        try (ResultSet rs = db.query("sql",
                LoreSearchResource.similarSql("KnowTask", "task_id", "title", "ftKnowTask", rid, 10))) {
            while (rs.hasNext()) scores.add(((Number) rs.next().getProperty("similarity")).doubleValue());
        }
        assertTrue(scores.size() >= 2, "есть что сравнивать: " + scores);
        assertTrue(scores.stream().distinct().count() > 1, "мера похожести различает строки, а не 1.0 у всех: " + scores);
        for (int i = 1; i < scores.size(); i++)
            assertTrue(scores.get(i - 1) >= scores.get(i), "по убыванию: " + scores);
    }
}
