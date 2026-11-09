package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.path.json.JsonPath;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S7C_WHY_CANVAS/S7C-01 — холст на сервере сквозь REST: создать →
 * положить стикеры и стрелку → прочитать целиком → сдвинуть стикер (тот же стикер,
 * новые координаты) → удалить стикер вместе с его стрелкой. Плохие поля — 400,
 * чужой холст по несуществующему id — 404, а не пустой холст.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreCanvasLiveDbTest {

    static final String UID = "cv-s7c01-probe";

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    private static JsonPath canvas() {
        return admin().when().get("/lore/canvas/" + UID).then().statusCode(200).extract().jsonPath();
    }

    @Test
    @Order(1)
    void createCanvas() {
        admin().body("{\"canvas_uid\":\"" + UID + "\",\"title\":\"VP LORE\",\"template\":\"vp\"}")
            .when().post("/lore/canvas").then().statusCode(200);
        List<String> uids = admin().when().get("/lore/canvas").then().statusCode(200)
            .extract().jsonPath().getList("canvases.canvas_uid");
        assertTrue(uids.contains(UID), "холст в списке: " + uids);
    }

    @Test
    @Order(2)
    void putStickersAndAnArrow() {
        admin().body("{\"items\":["
                + "{\"item_uid\":\"a\",\"kind\":\"sticker\",\"text\":\"боль\",\"x\":10,\"y\":20,\"w\":160,\"h\":90},"
                + "{\"item_uid\":\"b\",\"kind\":\"sticker\",\"text\":\"выгода\",\"x\":300,\"y\":20,"
                + "\"ref_type\":\"gain\",\"ref_id\":\"GAIN-1\"}]}")
            .when().post("/lore/canvas/" + UID + "/items").then().statusCode(200);
        admin().body("{\"links\":[{\"link_uid\":\"ab\",\"from_uid\":\"a\",\"to_uid\":\"b\",\"edge\":\"RELIEVES\"}]}")
            .when().post("/lore/canvas/" + UID + "/links").then().statusCode(200);
        JsonPath c = canvas();
        assertEquals("VP LORE", c.getString("canvas.title"));
        assertEquals(2, c.getList("items").size());
        assertEquals(1, c.getList("links").size());
        assertEquals("GAIN-1", c.getString("items.find { it.item_uid == 'b' }.ref_id"));
    }

    @Test
    @Order(3)
    void movingAStickerUpdatesItInPlace() {
        admin().body("{\"items\":[{\"item_uid\":\"a\",\"kind\":\"sticker\",\"text\":\"боль\",\"x\":55.5,\"y\":66}]}")
            .when().post("/lore/canvas/" + UID + "/items").then().statusCode(200);
        JsonPath c = canvas();
        assertEquals(2, c.getList("items").size(), "сдвиг — тот же стикер, а не новый");
        Map<String, Object> a = c.getMap("items.find { it.item_uid == 'a' }");
        assertEquals(55.5, ((Number) a.get("x")).doubleValue(), 1e-9);
    }

    @Test
    @Order(4)
    void badItemIsRefusedWithReason() {
        admin().body("{\"items\":[{\"item_uid\":\"z\",\"kind\":\"circle\",\"x\":0,\"y\":0}]}")
            .when().post("/lore/canvas/" + UID + "/items").then().statusCode(400);
        admin().body("{\"items\":[{\"item_uid\":\"z\",\"kind\":\"sticker\",\"x\":0,\"y\":0}]}")
            .when().post("/lore/canvas/cv-no-such/items").then().statusCode(404);
        admin().when().get("/lore/canvas/cv-no-such").then().statusCode(404);
    }

    @Test
    @Order(5)
    void deletingAStickerTakesItsArrowsWithIt() {
        admin().body("{\"item_uids\":[\"a\"]}")
            .when().post("/lore/canvas/" + UID + "/items/delete").then().statusCode(200);
        JsonPath c = canvas();
        assertEquals(1, c.getList("items").size());
        assertTrue(c.getList("links").isEmpty(), "стрелка из удалённого стикера не висит: " + c.getList("links"));
    }
}
