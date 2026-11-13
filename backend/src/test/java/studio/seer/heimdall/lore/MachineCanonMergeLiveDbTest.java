package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * SPRINT_UXR_POLISH_UAT_1113/PU-18 шаг 2 — V82 на живой изолированной БД (testcontainers).
 * Локально НЕ гонять — только CI: любой прогон Quarkus-теста мигрирует базу.
 *
 * <p>Посев повторяет прод 13.11: агент A с рёбрами на «MgTest» и «MGTEST», агент B —
 * на «MGTEST», поле machine_id у A = «MGTEST». После шага — одна вершина «mgtest»,
 * оба агента на ней, вариантов нет, поле канонично. Повтор ничего не меняет.
 * Проверка чтением из БД (UPDATE без эффекта отвечает так же, как с эффектом).
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class MachineCanonMergeLiveDbTest {

    private static final String A = "AGENT-V82-PROBE-A";
    private static final String B = "AGENT-V82-PROBE-B";

    @Inject
    LoreSchemaMigrationRunner runner;

    private static List<Map<String, Object>> sql(String query) throws Exception {
        HttpClient http = LiveDbHttp.client();   // один клиент на прогон (сторож LiveDbHttpGuardTest, OOM CI 13.11)
        String body = io.vertx.core.json.JsonObject.of("language", "sql", "command", query).encode();
        HttpRequest req = HttpRequest.newBuilder(
                URI.create(LoreArcadeDbTestResource.BASE_URL + "/api/v1/command/" + LoreArcadeDbTestResource.TEST_DB))
            .header("Content-Type", "application/json")
            .header("Authorization", "Basic " + Base64.getEncoder().encodeToString(
                ("root:" + LoreArcadeDbTestResource.ROOT_PASSWORD).getBytes(StandardCharsets.UTF_8)))
            .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        HttpResponse<String> r = http.send(req, HttpResponse.BodyHandlers.ofString());
        io.vertx.core.json.JsonObject j = new io.vertx.core.json.JsonObject(r.body());
        java.util.List<Map<String, Object>> out = new java.util.ArrayList<>();
        io.vertx.core.json.JsonArray arr = j.getJsonArray("result", new io.vertx.core.json.JsonArray());
        for (int i = 0; i < arr.size(); i++) out.add(arr.getJsonObject(i).getMap());
        return out;
    }

    private static long n(String query) throws Exception {
        return ((Number) sql(query).get(0).get("n")).longValue();
    }

    private static void edge(String actor, String machine) throws Exception {
        sql("CREATE EDGE USES_MACHINE FROM (SELECT FROM KnowActor WHERE actor_id = '" + actor
            + "') TO (SELECT FROM KnowMachine WHERE machine_id = '" + machine + "') IF NOT EXISTS");
    }

    private static void assertMerged() throws Exception {
        assertEquals(0, n("SELECT count(*) AS n FROM KnowMachine WHERE machine_id IN ['MgTest', 'MGTEST']"), "варианты остались");
        assertEquals(1, n("SELECT count(*) AS n FROM KnowMachine WHERE machine_id = 'mgtest'"), "канонической вершины нет или две");
        assertEquals(1, n("SELECT count(*) AS n FROM USES_MACHINE WHERE @out.actor_id = '" + A + "' AND @in.machine_id = 'mgtest'"));
        assertEquals(1, n("SELECT count(*) AS n FROM USES_MACHINE WHERE @out.actor_id = '" + B + "' AND @in.machine_id = 'mgtest'"));
        assertEquals(0, n("SELECT count(*) AS n FROM KnowActor WHERE actor_id = '" + A + "' AND machine_id <> 'mgtest'"), "поле machine_id не канонично");
    }

    @Test
    @Order(1)
    void caseVariantsMergeIntoOneCanonicalMachine() throws Exception {
        sql("INSERT INTO KnowActor SET actor_id = '" + A + "', kind = 'agent', machine_id = 'MGTEST'");
        sql("INSERT INTO KnowActor SET actor_id = '" + B + "', kind = 'agent'");
        // Даты (находка 13.11): канонической нет — её даты собираются из вариантов.
        sql("INSERT INTO KnowMachine SET machine_id = 'MgTest', first_seen_at = '2026-11-13T09:35:00Z', last_seen_at = '2026-11-13T09:35:00Z'");
        sql("INSERT INTO KnowMachine SET machine_id = 'MGTEST', first_seen_at = '2026-11-13T07:46:00Z', last_seen_at = '2026-11-13T12:24:00Z'");
        // Вторая группа — каноническая УЖЕ есть и моложе вариантов (как lorcetus 18:49 на проде).
        sql("INSERT INTO KnowMachine SET machine_id = 'mgdate', first_seen_at = '2026-11-13T18:49:00Z', last_seen_at = '2026-11-13T18:49:00Z'");
        sql("INSERT INTO KnowMachine SET machine_id = 'MGDATE', first_seen_at = '2026-11-13T07:46:00Z', last_seen_at = '2026-11-13T12:24:00Z'");
        edge(A, "MgTest");
        edge(A, "MGTEST");
        edge(B, "MGTEST");
        assertEquals(3, n("SELECT count(*) AS n FROM USES_MACHINE WHERE @in.machine_id IN ['MgTest', 'MGTEST']"),
            "положительный контроль: рёбра посеяны");

        runner.mergeMachineCase();

        assertMerged();
        assertSeen("mgtest", "2026-11-13T07:46:00Z", "2026-11-13T12:24:00Z");
        assertSeen("mgdate", "2026-11-13T07:46:00Z", "2026-11-13T18:49:00Z");
        assertEquals(0, n("SELECT count(*) AS n FROM KnowMachine WHERE machine_id = 'MGDATE'"), "вариант с канонической не удалён");
    }

    private static void assertSeen(String machine, String first, String last) throws Exception {
        Map<String, Object> r = sql("SELECT first_seen_at, last_seen_at FROM KnowMachine WHERE machine_id = '" + machine + "'").get(0);
        assertEquals(first, String.valueOf(r.get("first_seen_at")), machine + ": first_seen_at не самый ранний");
        assertEquals(last, String.valueOf(r.get("last_seen_at")), machine + ": last_seen_at не самый поздний");
    }

    @Test
    @Order(2)
    void secondRunChangesNothing() throws Exception {
        runner.mergeMachineCase();
        assertMerged();
        assertSeen("mgtest", "2026-11-13T07:46:00Z", "2026-11-13T12:24:00Z");
        assertSeen("mgdate", "2026-11-13T07:46:00Z", "2026-11-13T18:49:00Z");
    }

    @AfterAll
    static void cleanup() throws Exception {
        sql("DELETE FROM KnowActor WHERE actor_id IN ['" + A + "', '" + B + "']");
        sql("DELETE FROM KnowMachine WHERE machine_id IN ['mgtest', 'MgTest', 'MGTEST', 'mgdate', 'MGDATE']");
    }
}
