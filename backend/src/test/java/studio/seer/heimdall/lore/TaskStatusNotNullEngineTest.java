package studio.seer.heimdall.lore;

import com.arcadedb.database.Database;
import com.arcadedb.database.DatabaseFactory;
import com.arcadedb.schema.Property;
import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-11 · ответ владелицы 19.11.2026 «5а»: пустой статус у версии задачи
 * запрещён на уровне базы.
 *
 * <p>Схема 1.18 собирается установщиком из {@code scripts/model-migration/schema/*.json}: поле с {@code notnull}
 * объявляется {@code CREATE PROPERTY T.`f` TYPE (MANDATORY true, NOTNULL true)} — ровно эту строку пинует
 * {@code mdl11-status-notnull.test.mjs} у генератора ({@code transfer.mjs ddlProperty}). Здесь та же строка
 * исполняется на встроенном движке ArcadeDB (временная папка, без Quarkus и без общей базы): проверяется, что
 * движок её принимает и что вставка версии задачи без статуса, с {@code null} и с пустым полем отклоняется.
 */
class TaskStatusNotNullEngineTest {

    private static Path dir;
    private static DatabaseFactory factory;
    private static Database db;
    private static final List<String> ddl = new ArrayList<>();

    /** Та же форма, что у генератора DDL установщика (transfer.mjs ddlProperty). */
    static String ddlProperty(String type, String field, String dbType, boolean notnull) {
        return "CREATE PROPERTY " + type + ".`" + field + "` " + dbType + (notnull ? " (MANDATORY true, NOTNULL true)" : "");
    }

    @BeforeAll
    static void open() throws Exception {
        JsonObject schema = new JsonObject(Files.readString(
            Path.of("..", "scripts", "model-migration", "schema", "sprint-phase-task.json"), StandardCharsets.UTF_8));
        JsonObject hist = schema.getJsonObject("types").getJsonObject("KnowTaskHist").getJsonObject("fields");
        dir = Files.createTempDirectory("lore-task-status-notnull-");
        factory = new DatabaseFactory(dir.resolve("db").toString());
        db = factory.create();
        db.command("sql", "CREATE VERTEX TYPE KnowTaskHist");
        for (Map.Entry<String, Object> e : hist) {
            JsonObject f = (JsonObject) e.getValue();
            String s = ddlProperty("KnowTaskHist", e.getKey(), f.getString("db_type"), f.getBoolean("notnull", false));
            ddl.add(s);
            db.command("sql", s);
        }
    }

    @AfterAll
    static void close() {
        if (db != null) db.drop();
        if (factory != null) factory.close();
    }

    @Test
    void schemaDeclaresStatusMandatoryAndNotNull() {
        assertTrue(ddl.contains("CREATE PROPERTY KnowTaskHist.`status` STRING (MANDATORY true, NOTNULL true)"), String.join("\n", ddl));
        Property p = db.getSchema().getType("KnowTaskHist").getProperty("status");
        assertNotNull(p);
        assertTrue(p.isMandatory(), "status — MANDATORY");
        assertTrue(p.isNotNull(), "status — NOTNULL");
        assertEquals(1, ddl.stream().filter(s -> s.contains("MANDATORY")).count(), "по слову владелицы — только статус");
    }

    @Test
    void insertWithoutStatusIsRejected() {
        assertThrows(Exception.class, () -> db.transaction(() ->
            db.command("sql", "INSERT INTO KnowTaskHist SET state_uid = 'no-status', valid_from = '2026-11-19 10:00:00'")));
        assertEquals(0L, count("no-status"));
    }

    @Test
    void insertWithNullStatusIsRejected() {
        assertThrows(Exception.class, () -> db.transaction(() ->
            db.command("sql", "INSERT INTO KnowTaskHist SET state_uid = 'null-status', status = null")));
        assertEquals(0L, count("null-status"));
    }

    @Test
    void clearingStatusOfExistingVersionIsRejected() {
        db.transaction(() -> db.command("sql", "INSERT INTO KnowTaskHist SET state_uid = 'to-clear', status = 'ACTIVE'"));
        assertThrows(Exception.class, () -> db.transaction(() ->
            db.command("sql", "UPDATE KnowTaskHist SET status = null WHERE state_uid = 'to-clear'")));
        assertThrows(Exception.class, () -> db.transaction(() ->
            db.command("sql", "UPDATE KnowTaskHist REMOVE status WHERE state_uid = 'to-clear'")));
        assertEquals("ACTIVE", db.query("sql", "SELECT status FROM KnowTaskHist WHERE state_uid = 'to-clear'")
            .next().getProperty("status"));
    }

    @Test
    void insertWithStatusIsAccepted() {
        db.transaction(() -> db.command("sql",
            "INSERT INTO KnowTaskHist SET state_uid = 'backlog', status = 'BACKLOG', valid_from = '2026-11-19 10:00:00'"));
        assertEquals(1L, count("backlog"), "положительный контроль: версия со статусом пишется");
    }

    private static long count(String uid) {
        return db.query("sql", "SELECT count(*) AS n FROM KnowTaskHist WHERE state_uid = :u", Map.of("u", uid))
            .next().<Number>getProperty("n").longValue();
    }
}
