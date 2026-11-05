package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.junit.jupiter.api.Assertions.*;

/**
 * MT-SPRINT-DONE-GUARD — критерий готовности владельца: ПРОБОЙ, а не чтением кода.
 * Завести задачу в заведомо закрытый спринт → отказ; слайс по спринту — новой задачи нет.
 * То же для task_mv; status_set задачи в закрытом спринте НЕ запрещается (иначе
 * унаследованное нечем чинить).
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class SprintDoneGuardLiveDbTest {

    static final String CLOSED = "SPRINT_GUARD_CLOSED";
    static final String OPEN = "SPRINT_GUARD_OPEN";

    private io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    private List<Object> taskIds(String sprint) {
        return given().when().get("/lore/slice/tasks_of_sprint?sprint_id=" + sprint)
            .then().statusCode(200).extract().jsonPath().getList("rows.task_id");
    }

    @Test
    void closedSprintRefusesNewAndMovedTasks() {
        admin().body("{\"sprint_id\":\"" + CLOSED + "\",\"name\":\"guard closed\"}").post("/lore/sprint/create").then().statusCode(200);
        admin().body("{\"sprint_id\":\"" + OPEN + "\",\"name\":\"guard open\"}").post("/lore/sprint/create").then().statusCode(200);
        // унаследованная задача, заведённая ДО закрытия
        admin().body("{\"sprint_id\":\"" + CLOSED + "\",\"task_id\":\"OLD-1\",\"title\":\"унаследованная\"}")
            .post("/lore/task").then().statusCode(200);
        admin().body("{\"entity_type\":\"sprint\",\"id\":\"" + CLOSED + "\",\"status\":\"done\"}")
            .post("/lore/status").then().statusCode(200);

        // положительный контроль: в открытый спринт заводится
        admin().body("{\"sprint_id\":\"" + OPEN + "\",\"task_id\":\"OK-1\",\"title\":\"в открытый\"}")
            .post("/lore/task").then().statusCode(200);
        admin().body("{\"sprint_id\":\"" + OPEN + "\",\"task_id\":\"MV-1\",\"title\":\"на перенос\"}")
            .post("/lore/task").then().statusCode(200);

        // проба 1: task_new в закрытый — отказ, и задачи там нет
        admin().body("{\"sprint_id\":\"" + CLOSED + "\",\"task_id\":\"NEW-1\",\"title\":\"не должна лечь\"}")
            .post("/lore/task").then().statusCode(400).body(containsString(CLOSED));
        assertFalse(taskIds(CLOSED).contains("NEW-1"), "задача не легла в закрытый спринт: " + taskIds(CLOSED));

        // проба 2: task_mv в закрытый — отказ, задача осталась на месте
        admin().body("{\"task_uid\":\"" + OPEN + "/MV-1\",\"target_sprint_id\":\"" + CLOSED + "\"}")
            .post("/lore/task/move").then().statusCode(400).body(containsString(CLOSED));
        assertFalse(taskIds(CLOSED).contains("MV-1"), "перенос не состоялся: " + taskIds(CLOSED));
        assertTrue(taskIds(OPEN).contains("MV-1"), "задача осталась в открытом: " + taskIds(OPEN));

        // status_set унаследованной задачи в закрытом спринте — РАЗРЕШЁН
        admin().body("{\"entity_type\":\"task\",\"id\":\"" + CLOSED + "/OLD-1\",\"status\":\"cancelled\"}")
            .post("/lore/status").then().statusCode(200);
    }
}
