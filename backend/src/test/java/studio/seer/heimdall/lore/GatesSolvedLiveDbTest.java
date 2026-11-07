package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_QG_REBUILD/QG-16 + QG-17 на живом движке: новые срезы и метка solved
 * на рёбрах GATES — это синтаксис, который юнит-тест compose() не проверяет
 * (outE()[…].inV(), UPDATE по типу ребра, вложенные фильтры по HAS_STATE).
 *
 * <p>Порядок с положительным контролем: сначала вопрос ОБЯЗАН быть виден как
 * блокер задачи — иначе «после закрытия не виден» ничего бы не доказывало.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class GatesSolvedLiveDbTest {

    private static final String SPRINT = "SPRINT_QG17_PROBE";
    private static final String TASK = SPRINT + "/T1";
    private static final String QUESTION = "Q-QG17-PROBE";

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "superadmin").contentType("application/json");
    }

    private static List<String> gatingOfTask() {
        return given().queryParam("id", TASK).when().get("/lore/slice/gating_questions_of_task")
            .then().statusCode(200).extract().jsonPath().getList("rows.question_id", String.class);
    }

    private static List<String> gatingClosed() {
        return given().when().get("/lore/slice/questions_gating_closed_tasks")
            .then().statusCode(200).extract().jsonPath().getList("rows.question_id", String.class);
    }

    private static void status(String type, String id, String status, String reason) {
        String r = reason == null ? "" : ",\"reason\":\"" + reason + "\"";
        admin().body("{\"entity_type\":\"" + type + "\",\"id\":\"" + id + "\",\"status\":\"" + status + "\"" + r + "}")
            .when().post("/lore/status").then().statusCode(200);
    }

    @Test
    @Order(1)
    void setUp() {
        admin().body("{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"проба QG-17\"}")
            .when().post("/lore/sprint/create").then().statusCode(200);
        admin().body("{\"sprint_id\":\"" + SPRINT + "\",\"task_id\":\"T1\",\"title\":\"проба QG-17\"}")
            .when().post("/lore/task").then().statusCode(200);
        admin().body("{\"question_id\":\"" + QUESTION + "\",\"title\":\"проба QG-17\",\"status\":\"open\"}")
            .when().post("/lore/question").then().statusCode(200);
        admin().body("{\"question_id\":\"" + QUESTION + "\",\"task_uid\":\"" + TASK + "\",\"action\":\"add\"}")
            .when().post("/lore/question/gates").then().statusCode(200);
    }

    @Test
    @Order(2)
    void openTaskIsHeldByTheQuestion() {
        assertTrue(gatingOfTask().contains(QUESTION), "положительный контроль: вопрос держит открытую задачу");
        assertFalse(gatingClosed().contains(QUESTION), "задача открыта — в проверке 5 вопроса нет");
    }

    @Test
    @Order(3)
    void closingTheTaskMarksTheLinkSolvedAndKeepsIt() {
        status("task", TASK, "cancelled", null);
        assertFalse(gatingOfTask().contains(QUESTION), "решённая связь больше не блокер");
        assertTrue(gatingClosed().contains(QUESTION), "проверка 5: открытый вопрос держит закрытую задачу");
    }

    @Test
    @Order(4)
    void reopeningTheTaskUnmarks() {
        status("task", TASK, "active", null);
        assertTrue(gatingOfTask().contains(QUESTION), "задачу открыли снова — связь снова блокер");
    }

    @Test
    @Order(5)
    void blockedSprintCarriesItsReason() {
        status("sprint", SPRINT, "blocked", "проба QG-16: ждёт ответа");
        var rows = given().when().get("/lore/slice/blocked_sprints_reason")
            .then().statusCode(200).extract().jsonPath();
        List<String> ids = rows.getList("rows.sprint_id", String.class);
        assertTrue(ids.contains(SPRINT), "заблокированный сейчас спринт в срезе");
        int i = ids.indexOf(SPRINT);
        assertEquals("проба QG-16: ждёт ответа", rows.getString("rows[" + i + "].block_reason"));
        assertTrue(given().when().get("/lore/slice/blocked_sprints").then().statusCode(200)
            .extract().jsonPath().getList("rows.sprint_id", String.class).contains(SPRINT));

        status("sprint", SPRINT, "active", null);
        assertFalse(given().when().get("/lore/slice/blocked_sprints_reason").then().statusCode(200)
            .extract().jsonPath().getList("rows.sprint_id", String.class).contains(SPRINT),
            "разблокирован — из «заблокированных сейчас» ушёл");
        assertTrue(given().when().get("/lore/slice/blocked_sprints").then().statusCode(200)
            .extract().jsonPath().getList("rows.sprint_id", String.class).contains(SPRINT),
            "«когда-либо заблокированный» — остаётся (смысл аналитики Blocked rate)");
    }
}
