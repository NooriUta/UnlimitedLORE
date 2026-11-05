package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.*;

/**
 * MT-TASK-MV-HISTORY — проба по критерию задачи: перенести задачу в статусе partial
 * и убедиться, что в целевом спринте она partial (раньше становилась PLANNED).
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class TaskMoveKeepsStatusLiveDbTest {

    private io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    @Test
    void movedTaskKeepsPartial() {
        admin().body("{\"sprint_id\":\"SPRINT_MV_SRC\",\"name\":\"src\"}").post("/lore/sprint/create").then().statusCode(200);
        admin().body("{\"sprint_id\":\"SPRINT_MV_DST\",\"name\":\"dst\"}").post("/lore/sprint/create").then().statusCode(200);
        admin().body("{\"sprint_id\":\"SPRINT_MV_SRC\",\"task_id\":\"T-1\",\"title\":\"переезжает\"}").post("/lore/task").then().statusCode(200);
        admin().body("{\"entity_type\":\"task\",\"id\":\"SPRINT_MV_SRC/T-1\",\"status\":\"partial\"}").post("/lore/status").then().statusCode(200);

        String newUid = admin().body("{\"task_uid\":\"SPRINT_MV_SRC/T-1\",\"target_sprint_id\":\"SPRINT_MV_DST\"}")
            .post("/lore/task/move").then().statusCode(200).extract().jsonPath().getString("new_task_uid");
        assertEquals("SPRINT_MV_DST/T-1", newUid);

        List<Map<String, Object>> rows = given().when().get("/lore/slice/tasks_of_sprint?sprint_id=SPRINT_MV_DST")
            .then().statusCode(200).extract().jsonPath().getList("rows");
        Map<String, Object> moved = rows.stream().filter(r -> "T-1".equals(r.get("task_id"))).findFirst().orElseThrow();
        assertTrue(String.valueOf(moved.get("status_raw")).contains("PARTIAL"),
            "перенесённая задача сохранила partial, а не стала PLANNED: " + moved);
    }
}
