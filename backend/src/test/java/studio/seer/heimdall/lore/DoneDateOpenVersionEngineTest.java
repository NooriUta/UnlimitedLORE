package studio.seer.heimdall.lore;

import com.arcadedb.database.Database;
import com.arcadedb.database.DatabaseFactory;
import com.arcadedb.query.sql.executor.Result;
import com.arcadedb.query.sql.executor.ResultSet;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH Б1/Б2 · дата закрытия спринта — только у спринта, чья ОТКРЫТАЯ
 * версия в «выполнен» (D-2026-DONE-DATE-CLEARED-AND-STATUS-IS-TRUTH: состояние — статус, а не штамп).
 *
 * <p>Случай 06.11: SPRINT_ARCADEDB_26_11_ALL вернули из DONE в IN PROGRESS, а {@code done_date} остался от
 * откатанного закрытия — {@code DONE_DATE_SQL} и срез {@code sprint_done_dates} искали DONE в ЛЮБОЙ версии.
 *
 * <p>Чистый JUnit на встроенном движке ArcadeDB (временная папка, без Quarkus и без общей базы): SQL среза
 * исполняется как есть, поэтому тест ловит и смысл, и грамматику.
 */
class DoneDateOpenVersionEngineTest {

    private static Path dir;
    private static DatabaseFactory factory;
    private static Database db;

    @BeforeAll
    static void open() throws Exception {
        dir = Files.createTempDirectory("lore-done-date-");
        factory = new DatabaseFactory(dir.resolve("db").toString());
        db = factory.create();
        db.getSchema().createVertexType("KnowSprint");
        db.getSchema().createVertexType("KnowSprintHist");
        db.getSchema().createEdgeType("HAS_STATE");
        db.transaction(() -> {
            // вернули из DONE: прошлая версия ✅ DONE закрыта, открытая — 🔄 IN PROGRESS
            sprint("S_REOPENED",
                hist("✅ DONE", "2026-11-01 10:00:00", "2026-11-06 12:00:00", "2026-11-01 10:00:00"),
                hist("🔄 IN PROGRESS", "2026-11-06 12:00:00", null, "2026-11-06 12:00:00"));
            // положительный контроль: закрыт сейчас
            sprint("S_DONE",
                hist("🔄 IN PROGRESS", "2026-11-01 10:00:00", "2026-11-03 09:00:00", "2026-11-01 10:00:00"),
                hist("✅ DONE", "2026-11-03 09:00:00", null, "2026-11-03 09:00:00"));
            // легаси-версия без status_known_from — дата из начала открытой DONE-версии
            sprint("S_LEGACY_DONE",
                hist("DONE", "2026-10-20 08:00:00", null, null));
        });
    }

    @AfterAll
    static void close() {
        if (db != null) db.drop();
        if (factory != null) factory.close();
    }

    private static Map<String, Object> hist(String status, String from, String to, String known) {
        Map<String, Object> m = new HashMap<>();
        m.put("status_raw", status);
        m.put("valid_from", from);
        m.put("valid_to", to);
        m.put("status_known_from", known);
        return m;
    }

    @SafeVarargs
    private static void sprint(String id, Map<String, Object>... versions) {
        var s = db.newVertex("KnowSprint").set("sprint_id", id).save();
        for (Map<String, Object> v : versions) {
            var h = db.newVertex("KnowSprintHist");
            v.forEach((k, val) -> { if (val != null) h.set(k, val); });
            h.save();
            s.newEdge("HAS_STATE", h).save();
        }
    }

    private static Map<String, Object> doneDates() {
        Map<String, Object> out = new HashMap<>();
        try (ResultSet rs = db.query("sql", LoreSlices.get("sprint_done_dates").baseSql())) {
            while (rs.hasNext()) {
                Result r = rs.next();
                out.put(r.getProperty("sprint_id"), r.getProperty("done_date"));
            }
        }
        return out;
    }

    private static Object doneDateOf(String id) {
        try (ResultSet rs = db.query("sql",
                "SELECT " + LoreSlices.DONE_DATE_SQL + " AS done_date FROM KnowSprint WHERE sprint_id = :id",
                Map.of("id", id))) {
            assertTrue(rs.hasNext(), id);
            return rs.next().getProperty("done_date");
        }
    }

    @Test
    void reopenedSprintHasNoDoneDate() {
        assertNull(doneDateOf("S_REOPENED"), "открытая версия IN PROGRESS — даты закрытия нет, прошлая DONE не в счёт");
        assertFalse(doneDates().containsKey("S_REOPENED"), "вернули из DONE — в sprint_done_dates его нет");
    }

    @Test
    void doneSprintKeepsItsDoneDate() {
        Map<String, Object> dates = doneDates();
        assertTrue(dates.containsKey("S_DONE"), "положительный контроль: закрытый спринт в срезе — " + dates);
        assertEquals("2026-11-03 09:00:00", String.valueOf(doneDateOf("S_DONE")), "момент перехода в DONE");
        assertNotNull(doneDateOf("S_LEGACY_DONE"), "легаси DONE без status_known_from — дата из открытой версии");
        assertTrue(dates.containsKey("S_LEGACY_DONE"), "строка без значка («DONE») — тоже закрыт (QG-06)");
    }
}
