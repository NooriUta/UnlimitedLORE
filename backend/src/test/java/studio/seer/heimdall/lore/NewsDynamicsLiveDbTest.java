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
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;

/**
 * SPRINT_UXR_S7A_NEWS/S7A-11 — GET /lore/news/v2/dynamics на настоящей схеме: SQL сборщика
 * ({@link LoreNewsDynamicsCollector}) исполняется движком без ошибок источников, и задача,
 * заведённая и закрытая сейчас (planned → review → done), попадает в текущую неделю и в
 * «заведено», и в «закрыто». Фильтр по проекту теста отсекает чужие записи общей базы.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class NewsDynamicsLiveDbTest {

    private static final String PROJECT = "dynamics-probe";
    private static final String SPRINT = "SPRINT_DYNAMICS_PROBE";
    private static final String TASK_UID = SPRINT + "/T-DYN";

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    @Test
    @Order(1)
    void setUp() {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"slug\":\"" + PROJECT + "\"}")
        .when().post("/lore/project").then().statusCode(200);
        admin().body("{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"Спринт динамики\"}")
            .when().post("/lore/sprint/create").then().statusCode(200);
        admin().body("{\"sprint_id\":\"" + SPRINT + "\",\"git_project\":\"" + PROJECT + "\"}")
            .when().post("/lore/sprint/project").then().statusCode(200);
        admin().body("{\"sprint_id\":\"" + SPRINT + "\",\"task_id\":\"T-DYN\",\"title\":\"Задача динамики\"}")
            .when().post("/lore/task").then().statusCode(200);
        // WK-05: done — только из review и с доказательством.
        admin().body("{\"entity_type\":\"task\",\"id\":\"" + TASK_UID + "\",\"status\":\"review\"}")
            .when().post("/lore/status").then().statusCode(200);
        admin().body("{\"entity_type\":\"task\",\"id\":\"" + TASK_UID + "\",\"status\":\"done\",\"evidence_type\":\"pr\",\"evidence_ref\":\"PR #1\"}")
            .when().post("/lore/status").then().statusCode(200);
    }

    @Test
    @Order(2)
    void weekSeries_sqlRunsAndTaskLandsInCurrentWeek() {
        given().when().get("/lore/news/v2/dynamics?period=week&project=" + PROJECT)
            .then().statusCode(200)
            .body("meta.errors", hasSize(0))
            .body("meta.state", equalTo("ok"))
            .body("meta.tz", equalTo("UTC"))
            .body("buckets", hasSize(12))
            .body("metrics.find { it.id == 'tasks_created' }.value", equalTo(1))
            .body("metrics.find { it.id == 'tasks_closed' }.value", equalTo(1))
            .body("metrics.find { it.id == 'sprints_closed' }.state", equalTo("ok"))
            .body("metrics.find { it.id == 'releases' }.state", equalTo("ok"))
            .body("metrics.find { it.id == 'accepted' }.state", equalTo("ok"));
    }

    @Test
    @Order(3)
    void monthSeries_andUnknownPeriodIs400() {
        given().when().get("/lore/news/v2/dynamics?period=month&project=" + PROJECT)
            .then().statusCode(200)
            .body("buckets", hasSize(6))
            .body("meta.compare", equalTo("month_over_month"));
        given().when().get("/lore/news/v2/dynamics?period=day").then().statusCode(400);
    }

    @Test
    @Order(4)
    void typeFilterOfOtherType_metricIsFilteredOutNotZero() {
        given().when().get("/lore/news/v2/dynamics?period=week&type=release&project=" + PROJECT)
            .then().statusCode(200)
            .body("metrics.find { it.id == 'tasks_closed' }.state", equalTo("filtered_out"))
            .body("metrics.find { it.id == 'tasks_closed' }.value", nullValue());
    }
}
