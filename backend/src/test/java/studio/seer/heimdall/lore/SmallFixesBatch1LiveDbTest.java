package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;
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
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Мелкие исправления 27.10.2026: DS-7, DS-9, DBR-17 (пилот Question/Runbook), LH-44 п.3.
 * Каждая проверка читает результат обратно, а не судит по ok:true.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class SmallFixesBatch1LiveDbTest {

    @Inject
    LoreSchemaMigrationRunner runner;

    private static RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    private static List<Map<String, Object>> sql(String query) throws Exception {
        HttpClient http = LiveDbHttp.client();
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

    /** DS-7: priority из sprint_new виден в срезе sprints (лежит на SCD2-строке). */
    @Test
    void sprintNewPriorityReachesTheSlice() {
        admin().body(Map.of("sprint_id", "SPRINT_DS7_PROBE", "name", "проба DS-7", "priority", "high"))
            .post("/lore/sprint/create").then().statusCode(200);
        given().get("/lore/slice/sprints").then().statusCode(200)
            .body("rows.findAll { it.sprint_id == 'SPRINT_DS7_PROBE' }.priority", hasItem("high"));
    }

    /** DS-9: фильтр project у releases принят (был 400). */
    @Test
    void releasesProjectFilterAccepted() {
        given().get("/lore/slice/releases?project=ds/none").then().statusCode(200);
    }

    /** DBR-17: ссылка на несуществующий проект — noop с причиной, а не ok:true. */
    @Test
    void questionProjectToMissingTargetIsNoop() {
        admin().body(Map.of("question_id", "Q-DBR17-PROBE", "title", "проба DBR-17")).post("/lore/question")
            .then().statusCode(200);
        admin().body(Map.of("question_id", "Q-DBR17-PROBE", "project", "nobody/none", "action", "add"))
            .post("/lore/question/project").then().statusCode(200)
            .body("outcome", equalTo("noop"));
    }

    /** DBR-17: ранбук → несуществующий ADR — noop; снятие несуществующей связи — unchanged. */
    @Test
    void runbookAdrMissingTargetIsNoopAndUnlinkIsUnchanged() {
        admin().body(Map.of("runbook_id", "RB-DBR17-PROBE", "name", "проба")).post("/lore/runbook")
            .then().statusCode(200);
        admin().body(Map.of("runbook_id", "RB-DBR17-PROBE", "adr_id", "ADR-NOT-THERE", "action", "add"))
            .post("/lore/runbook/adr").then().statusCode(200).body("outcome", equalTo("noop"));
        admin().body(Map.of("runbook_id", "RB-DBR17-PROBE", "adr_id", "ADR-NOT-THERE", "action", "remove"))
            .post("/lore/runbook/adr").then().statusCode(200).body("outcome", equalTo("unchanged"));
    }

    /** LH-44 п.3: V51 снимает HAS_STATUS у KnowADRHist и только их. */
    @Test
    void v51DropsLegacyAdrHasStatusOnly() throws Exception {
        sql("CREATE VERTEX KnowADRHist SET state_uid='lh44-probe-hist'");
        sql("UPDATE StatusAdr SET status_id='LH44_PROBE' UPSERT WHERE status_id='LH44_PROBE'");
        sql("CREATE EDGE HAS_STATUS FROM (SELECT FROM KnowADRHist WHERE state_uid='lh44-probe-hist') "
            + "TO (SELECT FROM StatusAdr WHERE status_id='LH44_PROBE')");
        assertEquals(1, sql("SELECT FROM (SELECT expand(outE('HAS_STATUS')) FROM KnowADRHist "
            + "WHERE state_uid='lh44-probe-hist')").size(), "положительный контроль: ребро посеяно");

        runner.dropLegacyAdrHasStatus();

        assertEquals(0, sql("SELECT FROM (SELECT expand(outE('HAS_STATUS')) FROM KnowADRHist)").size(),
            "легаси-рёбра у KnowADRHist остались");
        assertEquals(1, sql("SELECT FROM StatusAdr WHERE status_id='LH44_PROBE'").size(),
            "вершина-статус не должна сниматься — только ребро");
    }
}
