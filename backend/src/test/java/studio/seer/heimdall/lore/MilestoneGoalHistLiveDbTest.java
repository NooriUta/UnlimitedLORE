package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
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
import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * MS-GOAL (06.11.2026): у вехи, созданной через POST /lore/milestone, нет строки
 * истории, и цель (goal_md) молча не записывалась — ответ при этом был ok:true.
 * Так потерялись цели 29 вех. Первая запись цели обязана открыть строку истории,
 * а ответ — сообщать факт записи (goal_written), прочитанный из графа.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class MilestoneGoalHistLiveDbTest {

    private static final String MS_NEW   = "MSGOAL_TEST_NEW";
    private static final String MS_LATER = "MSGOAL_TEST_LATER";

    @Inject
    LoreIngestService ingest;

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    private List<Map<String, Object>> openHist(String mid) {
        return ingest.queryPublic(
            "SELECT goal_md FROM (SELECT expand(out('HAS_STATE')) FROM KnowMilestone "
            + "WHERE milestone_id=:mid) WHERE valid_to IS NULL", Map.of("mid", mid));
    }

    @Test
    @Order(1)
    void goalOnCreateOpensHistRow() {
        admin().body(Map.of("milestone_id", MS_NEW, "label", "тест", "goal_md", "цель-1"))
            .when().post("/lore/milestone")
            .then().statusCode(200)
            .body("ok", equalTo(true))
            .body("goal_written", equalTo(true));
        List<Map<String, Object>> h = openHist(MS_NEW);
        assertEquals(1, h.size(), "первая цель должна открыть ровно одну строку истории");
        assertEquals("цель-1", h.get(0).get("goal_md"));
    }

    @Test
    @Order(2)
    void secondGoalUpdatesSameRow() {
        admin().body(Map.of("milestone_id", MS_NEW, "goal_md", "цель-2"))
            .when().post("/lore/milestone")
            .then().statusCode(200).body("goal_written", equalTo(true));
        List<Map<String, Object>> h = openHist(MS_NEW);
        assertEquals(1, h.size(), "повтор не плодит вторую открытую строку");
        assertEquals("цель-2", h.get(0).get("goal_md"));
    }

    @Test
    @Order(3)
    void goalSetLaterOnHistlessMilestoneIsWritten() {
        admin().body(Map.of("milestone_id", MS_LATER, "label", "без цели"))
            .when().post("/lore/milestone")
            .then().statusCode(200);
        assertEquals(0, openHist(MS_LATER).size());
        admin().body(Map.of("milestone_id", MS_LATER, "goal_md", "цель позже"))
            .when().post("/lore/milestone")
            .then().statusCode(200).body("goal_written", equalTo(true));
        List<Map<String, Object>> h = openHist(MS_LATER);
        assertEquals(1, h.size());
        assertEquals("цель позже", h.get(0).get("goal_md"));
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
        // Тестовая БД не поднялась (Quarkus не стартовал) — убирать нечего. Без этой
        // проверки уборка падала «URI with undefined scheme» и в сводке CI становилась
        // третьим «упавшим тестом», заслоняя настоящую причину (CI #828, 06.11.2026).
        if (LoreArcadeDbTestResource.BASE_URL == null) return;
        for (String mid : List.of(MS_NEW, MS_LATER)) {
            // строки истории — через подзапрос по вехе; потом сама веха (рёбра уходят с вершинами)
            sql("DELETE FROM KnowMilestoneHist WHERE in('HAS_STATE').milestone_id CONTAINS '" + mid + "'");
            sql("DELETE FROM KnowMilestone WHERE milestone_id='" + mid + "'");
        }
    }
}
