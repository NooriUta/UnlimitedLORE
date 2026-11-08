package studio.seer.heimdall.lore;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_PIPELINE_HOST/PL-01: поведение ресурса тест-БД без живой базы.
 *
 * <p>Главное обещание: схема строится ОДИН раз за прогон. Второй старт ресурса
 * не делает drop/create и отдаёт приложению lore.bootstrap=false, а данные
 * чистит (рёбра раньше вершин, ledger не трогает) и возвращает снимок. Класс
 * «чистая база» пересоздаёт всегда и сбрасывает «схема готова» для следующего.
 */
class LoreArcadeDbTestResourceReuseTest {

    /** Запись вызовов вместо HTTP. */
    static final class FakeDb implements LoreArcadeDbTestResource.Db {
        final List<String> calls = new ArrayList<>();

        @Override public void awaitReady() { }
        @Override public void serverCommand(String command, boolean ignoreError) { calls.add("server:" + command); }
        @Override public void command(String sql) { calls.add("sql:" + sql); }
        @Override public void script(String s) { calls.add("script:" + s); }

        @Override
        public List<Map<String, Object>> query(String sql) {
            calls.add("query:" + sql);
            if (sql.contains("schema:types")) {
                return List.of(
                    Map.of("name", "KnowTask", "type", "vertex"),
                    Map.of("name", "KnowSprint", "type", "vertex"),
                    Map.of("name", "KnowADR", "type", "vertex"),
                    Map.of("name", "LoreComponent", "type", "vertex"),
                    Map.of("name", "LoreSchemaVersion", "type", "vertex"),
                    Map.of("name", "BELONGS_TO", "type", "edge"),
                    Map.of("name", "LoreSetting", "type", "document"));
            }
            if (sql.contains("`LoreComponent`")) {
                return List.of(Map.of("@rid", "#10:0", "@type", "LoreComponent", "@cat", "v",
                    "component_id", "YGG", "full_name", "Yggdrasil"),
                    Map.of("@rid", "#10:1", "@type", "LoreComponent", "@cat", "v",
                    "component_id", "LORE", "full_name", "System; AIDA \"Lore\""));
            }
            if (sql.contains("`BELONGS_TO`")) {
                return List.of(Map.of("@rid", "#20:0", "@type", "BELONGS_TO", "@cat", "e",
                    "@out", "#10:1", "@in", "#10:0"));
            }
            return List.of();
        }

        boolean dropsOrCreates() {
            return calls.stream().anyMatch(c -> c.startsWith("server:drop database") || c.startsWith("server:create database"));
        }
    }

    private String url;

    @BeforeEach
    void isolate() {
        clearState();
        url = "http://unit-" + UUID.randomUUID() + ":2480";
    }

    @AfterEach
    void cleanup() { clearState(); }

    private static void clearState() {
        for (String p : List.of(LoreArcadeDbTestResource.P_READY, LoreArcadeDbTestResource.P_PENDING,
                LoreArcadeDbTestResource.P_BASELINE, LoreArcadeDbTestResource.P_STARTS,
                LoreArcadeDbTestResource.P_FRESH)) {
            System.clearProperty(p);
        }
    }

    private LoreArcadeDbTestResource resource(LoreArcadeDbTestResource r, FakeDb db) {
        r.env = name -> switch (name) {
            case "LORE_TEST_DB_URL" -> url;
            case "LORE_TEST_DB_NAME" -> "unit_db";
            case "LORE_TEST_DB_PASSWORD" -> "pw";
            default -> null;
        };
        r.dbFactory = c -> db;
        return r;
    }

    /** Подъём приложения после fresh-старта: то, что делает LoreTestDbBaselineCapture. */
    private void appStartedAfterFresh(FakeDb db) {
        LoreArcadeDbTestResource.captureBaseline(db, url + "|unit_db");
    }

    @Test
    void secondStartReusesSchemaWithoutDropCreate() {
        FakeDb first = new FakeDb();
        Map<String, String> cfg1 = resource(new LoreArcadeDbTestResource(), first).start();
        assertTrue(first.dropsOrCreates(), "первый старт обязан пройти fresh-путь (ADR-LORE-023)");
        assertEquals("true", cfg1.get("lore.bootstrap"));
        appStartedAfterFresh(first);

        FakeDb second = new FakeDb();
        Map<String, String> cfg2 = resource(new LoreArcadeDbTestResource(), second).start();
        assertFalse(second.dropsOrCreates(), "второй старт пересоздал базу: " + second.calls);
        assertEquals("false", cfg2.get("lore.bootstrap"), "на reuse инициализатор обязан пропустить DDL");
        assertEquals("true", cfg2.get("lore.migrate"), "раннер миграций остаётся включённым");
        assertEquals("1", System.getProperty(LoreArcadeDbTestResource.P_FRESH), "fresh-инициализаций за прогон");

        String deletes = second.calls.stream().filter(c -> c.startsWith("script:DELETE")).findFirst().orElse("");
        assertTrue(deletes.contains("DELETE FROM `BELONGS_TO`"), "рёбра не чистились: " + deletes);
        assertTrue(deletes.contains("DELETE FROM `LoreComponent`"), "вершины не чистились");
        assertTrue(deletes.contains("DELETE FROM `LoreSetting`"), "документы не чистились");
        assertTrue(deletes.indexOf("`BELONGS_TO`") < deletes.indexOf("`LoreComponent`"), "рёбра обязаны идти раньше вершин");
        assertFalse(deletes.contains("LoreSchemaVersion"), "ledger чистить нельзя — миграции покатятся заново");

        String restore = second.calls.stream().filter(c -> c.startsWith("script:LET")).findFirst().orElse("");
        assertTrue(restore.contains("CREATE VERTEX `LoreComponent` CONTENT"), "снимок не вернулся: " + second.calls);
        assertTrue(restore.contains("\"component_id\":\"YGG\""), restore);
        assertFalse(restore.contains("@rid"), "метаполя не должны попадать в CONTENT");
        assertTrue(restore.contains("CREATE EDGE `BELONGS_TO` FROM $r1 TO $r0"),
            "ребро обязано ссылаться на НОВЫЕ записи своих концов: " + restore);
    }

    @Test
    void freshClassAlwaysRecreatesAndForcesNextClassFresh() {
        FakeDb first = new FakeDb();
        resource(new LoreArcadeDbTestResource(), first).start();
        appStartedAfterFresh(first);

        FakeDb fresh = new FakeDb();
        Map<String, String> cfg = resource(new LoreArcadeDbFreshTestResource(), fresh).start();
        assertTrue(fresh.dropsOrCreates(), "класс «чистая база» обязан пересоздать базу");
        assertEquals("true", cfg.get("lore.bootstrap"));

        FakeDb next = new FakeDb();
        resource(new LoreArcadeDbTestResource(), next).start();
        assertTrue(next.dropsOrCreates(), "после класса «чистая база» схема испорчена — следующий обязан пойти fresh");
    }

    @Test
    void missingBaselineFallsBackToFresh() {
        FakeDb first = new FakeDb();
        resource(new LoreArcadeDbTestResource(), first).start();
        // снимок НЕ снят (наблюдатель не отработал)

        FakeDb second = new FakeDb();
        Map<String, String> cfg = resource(new LoreArcadeDbTestResource(), second).start();
        assertTrue(second.dropsOrCreates(), "без снимка reuse вернул бы базу без справочников — только fresh");
        assertEquals("true", cfg.get("lore.bootstrap"));
    }
}
