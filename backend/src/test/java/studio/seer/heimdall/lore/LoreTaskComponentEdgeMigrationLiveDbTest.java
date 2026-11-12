package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
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
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasItems;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Миграция BELONGS_TO KnowTask → LoreComponent → TAGGED_WITH на живой ArcadeDB
 * ({@link LoreTaskComponentEdgeMigration}, {@code /lore/link/task-component-edge/migrate}).
 *
 * <p>(1) Положительный контроль: старые рёбра посеяны и видны в сухом прогоне;
 * (2) сухой прогон ничего не пишет — проверка чтением; (3) применение переводит
 * рёбра, дубля TAGGED_WITH не появляется, чужие BELONGS_TO (ADR → компонент) не
 * тронуты; (4) повторный прогон — без изменений. Проверяются только посеянные
 * записи: база тестов общая, чужие строки в ней законны.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreTaskComponentEdgeMigrationLiveDbTest {

    private static final String COMP   = "COMP_TCE_MIGRATION_PROBE";
    /** Только старое ребро — новое создаётся. */
    private static final String TASK_A = "SPRINT_TCE_PROBE/TCE-1";
    /** Старое и новое сразу — новое не дублируется, старое удаляется. */
    private static final String TASK_B = "SPRINT_TCE_PROBE/TCE-2";
    private static final String ADR    = "ADR-TCE-PROBE";
    private static final String PATH   = "/lore/link/task-component-edge/migrate";

    private static List<Map<String, Object>> sql(String command) throws Exception {
        HttpClient http = HttpClient.newHttpClient();
        String body = io.vertx.core.json.JsonObject.of("language", "sql", "command", command).encode();
        HttpRequest req = HttpRequest.newBuilder(
                URI.create(LoreArcadeDbTestResource.BASE_URL + "/api/v1/command/" + LoreArcadeDbTestResource.TEST_DB))
            .header("Content-Type", "application/json; charset=utf-8")
            .header("Authorization", "Basic " + Base64.getEncoder().encodeToString(
                ("root:" + LoreArcadeDbTestResource.ROOT_PASSWORD).getBytes(StandardCharsets.UTF_8)))
            .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8)).build();
        HttpResponse<String> r = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        io.vertx.core.json.JsonObject j = new io.vertx.core.json.JsonObject(r.body());
        List<Map<String, Object>> out = new ArrayList<>();
        io.vertx.core.json.JsonArray arr = j.getJsonArray("result", new io.vertx.core.json.JsonArray());
        for (int i = 0; i < arr.size(); i++) out.add(arr.getJsonObject(i).getMap());
        return out;
    }

    private static long n(String query) throws Exception {
        return ((Number) sql(query).get(0).get("n")).longValue();
    }

    private static long edges(String edge, String outField, String outId) throws Exception {
        return n("SELECT count(*) AS n FROM " + edge + " WHERE @out." + outField + " = '" + outId
            + "' AND @in.component_id = '" + COMP + "'");
    }

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin");
    }

    @Test
    @Order(1)
    void seed() throws Exception {
        sql("INSERT INTO LoreComponent SET component_id = '" + COMP + "', name = 'проба миграции'");
        sql("INSERT INTO KnowTask SET task_uid = '" + TASK_A + "', src = 'qg', title = 'проба A'");
        sql("INSERT INTO KnowTask SET task_uid = '" + TASK_B + "', src = 'qg', title = 'проба B'");
        sql("INSERT INTO KnowADR SET adr_id = '" + ADR + "', title = 'проба ADR'");
        for (String t : List.of(TASK_A, TASK_B))
            sql("CREATE EDGE BELONGS_TO FROM (SELECT FROM KnowTask WHERE task_uid = '" + t + "') "
                + "TO (SELECT FROM LoreComponent WHERE component_id = '" + COMP + "')");
        sql("CREATE EDGE TAGGED_WITH FROM (SELECT FROM KnowTask WHERE task_uid = '" + TASK_B + "') "
            + "TO (SELECT FROM LoreComponent WHERE component_id = '" + COMP + "')");
        sql("CREATE EDGE BELONGS_TO FROM (SELECT FROM KnowADR WHERE adr_id = '" + ADR + "') "
            + "TO (SELECT FROM LoreComponent WHERE component_id = '" + COMP + "')");
        // Положительный контроль: дефект посеян.
        assertEquals(1, edges("BELONGS_TO", "task_uid", TASK_A));
        assertEquals(1, edges("BELONGS_TO", "task_uid", TASK_B));
        assertEquals(0, edges("TAGGED_WITH", "task_uid", TASK_A));
        assertEquals(1, edges("TAGGED_WITH", "task_uid", TASK_B));
    }

    @Test
    @Order(2)
    void notAdminIsRefused() {
        given().header("X-Seer-Role", "viewer").when().get(PATH).then().statusCode(403);
        given().header("X-Seer-Role", "viewer").when().post(PATH + "?apply=true").then().statusCode(403);
    }

    @Test
    @Order(3)
    void dryRunShowsPlanAndWritesNothing() throws Exception {
        admin().when().get(PATH).then().statusCode(200)
            .body("migration_id", equalTo("qg-task-component-edge"))
            .body("dry_run", equalTo(true))
            .body("task_uids", hasItems(TASK_A, TASK_B))
            .body("items.find { it.task_uid == '" + TASK_A + "' }.create", equalTo("TAGGED_WITH"))
            .body("items.find { it.task_uid == '" + TASK_B + "' }.create", equalTo(null));
        assertEquals(0, edges("TAGGED_WITH", "task_uid", TASK_A), "сухой прогон записал ребро");
        assertEquals(1, edges("BELONGS_TO", "task_uid", TASK_A), "сухой прогон удалил ребро");
    }

    @Test
    @Order(4)
    void postWithoutApplyIsRefused() throws Exception {
        admin().when().post(PATH).then().statusCode(400);
        assertEquals(1, edges("BELONGS_TO", "task_uid", TASK_A));
    }

    @Test
    @Order(5)
    void applyMigratesWithoutDuplicates() throws Exception {
        admin().when().post(PATH + "?apply=true").then().statusCode(200)
            .body("migration_id", equalTo("qg-task-component-edge"))
            .body("dry_run", equalTo(false))
            .body("failed", equalTo(0));
        assertEquals(1, edges("TAGGED_WITH", "task_uid", TASK_A));
        assertEquals(1, edges("TAGGED_WITH", "task_uid", TASK_B), "у B не должно появиться второго TAGGED_WITH");
        assertEquals(0, edges("BELONGS_TO", "task_uid", TASK_A));
        assertEquals(0, edges("BELONGS_TO", "task_uid", TASK_B));
        assertEquals(1, edges("BELONGS_TO", "adr_id", ADR), "BELONGS_TO ADR → компонент законен и не трогается");
    }

    @Test
    @Order(6)
    void repeatIsNoop() throws Exception {
        admin().when().get(PATH).then().statusCode(200)
            .body("task_uids", not(hasItem(TASK_A)))
            .body("task_uids", not(hasItem(TASK_B)));
        admin().when().post(PATH + "?apply=true").then().statusCode(200).body("failed", equalTo(0));
        assertEquals(1, edges("TAGGED_WITH", "task_uid", TASK_A));
        assertEquals(1, edges("TAGGED_WITH", "task_uid", TASK_B));
    }
}
