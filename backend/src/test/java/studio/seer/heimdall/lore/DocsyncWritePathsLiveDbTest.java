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
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.notNullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * SPRINT_LORE_MCP_DOCSYNC_GAPS — пути записи, найденные сверкой DWL 24.10.2026.
 *
 * <p>Каждая проверка читает результат обратно (срезом или из БД), а не судит
 * по ok:true: все три дефекта выглядели успешными записями.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class DocsyncWritePathsLiveDbTest {

    private static final String SPEC = "SPEC-DS4-PROBE";
    private static final String DOC = "ds3_probe_doc";
    private static final String DOC_LEGACY = "ds3_probe_legacy";
    private static final String PROJECT = "ds/probe-project";

    @Inject
    LoreSchemaMigrationRunner runner;

    private static RequestSpecification admin() {
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

    /** DS-4: статус пишется на открытую ревизию и читается обоими срезами. */
    @Test
    void specStatusRoundTrips() {
        admin().body(Map.of("spec_id", SPEC, "title", "проба DS-4", "content_md", "# x", "status", "proposed"))
            .post("/lore/spec").then().statusCode(200);

        given().get("/lore/slice/spec_by_id?id=" + SPEC).then().statusCode(200)
            .body("rows[0].status", equalTo("proposed"));
        given().get("/lore/slice/specs").then().statusCode(200)
            .body("rows.findAll { it.spec_id == '" + SPEC + "' }.status", hasItem("proposed"));

        // Частичная правка без status статус не стирает.
        admin().body(Map.of("spec_id", SPEC, "title", "проба DS-4", "summary", "аннотация"))
            .post("/lore/spec").then().statusCode(200);
        given().get("/lore/slice/specs").then().statusCode(200)
            .body("rows.findAll { it.spec_id == '" + SPEC + "' }.status", hasItem("proposed"))
            .body("rows.findAll { it.spec_id == '" + SPEC + "' }.summary", hasItem("аннотация"));
    }

    /** DS-4: свободный текст вместо кода словаря — отказ с перечнем допустимых. */
    @Test
    void specStatusOutsideDictionaryIsRejected() {
        admin().body(Map.of("spec_id", SPEC, "title", "проба DS-4", "status", "Предложение"))
            .post("/lore/spec").then().statusCode(400)
            .body(containsString("proposed"));
    }

    /** DS-3: хеш и длина приходят в списке docs — совпадают с посчитанными у себя. */
    @Test
    void docDigestIsListedAndMatchesBody() {
        String body = "# Рецепты\n\nтекст";
        admin().body(Map.of("doc_id", DOC, "title", "проба DS-3", "content_md_ru", body))
            .post("/lore/doc").then().statusCode(200);

        given().get("/lore/slice/docs").then().statusCode(200)
            .body("rows.findAll { it.doc_id == '" + DOC + "' }.content_md_ru_sha256",
                hasItem(LoreDocBodyDigest.sha256(body)))
            .body("rows.findAll { it.doc_id == '" + DOC + "' }.content_md_ru_bytes",
                hasItem(LoreDocBodyDigest.bytes(body)));
    }

    /** DS-3: V49 добирает доки, записанные до появления хеша. */
    @Test
    void backfillDigestsLegacyDocs() throws Exception {
        sql("UPDATE KnowDoc SET doc_id='" + DOC_LEGACY + "', title='legacy', content_md_en='legacy body' "
            + "UPSERT WHERE doc_id='" + DOC_LEGACY + "'");
        assertEquals(1, sql("SELECT FROM KnowDoc WHERE doc_id='" + DOC_LEGACY
            + "' AND content_md_en_sha256 IS NULL").size(), "положительный контроль: хеша нет до бэкфилла");

        runner.backfillDocBodyDigest();

        var rows = sql("SELECT content_md_en_sha256 AS h, content_md_en_bytes AS n FROM KnowDoc WHERE doc_id='"
            + DOC_LEGACY + "'");
        assertEquals(LoreDocBodyDigest.sha256("legacy body"), rows.get(0).get("h"));
        assertEquals(11, ((Number) rows.get(0).get("n")).intValue());
    }

    /**
     * DS-1: создатель неопознан (auth в тесте выключен) — роль выдать некому,
     * и ответ говорит об этом прямо, а не отдаёт голый ok:true.
     */
    @Test
    void projectWithoutGranteeWarnsInsteadOfStayingSilent() {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body(Map.of("slug", PROJECT, "name", "проба DS-1"))
            .post("/lore/project").then().statusCode(200)
            .body("ok", equalTo(true))
            .body("roles_granted", empty())
            .body("roles_warning", notNullValue());
    }

    /** DS-2/DS-3: фильтр project принят обоими срезами (был 400 «unknown param»). */
    @Test
    void projectFilterAccepted() {
        given().get("/lore/slice/specs?project=" + PROJECT).then().statusCode(200);
        given().get("/lore/slice/docs?project=" + PROJECT).then().statusCode(200);
    }
}
