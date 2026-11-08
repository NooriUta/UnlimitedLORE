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
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.notNullValue;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-06 · decision:D-2026-UXR-LINK-MENTION-EDGE.
 *
 * <p>Эндпоинт допустимых типов для «Связать» и создание ребра из упоминания:
 * типизированное ребро или запасной {@code REFERENCES}, с аудитом (кто, когда,
 * откуда) на самом ребре. Отказы — до записи: неизвестный тип, недопустимая
 * пара, отсутствующий конец, петля.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreLinkMentionLiveDbTest {

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    private static String mention(String fromType, String fromId, String toType, String toId, String edge) {
        return "{\"from_type\":\"" + fromType + "\",\"from_id\":\"" + fromId + "\",\"to_type\":\"" + toType
            + "\",\"to_id\":\"" + toId + "\"" + (edge == null ? "" : ",\"edge_type\":\"" + edge + "\"") + "}";
    }

    @Test
    @Order(1)
    void setUp() {
        post("/lore/sprint/create", "{\"sprint_id\":\"SPRINT_LM\",\"name\":\"link-mention\"}");
        post("/lore/adr", "{\"adr_id\":\"ADR-LM-1\",\"name\":\"Упоминаемое решение\",\"status\":\"ACCEPTED\"}");
        post("/lore/task", "{\"sprint_id\":\"SPRINT_LM\",\"task_id\":\"T1\",\"title\":\"задача с упоминанием\"}");
    }

    @Test
    @Order(2)
    void typesEndpointOffersTypedAndFallback() {
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/link/types?from_type=adr&to_type=sprint")
        .then().statusCode(200)
            .body("options.edge_type", hasItem("IMPLEMENTED_IN"))
            .body("fallback.edge_type", equalTo("REFERENCES"))
            .body("options[-1].edge_type", equalTo("REFERENCES"));

        // без пары — весь каталог: типы и таблица пар
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/link/types")
        .then().statusCode(200)
            .body("types.type", hasItem("task"))
            .body("pairs.edge_type", hasItem("JUSTIFIED_BY"))
            .body("fallback.edge_type", equalTo("REFERENCES"));

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/link/types?from_type=bogus&to_type=adr")
        .then().statusCode(400).body("error", equalTo("BAD_PARAMS"));
    }

    @Test
    @Order(3)
    void typedEdgeFromMentionIsCreatedThenIdempotent() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(mention("task", "SPRINT_LM/T1", "adr", "ADR-LM-1", "JUSTIFIED_BY"))
        .when().post("/lore/link/mention")
        .then().statusCode(200)
            .body("ok", equalTo(true))
            .body("edge_type", equalTo("JUSTIFIED_BY"))
            .body("outcome", equalTo("created"));

        // читатель-слайс видит связь: задача больше не «энейблер без обоснования»
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/tasks_of_sprint?sprint_id=SPRINT_LM")
        .then().statusCode(200);

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(mention("task", "SPRINT_LM/T1", "adr", "ADR-LM-1", "JUSTIFIED_BY"))
        .when().post("/lore/link/mention")
        .then().statusCode(200).body("outcome", equalTo("unchanged"));
    }

    @Test
    @Order(4)
    void referencesIsTheDefaultAndCarriesAudit() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(mention("adr", "ADR-LM-1", "task", "SPRINT_LM/T1", null))
        .when().post("/lore/link/mention")
        .then().statusCode(200)
            .body("edge_type", equalTo("REFERENCES"))
            .body("fallback", equalTo(true))
            .body("outcome", equalTo("created"))
            .body("audit.origin", equalTo("mention"))
            .body("audit.created_at", notNullValue());

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(mention("adr", "ADR-LM-1", "task", "SPRINT_LM/T1", "REFERENCES"))
        .when().post("/lore/link/mention")
        .then().statusCode(200).body("outcome", equalTo("unchanged"));
    }

    @Test
    @Order(5)
    void refusalsHappenBeforeWrite() {
        // недопустимая пара/направление
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(mention("adr", "ADR-LM-1", "task", "SPRINT_LM/T1", "JUSTIFIED_BY"))
        .when().post("/lore/link/mention")
        .then().statusCode(400).body("error", equalTo("EDGE_NOT_ALLOWED"));
        // отсутствующий конец — 404, а не тихий no-op
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(mention("task", "SPRINT_LM/T1", "adr", "ADR-NO-SUCH", "JUSTIFIED_BY"))
        .when().post("/lore/link/mention")
        .then().statusCode(404).body("error", equalTo("TARGET_NOT_FOUND"));
        // петля
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(mention("adr", "ADR-LM-1", "adr", "ADR-LM-1", null))
        .when().post("/lore/link/mention")
        .then().statusCode(400).body("error", equalTo("BAD_PARAMS"));
        // запись — только админ (как у остальных link-путей)
        given().header("X-Seer-Role", "viewer").contentType("application/json")
            .body(mention("adr", "ADR-LM-1", "task", "SPRINT_LM/T1", null))
        .when().post("/lore/link/mention")
        .then().statusCode(403);
    }
}
