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

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * MIG-31: на свежей БД сидер компонентов гонялся с DDL-штормом раннера миграций —
 * все UPSERT'ы молча падали 500 в warn-catch, и после boot корпус жил без единого
 * LoreComponent. Отказы были WARN'ами, теста «компоненты есть после boot» не было,
 * а на непустом проде сидер успевал всегда — класс «работает у всех, кроме чистой БД».
 *
 * Здесь мы это ДОКАЗЫВАЕМ: тест-ресурс пересоздаёт БД, bootstrap+migrate+seed
 * проходят штатной цепочкой готовности, и счёт в БД обязан совпасть с каноном.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreComponentSeederLiveDbTest {

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
    void freshDbBootSeedsEveryCanonicalComponent() throws Exception {
        var rows = sql("SELECT count(*) AS n FROM LoreComponent");
        long n = ((Number) rows.get(0).get("n")).longValue();
        assertEquals(LoreComponentSeeder.COMPONENTS.size(), n,
            "после boot на чистой БД сидер обязан довезти ВСЕ канонические компоненты, "
                + "а не молча проиграть DDL-шторму (MIG-31)");
    }
}
