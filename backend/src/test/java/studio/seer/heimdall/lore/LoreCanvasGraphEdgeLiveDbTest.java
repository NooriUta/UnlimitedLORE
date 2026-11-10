package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;

/**
 * SPRINT_UXR_S7C_WHY_CANVAS/S7C-05 — стрелка между ПРИВЯЗАННЫМИ стикерами —
 * типизированное ребро графа между их сущностями; удаление стрелки (или
 * стикера) снимает ровно своё ребро. Наличие ребра проверяется независимой
 * пробой — повторной постановкой той же связи из упоминания (S2-06): есть
 * ребро — {@code unchanged}, нет — {@code created}.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreCanvasGraphEdgeLiveDbTest {

    static final String UID = "cv-s7c05-probe";
    static final String TASK = "SPRINT_CV5/T1";
    static final String ADR = "ADR-CV5-1";

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    private static String arrow(String uid, String from, String to, String edge) {
        return "{\"links\":[{\"link_uid\":\"" + uid + "\",\"from_uid\":\"" + from + "\",\"to_uid\":\"" + to
            + "\",\"edge\":\"" + edge + "\"}]}";
    }

    /** Независимая проба ребра task → adr: outcome повторной постановки из упоминания. */
    private static String probe(String edge) {
        return admin().body("{\"from_type\":\"task\",\"from_id\":\"" + TASK + "\",\"to_type\":\"adr\",\"to_id\":\""
                + ADR + "\",\"edge_type\":\"" + edge + "\"}")
            .when().post("/lore/link/mention").then().statusCode(200).extract().path("outcome");
    }

    @Test
    @Order(1)
    void setUp() {
        admin().body("{\"sprint_id\":\"SPRINT_CV5\",\"name\":\"canvas-edge\"}")
            .when().post("/lore/sprint/create").then().statusCode(200);
        admin().body("{\"adr_id\":\"" + ADR + "\",\"name\":\"Решение на холсте\",\"status\":\"ACCEPTED\"}")
            .when().post("/lore/adr").then().statusCode(200);
        admin().body("{\"sprint_id\":\"SPRINT_CV5\",\"task_id\":\"T1\",\"title\":\"задача на холсте\"}")
            .when().post("/lore/task").then().statusCode(200);
        admin().body("{\"canvas_uid\":\"" + UID + "\",\"title\":\"зачем\",\"template\":\"free\"}")
            .when().post("/lore/canvas").then().statusCode(200);
        admin().body("{\"items\":["
                + "{\"item_uid\":\"t\",\"kind\":\"sticker\",\"x\":0,\"y\":0,\"ref_type\":\"task\",\"ref_id\":\"" + TASK + "\"},"
                + "{\"item_uid\":\"a\",\"kind\":\"sticker\",\"x\":200,\"y\":0,\"ref_type\":\"adr\",\"ref_id\":\"" + ADR + "\"},"
                + "{\"item_uid\":\"z\",\"kind\":\"sticker\",\"x\":400,\"y\":0,\"ref_type\":\"adr\",\"ref_id\":\"ADR-CV5-NOPE\"},"
                + "{\"item_uid\":\"u\",\"kind\":\"sticker\",\"x\":0,\"y\":200,\"text\":\"просто мысль\"}]}")
            .when().post("/lore/canvas/" + UID + "/items").then().statusCode(200);
    }

    @Test
    @Order(2)
    void arrowBetweenBoundStickersWritesTheTypedEdge() {
        admin().body(arrow("ta", "t", "a", "JUSTIFIED_BY"))
            .when().post("/lore/canvas/" + UID + "/links").then().statusCode(200)
            .body("graph[0].link_uid", equalTo("ta"))
            .body("graph[0].edge_type", equalTo("JUSTIFIED_BY"))
            .body("graph[0].state", equalTo("created"));
        admin().when().get("/lore/canvas/" + UID).then().statusCode(200)
            .body("links.find { it.link_uid == 'ta' }.graph", equalTo("created"));
        assertEquals("unchanged", probe("JUSTIFIED_BY"), "ребро графа есть");
    }

    @Test
    @Order(3)
    void refusalsHappenBeforeWriteAndUnboundStaysADrawing() {
        admin().body(arrow("bad", "t", "a", "RELIEVES"))
            .when().post("/lore/canvas/" + UID + "/links").then().statusCode(400)
            .body("error", equalTo("EDGE_NOT_ALLOWED"));
        admin().body(arrow("rev", "a", "t", "JUSTIFIED_BY"))
            .when().post("/lore/canvas/" + UID + "/links").then().statusCode(400)
            .body("error", equalTo("EDGE_NOT_ALLOWED"));
        admin().body(arrow("gone", "t", "z", "JUSTIFIED_BY"))
            .when().post("/lore/canvas/" + UID + "/links").then().statusCode(404)
            .body("error", equalTo("TARGET_NOT_FOUND"));
        admin().when().get("/lore/canvas/" + UID).then().statusCode(200).body("links", hasSize(1));

        admin().body(arrow("ua", "u", "a", "RELIEVES"))
            .when().post("/lore/canvas/" + UID + "/links").then().statusCode(200)
            .body("graph[0].state", equalTo("drawing"));
    }

    @Test
    @Order(4)
    void deletingTheArrowTakesItsEdgeAway() {
        admin().body("{\"link_uids\":[\"ta\"]}")
            .when().post("/lore/canvas/" + UID + "/links/delete").then().statusCode(200);
        // ребра не было — проба его ставит (дальше это ЧУЖОЕ ребро, origin=mention)
        assertEquals("created", probe("JUSTIFIED_BY"), "стрелка снята — ребро снято");
    }

    @Test
    @Order(5)
    void arrowOverAForeignEdgeDoesNotOwnIt() {
        admin().body(arrow("ta2", "t", "a", "JUSTIFIED_BY"))
            .when().post("/lore/canvas/" + UID + "/links").then().statusCode(200)
            .body("graph[0].state", equalTo("existing"));
        admin().body("{\"link_uids\":[\"ta2\"]}")
            .when().post("/lore/canvas/" + UID + "/links/delete").then().statusCode(200);
        assertEquals("unchanged", probe("JUSTIFIED_BY"), "чужое ребро стрелка не снимает");
    }

    @Test
    @Order(6)
    void deletingAStickerTakesTheEdgesOfItsArrows() {
        admin().body(arrow("tr", "t", "a", "REFERENCES"))
            .when().post("/lore/canvas/" + UID + "/links").then().statusCode(200)
            .body("graph[0].state", equalTo("created"));
        admin().body("{\"item_uids\":[\"t\"]}")
            .when().post("/lore/canvas/" + UID + "/items/delete").then().statusCode(200);
        assertEquals("created", probe("REFERENCES"), "стикер снят — ребро его стрелки снято");
    }

    private static void assertEquals(String expected, String actual, String why) {
        org.junit.jupiter.api.Assertions.assertEquals(expected, actual, why);
    }
}
