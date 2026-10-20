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
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SE-05, тот же класс у фаз: задача в ДВУХ фазах обязана быть видна в каждой.
 *
 * <p>Модель это допускает: {@code task/phase} с {@code add} не снимает прежнюю
 * фазу, а {@code remove} без фазы описан как «отцепить от ВСЕХ». Срез
 * {@code tasks_of_phase} фильтровал {@code out('IN_PHASE').phase_uid[0] = :phase_uid}
 * — задача находилась только в той фазе, что окажется первой.
 *
 * <p>На двух фазах, потому что на одной {@code [0] =} и {@code CONTAINS}
 * неразличимы. Контроль — задача только в фазе B не протекает в фазу A.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class TaskInTwoPhasesLiveDbTest {

    private static final String SPRINT = "SPRINT_SE05_PHASES";
    private static final String T_BOTH = SPRINT + "/PH-BOTH";
    private static final String T_ONLY_B = SPRINT + "/PH-ONLY-B";
    private static String phaseA;
    private static String phaseB;

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "superadmin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    private static String createPhase(String key, int order) {
        return given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"sprint_id\":\"" + SPRINT + "\",\"phase_key\":\"" + key + "\",\"name\":\"Фаза "
                + key + "\",\"order_index\":" + order + "}")
            .when().post("/lore/phase")
            .then().statusCode(200)
            .extract().jsonPath().getString("phase_uid");
    }

    private static List<String> tasksOf(String phaseUid) {
        return given().contentType("application/json")
            .queryParam("phase_uid", phaseUid)
            .when().get("/lore/slice/tasks_of_phase")
            .then().statusCode(200)
            .extract().jsonPath().getList("rows.task_uid", String.class);
    }

    @Test
    @Order(1)
    void setUp() {
        post("/lore/sprint/create", "{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"SE-05 фазы\"}");
        phaseA = createPhase("A", 1);
        phaseB = createPhase("B", 2);
        assertTrue(phaseA != null && phaseB != null && !phaseA.equals(phaseB), "две разные фазы");
        post("/lore/task", "{\"sprint_id\":\"" + SPRINT + "\",\"task_id\":\"PH-BOTH\",\"title\":\"В двух фазах\"}");
        post("/lore/task", "{\"sprint_id\":\"" + SPRINT + "\",\"task_id\":\"PH-ONLY-B\",\"title\":\"Только в B\"}");
        post("/lore/task/phase", "{\"task_uid\":\"" + T_BOTH + "\",\"phase_uid\":\"" + phaseA + "\",\"action\":\"add\"}");
        post("/lore/task/phase", "{\"task_uid\":\"" + T_BOTH + "\",\"phase_uid\":\"" + phaseB + "\",\"action\":\"add\"}");
        post("/lore/task/phase", "{\"task_uid\":\"" + T_ONLY_B + "\",\"phase_uid\":\"" + phaseB + "\",\"action\":\"add\"}");
    }

    @Test
    @Order(2)
    void taskInTwoPhasesIsListedInBoth() {
        List<String> inA = tasksOf(phaseA);
        List<String> inB = tasksOf(phaseB);
        assertTrue(inA.contains(T_BOTH) && inB.contains(T_BOTH),
            "задача в двух фазах обязана быть видна в КАЖДОЙ; в A=" + inA + ", в B=" + inB);
    }

    @Test
    @Order(3)
    void singlePhaseTaskDoesNotLeak() {
        assertTrue(tasksOf(phaseB).contains(T_ONLY_B), "своя задача в фазе B обязана быть");
        assertFalse(tasksOf(phaseA).contains(T_ONLY_B), "задача только из B просочилась в фазу A");
    }
}
