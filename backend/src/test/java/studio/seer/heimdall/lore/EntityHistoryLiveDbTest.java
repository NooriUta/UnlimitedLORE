package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.response.ValidatableResponse;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.notNullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-03: {@code GET /lore/history} отдаёт цепочку SCD2
 * ЛЮБОГО типа из карты HIST_PARENT — проверяется на четырёх (spec, adr, runbook,
 * milestone); до S2-03 у трёх из них истории по id не было вовсе.
 *
 * <p>Положительный контроль встроен: сначала сущность создаётся через REST и
 * доказывается, что строка истории есть, — только потом проверяется автор.
 * Без него «нет автора» неотличимо от «нет строки».
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class EntityHistoryLiveDbTest {

    private static final String SPEC = "SPEC-S203-HIST-PROBE";
    private static final String ADR  = "ADR-S203-HIST-PROBE";
    private static final String RB   = "RB-S203-HIST-PROBE";
    private static final String MS   = "MS-S203-HIST-PROBE";

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    private static ValidatableResponse history(String type, String id) {
        return admin().when().get("/lore/history?type=" + type + "&id=" + id).then();
    }

    @Test
    @Order(1)
    void fourTypesAnswerTheirChainThroughOneEndpoint() {
        admin().body(Map.of("spec_id", SPEC, "title", "S2-03 проба", "content_md", "# x", "status", "proposed"))
            .when().post("/lore/spec").then().statusCode(200);
        admin().body(Map.of("adr_id", ADR, "name", "S2-03 проба", "status", "PROPOSED", "context_md", "тело"))
            .when().post("/lore/adr").then().statusCode(200);
        admin().body(Map.of("runbook_id", RB, "name", "S2-03 проба", "content_md", "шаг"))
            .when().post("/lore/runbook").then().statusCode(200);
        admin().body(Map.of("milestone_id", MS, "label", "S2-03 проба", "goal_md", "цель"))
            .when().post("/lore/milestone").then().statusCode(200);

        for (String[] t : List.of(new String[] {"spec", SPEC}, new String[] {"adr", ADR},
                                  new String[] {"runbook", RB}, new String[] {"milestone", MS})) {
            history(t[0], t[1]).statusCode(200)
                .body("type", equalTo(t[0]))
                .body("rows.size()", greaterThanOrEqualTo(1))
                .body("rows[0].entity_type", equalTo(t[0]))
                .body("rows[0].ref_id", equalTo(t[1]))
                .body("rows[0].valid_from", notNullValue())
                .body("rows[0].author.kind", notNullValue())
                .body("attribution.ok", equalTo(true));
        }
    }

    /**
     * Автор правки — из журнала действий. Без токена ось «unauth», и она
     * обязана остаться «unauth»: приписать вызов человеку, которого не
     * опознали, — то же враньё, что приписать агенту. Журнал пишется
     * асинхронно — ждём точку, а не спим наугад.
     */
    @Test
    @Order(2)
    void revisionAuthorComesFromTheActionJournal() throws Exception {
        String kind = null;
        for (int i = 0; i < 40 && !"unauth".equals(kind); i++) {
            kind = history("spec", SPEC).statusCode(200).extract().path("rows[-1].author.kind");
            if (!"unauth".equals(kind)) Thread.sleep(250);
        }
        assertEquals("unauth", kind);
        history("spec", SPEC).body("rows[-1].author.source", equalTo("journal"));
    }

    @Test
    @Order(3)
    void unknownTypeIs400AndMissingIdIsAnHonestEmptyChain() {
        history("nope", SPEC).statusCode(400).body("error", equalTo("BAD_PARAMS"));
        history("spec", "SPEC-S203-NEVER-EXISTED").statusCode(200).body("rows", hasSize(0));
    }

    private static void sql(String command) throws Exception {
        java.net.http.HttpClient http = LiveDbHttp.CLIENT;
        String body = io.vertx.core.json.JsonObject.of("language", "sql", "command", command).encode();
        java.net.http.HttpRequest req = java.net.http.HttpRequest.newBuilder(
                java.net.URI.create(LoreArcadeDbTestResource.BASE_URL + "/api/v1/command/" + LoreArcadeDbTestResource.TEST_DB))
            .header("Content-Type", "application/json; charset=utf-8")
            .header("Authorization", "Basic " + java.util.Base64.getEncoder().encodeToString(
                ("root:" + LoreArcadeDbTestResource.ROOT_PASSWORD).getBytes(java.nio.charset.StandardCharsets.UTF_8)))
            .POST(java.net.http.HttpRequest.BodyPublishers.ofString(body, java.nio.charset.StandardCharsets.UTF_8)).build();
        http.send(req, java.net.http.HttpResponse.BodyHandlers.ofString());
    }

    @AfterAll
    static void cleanup() throws Exception {
        if (LoreArcadeDbTestResource.BASE_URL == null) return;
        String[][] owned = {
            {"KnowSpecHist", "KnowSpec", "spec_id", SPEC},
            {"KnowADRHist", "KnowADR", "adr_id", ADR},
            {"KnowRunbookHist", "KnowRunbook", "runbook_id", RB},
            {"KnowMilestoneHist", "KnowMilestone", "milestone_id", MS}};
        for (String[] o : owned) {
            sql("DELETE FROM " + o[0] + " WHERE in('HAS_STATE')." + o[2] + " CONTAINS '" + o[3] + "'");
            sql("DELETE FROM " + o[1] + " WHERE " + o[2] + "='" + o[3] + "'");
        }
    }
}
