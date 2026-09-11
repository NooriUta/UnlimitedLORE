package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
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

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * AO-05 / V46: блок V38 в примечании → ребро ROLE_HELD_BY на AGENT-FULL с origin
 * ДОСЛОВНО; повторный прогон ничего не добавляет; метка в прозе ребра не даёт;
 * примечание не чистится.
 *
 * <p>Проверяется прочтением рёбер из БД, а не кодом ответа: CREATE EDGE с пустым
 * TO — тихий no-op, и «создано 0» без обратного чтения было бы неотличимо от
 * работы.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class DroppedRoleEdgesLiveDbTest {

    private static final String PROJECT = "v46-project";
    private static final String SPRINT  = "SPRINT_V46_ORIGIN";
    private static final String TASK    = SPRINT + "/V46-1";   // с блоком V38
    private static final String TASK2   = SPRINT + "/V46-2";   // метка только в прозе
    private static final String ORIGIN_EXEC = "minilore-app";
    private static final String ORIGIN_REV  = "claude-full + соседняя сессия";

    @Inject
    LoreSchemaMigrationRunner runner;

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    private static List<Map<String, Object>> sql(String query) throws Exception {
        HttpClient http = HttpClient.newHttpClient();
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

    private static String agentId() {
        return TaskRoleMapping.of("claude-full").identity();
    }

    private static List<Map<String, Object>> openEdges(String taskUid) throws Exception {
        return sql("SELECT role, origin, @in.actor_id AS actor FROM ROLE_HELD_BY "
            + "WHERE @out.task_uid = '" + taskUid + "' AND valid_to IS NULL ORDER BY role");
    }

    @Test
    @Order(1)
    void setUp() throws Exception {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"slug\":\"" + PROJECT + "\"}")
        .when().post("/lore/project").then().statusCode(200);
        admin().body("{\"actor_id\":\"" + agentId() + "\",\"name\":\"Полный агент\",\"kind\":\"agent\"}")
            .when().post("/lore/actor").then().statusCode(200);
        admin().body("{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"Спринт origin\","
                + "\"git_project\":\"" + PROJECT + "\"}")
            .when().post("/lore/sprint/create").then().statusCode(200);
        // Примечания — ровно в той форме, что писал V38 (и цитата метки в прозе у второй).
        // Через JSON тела создания, а не UPDATE строкой: переводы строк и кавычки в
        // SQL-литерале пришлось бы экранировать вручную, и ошибка экранирования
        // выглядела бы как «блок не распознан».
        String block = "Было раньше.\n\n" + DroppedRoleNote.MARKER + "\n"
            + "**Роли из снятых полей** (не сопоставлены с заявленными личностями, "
            + "сохранены при переходе на рёбра): executor = " + ORIGIN_EXEC
            + "; reviewer = " + ORIGIN_REV + ".";
        String prose = "Я искала по подстроке `" + DroppedRoleNote.MARKER + "`, а не по блоку. executor = кто-то.";
        admin().body(io.vertx.core.json.JsonObject.of("sprint_id", SPRINT, "task_id", "V46-1",
                "title", "С блоком V38", "note_md", block).encode())
            .when().post("/lore/task").then().statusCode(200);
        admin().body(io.vertx.core.json.JsonObject.of("sprint_id", SPRINT, "task_id", "V46-2",
                "title", "Метка в прозе", "note_md", prose).encode())
            .when().post("/lore/task").then().statusCode(200);

        assertTrue(openEdges(TASK).isEmpty(), "до шага рёбер нет — иначе тест ничего не проверяет");
    }

    @Test
    @Order(2)
    void blockBecomesEdgesWithVerbatimOrigin() throws Exception {
        runner.backfillDroppedRoleNotes();

        List<Map<String, Object>> e = openEdges(TASK);
        assertEquals(2, e.size(), "две роли из блока → два ребра: " + e);
        assertEquals("executor", e.get(0).get("role"));
        assertEquals(ORIGIN_EXEC, e.get(0).get("origin"));
        assertEquals(agentId(), e.get(0).get("actor"));
        assertEquals("reviewer", e.get(1).get("role"));
        // составное значение — дословно, с «+» и вторым участником
        assertEquals(ORIGIN_REV, e.get(1).get("origin"));
        assertEquals(agentId(), e.get(1).get("actor"));

        assertTrue(openEdges(TASK2).isEmpty(), "метка в прозе — не блок, ребра быть не должно");
    }

    @Test
    @Order(3)
    void secondRunAddsNothingAndNoteIsKept() throws Exception {
        runner.backfillDroppedRoleNotes();
        assertEquals(2, openEdges(TASK).size(), "повторный прогон не добавил рёбер");

        List<Map<String, Object>> hist = sql("SELECT note_md FROM KnowTaskHist "
            + "WHERE in('HAS_STATE').task_uid[0] = '" + TASK + "' AND valid_to IS NULL");
        assertEquals(1, hist.size());
        assertTrue(String.valueOf(hist.get(0).get("note_md")).contains(DroppedRoleNote.MARKER),
            "блок V38 остаётся в примечании — это след происхождения");
    }
}
