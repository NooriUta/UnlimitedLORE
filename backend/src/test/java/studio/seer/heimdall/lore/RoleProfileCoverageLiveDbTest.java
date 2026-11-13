package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * SPRINT_LORE_AGENT_OBSERVABILITY/AO-06 — срез role_profile_coverage на живой изолированной БД
 * (testcontainers, только CI). Роль-проба уникальна, чтобы чужие рёбра не мешали счёту:
 * 2 открытых с profile=architect, 1 открытое без профиля, 1 закрытое — не считается.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class RoleProfileCoverageLiveDbTest {

    private static final String ROLE = "ao06probe";

    private static void sql(String query) throws Exception {
        String body = io.vertx.core.json.JsonObject.of("language", "sql", "command", query).encode();
        HttpRequest req = HttpRequest.newBuilder(
                URI.create(LoreArcadeDbTestResource.BASE_URL + "/api/v1/command/" + LoreArcadeDbTestResource.TEST_DB))
            .header("Content-Type", "application/json")
            .header("Authorization", "Basic " + Base64.getEncoder().encodeToString(
                ("root:" + LoreArcadeDbTestResource.ROOT_PASSWORD).getBytes(StandardCharsets.UTF_8)))
            .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        LiveDbHttp.client().send(req, HttpResponse.BodyHandlers.ofString());
    }

    private static void edge(String task, String profile, String validTo) throws Exception {
        sql("CREATE EDGE ROLE_HELD_BY FROM (SELECT FROM KnowTask WHERE task_uid = '" + task + "') "
            + "TO (SELECT FROM KnowActor WHERE actor_id = 'AO06-ACTOR') SET role = '" + ROLE + "'"
            + (profile == null ? "" : ", profile = '" + profile + "'")
            + (validTo == null ? "" : ", valid_to = '" + validTo + "'"));
    }

    @Test
    void openRolesGroupedByProfile_nullIsUncovered_closedNotCounted() throws Exception {
        sql("INSERT INTO KnowActor SET actor_id = 'AO06-ACTOR', kind = 'agent'");
        for (String t : List.of("AO06/T1", "AO06/T2", "AO06/T3", "AO06/T4"))
            sql("INSERT INTO KnowTask SET task_uid = '" + t + "'");
        edge("AO06/T1", "architect", null);
        edge("AO06/T2", "architect", null);
        edge("AO06/T3", null, null);
        edge("AO06/T4", "architect", "2026-11-01T00:00:00Z");

        List<Map<String, Object>> rows = given().header("X-Seer-Role", "admin")
            .when().get("/lore/slice/role_profile_coverage")
            .then().statusCode(200).extract().jsonPath().getList("rows");
        long withProfile = 0, without = 0;
        for (Map<String, Object> r : rows) {
            if (!ROLE.equals(r.get("role"))) continue;
            long n = ((Number) r.get("n")).longValue();
            if ("architect".equals(r.get("profile"))) withProfile += n;
            else if (r.get("profile") == null) without += n;
        }
        assertEquals(2, withProfile, "открытые с профилем: закрытое не должно считаться — " + rows);
        assertEquals(1, without, "открытое без профиля — непокрытое — " + rows);
    }

    @AfterAll
    static void cleanup() throws Exception {
        sql("DELETE FROM ROLE_HELD_BY WHERE role = '" + ROLE + "'");
        sql("DELETE FROM KnowTask WHERE task_uid LIKE 'AO06/%'");
        sql("DELETE FROM KnowActor WHERE actor_id = 'AO06-ACTOR'");
    }
}
