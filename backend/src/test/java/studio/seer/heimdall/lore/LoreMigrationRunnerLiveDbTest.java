package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SV-07 (ADR-LORE-023): fresh-путь раннера на изолированной БД. Тест-ресурс
 * поднимает пустой ArcadeDB, bootstrap создаёт схему, раннер (lore.migrate=true)
 * проигрывает шаги и ставит ledger — здесь мы это ДОКАЗЫВАЕМ, а не верим логам.
 * Upgrade-с-данными путь (бэкап обязателен) — на постоянной lore_ci_test, где
 * есть что терять; см. RUNBOOK-LORE-SCHEMA-UPGRADE.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreMigrationRunnerLiveDbTest {

    /** SQL прямо в контейнер: у приложения нет «отдай ledger» эндпоинта, и не надо. */
    private static java.util.List<java.util.Map<String, Object>> sql(String query) throws Exception {
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
        java.util.List<java.util.Map<String, Object>> out = new java.util.ArrayList<>();
        io.vertx.core.json.JsonArray arr = j.getJsonArray("result", new io.vertx.core.json.JsonArray());
        for (int i = 0; i < arr.size(); i++) out.add(arr.getJsonObject(i).getMap());
        return out;
    }

    @Test
    void freshDbEndsAtCodeVersionWithFullLedger() throws Exception {
        var rows = sql("SELECT version, name, checksum FROM LoreSchemaVersion ORDER BY version");
        assertTrue(rows.size() == LoreSchemaMigrations.STEPS.size(),
            "ledger: ожидалось " + LoreSchemaMigrations.STEPS.size() + " шагов, есть " + rows.size());
        for (int i = 0; i < rows.size(); i++) {
            LoreSchemaMigrations.Step s = LoreSchemaMigrations.STEPS.get(i);
            assertTrue(((Number) rows.get(i).get("version")).intValue() == s.version(), "порядок ledger");
            assertTrue(s.checksum().equals(rows.get(i).get("checksum")),
                "checksum V" + s.version() + " в ledger совпадает с кодом");
        }
    }

    @Test
    void migratedSchemaCarriesTheSweepArtifacts() throws Exception {
        // V3: outcome_md объявлен и FULL_TEXT-индексирован (самый заметный долг SV-09).
        var idx = sql("SELECT FROM schema:indexes");
        boolean outcomeFt = idx.stream().anyMatch(m ->
            String.valueOf(m.get("name")).contains("KnowSprintHist") &&
            String.valueOf(m).contains("outcome_md"));
        assertTrue(outcomeFt, "FULL_TEXT по KnowSprintHist.outcome_md обязан существовать после V3");
    }

    @Test
    void contentHashIsStampedOnWrite() {
        // SV-10 сквозняком: запись тела ADR → открытая Hist-строка несёт content_hash.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"adr_id\":\"ADR-SV10-TEST\",\"name\":\"sv10\",\"status\":\"PROPOSED\","
                + "\"context_md\":\"тело для хэша\"}")
        .when().post("/lore/adr")
        .then().statusCode(200).body("ok", equalTo(true));

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/adr_history?id=ADR-SV10-TEST")
        .then().statusCode(200)
            .body("rows.context_md", hasItem("тело для хэша"))
            .body("rows[0].content_hash", equalTo(
                LoreContentHash.of("тело для хэша", null, null)));
    }
}
