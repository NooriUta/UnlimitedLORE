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

import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-06 (серверная часть): запись дока ведёт версии SCD2.
 *
 * <p>До правки {@code POST /lore/doc} версий не заводил вовсе (KnowDocHist
 * создавался только ingest-ом, на проде {@code doc_by_id.valid_from} у
 * claude_rules_unlimitedlore — null), а {@code /lore/history?type=doc} не
 * выбирал тело версии — экран «Правила CLAUDE» не мог показать построчный дифф.
 *
 * <p>Правило: запись с изменённым телом закрывает открытую версию и открывает
 * новую; та же запись повторно или правка без тела — версию не множит.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class DocHistoryVersionsLiveDbTest {

    private static final String DOC = "s7b06_doc_hist_probe";

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    private static void write(Map<String, Object> body) {
        admin().body(body).when().post("/lore/doc").then().statusCode(200).body("ok", equalTo(true));
    }

    private static ValidatableResponse history() {
        return admin().when().get("/lore/history?type=doc&id=" + DOC).then().statusCode(200);
    }

    @Test
    @Order(1)
    void firstWriteOpensVersionWithBody() {
        write(Map.of("doc_id", DOC, "title", "проба S7B-06", "kind", "claude-rules", "content_md_ru", "строка 1\n"));
        history().body("rows", hasSize(1))
            .body("rows[0].content_md", equalTo("строка 1\n"))
            .body("rows[0].valid_to", nullValue())
            .body("rows[0].content_hash", notNullValue());
    }

    @Test
    @Order(2)
    void sameBodyAndMetadataOnlyDoNotMultiplyVersions() {
        write(Map.of("doc_id", DOC, "title", "проба S7B-06", "content_md_ru", "строка 1\n"));
        write(Map.of("doc_id", DOC, "title", "проба S7B-06 — новое имя"));
        history().body("rows", hasSize(1));
    }

    @Test
    @Order(3)
    void changedBodyClosesOldVersionAndOpensNew() {
        write(Map.of("doc_id", DOC, "content_md_ru", "строка 1\nстрока 2\n"));
        history().body("rows", hasSize(2))
            .body("rows[0].content_md", equalTo("строка 1\n"))
            .body("rows[0].valid_to", notNullValue())
            .body("rows[1].content_md", equalTo("строка 1\nстрока 2\n"))
            .body("rows[1].valid_to", nullValue());
        // Открытая версия одна: версия без владельца не появилась, у вершины одно открытое состояние.
        given().get("/lore/slice/doc_by_id?id=" + DOC).then().statusCode(200)
            .body("rows[0].valid_from", notNullValue());
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
        sql("DELETE FROM KnowDocHist WHERE in('HAS_STATE').doc_id CONTAINS '" + DOC + "'");
        sql("DELETE FROM KnowDoc WHERE doc_id='" + DOC + "'");
    }
}
