package studio.seer.heimdall.lore;

import com.arcadedb.database.Database;
import com.arcadedb.database.DatabaseFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_PRODUCT_BACKLOG/FIT-04 · срез {@code segment_values} на настоящей ArcadeDB (встроенный движок):
 * строка на каждую боль/выгоду/работу с ролями по FELT_BY / DESIRED_BY / PERFORMED_BY, а сравнение
 * сегментов поверх этих строк даёт состав «общая / только у».
 */
class SegmentValuesEmbeddedTest {

    private Path dir;
    private DatabaseFactory factory;
    private Database db;

    @BeforeEach
    void open() throws Exception {
        dir = Files.createTempDirectory("lore-segment-values-");
        factory = new DatabaseFactory(dir.resolve("db").toString());
        db = factory.create();
        db.transaction(() -> {
            for (String t : List.of("KnowPain", "KnowGain", "KnowJob", "KnowProjectActor")) db.command("sql", "CREATE VERTEX TYPE " + t);
            for (String e : List.of("FELT_BY", "DESIRED_BY", "PERFORMED_BY")) db.command("sql", "CREATE EDGE TYPE " + e);
            db.command("sql", "INSERT INTO KnowProjectActor SET actor_id = 'ROLE-DEV', name = 'Разработчик'");
            db.command("sql", "INSERT INTO KnowProjectActor SET actor_id = 'ROLE-AGENT', name = 'Агент сессии'");
            db.command("sql", "INSERT INTO KnowPain SET pain_id = 'PAIN-CI', title = 'CI красный без причины'");
            db.command("sql", "INSERT INTO KnowGain SET gain_id = 'GAIN-TRUST', title = 'Доверять выдаче'");
            db.command("sql", "INSERT INTO KnowJob SET job_id = 'JOB-SHIP', title = 'Выкатить изменение'");
            db.command("sql", "INSERT INTO KnowJob SET job_id = 'JOB-NOBODY', title = 'Работа без роли'");
            edge("FELT_BY", "KnowPain", "pain_id", "PAIN-CI", "ROLE-DEV");
            edge("DESIRED_BY", "KnowGain", "gain_id", "GAIN-TRUST", "ROLE-AGENT");
            edge("PERFORMED_BY", "KnowJob", "job_id", "JOB-SHIP", "ROLE-DEV");
            edge("PERFORMED_BY", "KnowJob", "job_id", "JOB-SHIP", "ROLE-AGENT");
        });
    }

    private void edge(String e, String type, String key, String id, String actor) {
        db.command("sql", "CREATE EDGE " + e + " FROM (SELECT FROM " + type + " WHERE " + key + " = '" + id + "') "
            + "TO (SELECT FROM KnowProjectActor WHERE actor_id = '" + actor + "')");
    }

    @AfterEach
    void close() {
        if (db != null) db.drop();
        if (factory != null) factory.close();
    }

    private List<Map<String, Object>> rows() {
        LoreSlices.Composed c = LoreSlices.compose("segment_values", Map.of());
        List<Map<String, Object>> out = new ArrayList<>();
        db.query("sql", c.sql(), c.params()).stream().forEach(r -> out.add(r.toMap()));
        return out;
    }

    @Test
    void строка_на_каждую_ценность_с_ролями_всех_трёх_осей() {
        Map<String, String> got = new TreeMap<>();
        for (Map<String, Object> r : rows()) {
            Object a = r.get("actor_ids");
            List<String> actors = a instanceof Collection<?> c ? c.stream().map(String::valueOf).sorted().toList() : List.of();
            got.put(r.get("value_type") + ":" + r.get("value_id"), r.get("title") + " " + actors);
        }
        assertEquals(Map.of(
            "pain:PAIN-CI", "CI красный без причины [ROLE-DEV]",
            "gain:GAIN-TRUST", "Доверять выдаче [ROLE-AGENT]",
            "job:JOB-SHIP", "Выкатить изменение [ROLE-AGENT, ROLE-DEV]",
            "job:JOB-NOBODY", "Работа без роли []"), got);
    }

    @Test
    void сравнение_поверх_среза_даёт_состав() {
        VpSegmentCompare.Result r = VpSegmentCompare.compare(rows(), List.of("ROLE-DEV", "ROLE-AGENT"),
            Map.of("ROLE-DEV", "Разработчик", "ROLE-AGENT", "Агент сессии"));
        List<String> got = r.values().stream().map(v -> v.value_id() + "=" + v.membership()
            + (v.only_of() == null ? "" : ":" + v.only_of())).toList();
        assertEquals(List.of("JOB-SHIP=shared", "PAIN-CI=only:ROLE-DEV", "GAIN-TRUST=only:ROLE-AGENT"), got);
        assertEquals(List.of("JOB-NOBODY"), r.unassigned().stream().map(VpSegmentCompare.Value::value_id).toList());
    }
}
