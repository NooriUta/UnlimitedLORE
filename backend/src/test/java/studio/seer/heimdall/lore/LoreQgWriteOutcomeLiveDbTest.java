package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Исходы цепочки гейт → прогон → рекомендация → задача (ADR-LORE-043, DBR-17).
 *
 * <p>Каждое звено привязывалось к родителю CREATE EDGE по выборке, и пустая
 * выборка давала {@code ok:true} с записью-сиротой: прогон без гейта,
 * рекомендация без прогона, задача без спринта. Сирота не видна ни в одном
 * срезе, то есть запись выглядела сделанной и пропадала. Теперь отсутствующий
 * родитель — отказ ДО записи, а отказ не меняет состояние.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreQgWriteOutcomeLiveDbTest {

    private static final String QG     = "QG_OUT_PROBE";
    private static final String JOB    = "QG_OUT_PROBE_JOB";
    private static final String REC    = "QG_OUT_PROBE_REC";
    private static final String SPRINT = "SPRINT_QG_OUT_PROBE";

    @Inject
    LoreIngestService ingest;

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    private long count(String sql, Map<String, Object> p) {
        List<Map<String, Object>> rows = ingest.queryPublic(sql, p);
        return rows.isEmpty() ? 0 : ((Number) rows.get(0).getOrDefault("n", 0)).longValue();
    }

    @Test
    @Order(1)
    void jobForMissingGateIsRefusedAndNotWritten() {
        admin().body(Map.of("job_id", "QG_OUT_ORPHAN_JOB", "qg_id", "QG_НЕТ_ТАКОГО"))
            .when().post("/lore/qg/job-task")
            .then().statusCode(404)
            .body("error", equalTo("TARGET_NOT_FOUND"))
            .body("detail", containsString("QG_НЕТ_ТАКОГО"));
        assertEquals(0, count("SELECT count(*) AS n FROM QGJobTask WHERE job_id=:j", Map.of("j", "QG_OUT_ORPHAN_JOB")));
    }

    @Test
    @Order(2)
    void jobCreatedThenUpdated() {
        admin().body(Map.of("qg_id", QG, "name", "проба исходов QG"))
            .when().post("/lore/quality-gate").then().statusCode(200);
        admin().body(Map.of("job_id", JOB, "qg_id", QG))
            .when().post("/lore/qg/job-task")
            .then().statusCode(200).body("outcome", equalTo("created"));
        admin().body(Map.of("job_id", JOB, "qg_id", QG, "status", "open"))
            .when().post("/lore/qg/job-task")
            .then().statusCode(200).body("outcome", equalTo("updated"));
    }

    @Test
    @Order(3)
    void recForMissingJobIsRefusedAndNotWritten() {
        admin().body(Map.of("rec_id", "QG_OUT_ORPHAN_REC", "job_id", "QG_НЕТ_ПРОГОНА", "title", "x"))
            .when().post("/lore/qg/recommendation")
            .then().statusCode(404)
            .body("error", equalTo("TARGET_NOT_FOUND"));
        assertEquals(0, count("SELECT count(*) AS n FROM QGRecommendation WHERE rec_id=:r", Map.of("r", "QG_OUT_ORPHAN_REC")));
    }

    @Test
    @Order(4)
    void recCreated() {
        admin().body(Map.of("rec_id", REC, "job_id", JOB, "title", "починить пробу"))
            .when().post("/lore/qg/recommendation")
            .then().statusCode(200).body("outcome", equalTo("created"));
    }

    @Test
    @Order(5)
    void promoteIntoMissingSprintIsRefused() {
        admin().body(Map.of("rec_id", REC, "sprint_id", "SPRINT_НЕТ_ТАКОГО"))
            .when().post("/lore/qg/promote")
            .then().statusCode(404)
            .body("error", equalTo("TARGET_NOT_FOUND"));
        assertEquals(0, count("SELECT count(*) AS n FROM PROMOTED_TO WHERE @out.rec_id=:r", Map.of("r", REC)));
    }

    @Test
    @Order(6)
    void promoteOfMissingRecIsRefused() {
        admin().body(Map.of("rec_id", "QG_НЕТ_РЕКОМЕНДАЦИИ", "sprint_id", SPRINT))
            .when().post("/lore/qg/promote")
            .then().statusCode(404)
            .body("error", equalTo("TARGET_NOT_FOUND"));
    }

    @Test
    @Order(7)
    void promoteCreatesThenRepeatReturnsSameTask() {
        admin().body(Map.of("sprint_id", SPRINT, "name", "проба промоута"))
            .when().post("/lore/sprint/create").then().statusCode(200);
        String uid = admin().body(Map.of("rec_id", REC, "sprint_id", SPRINT))
            .when().post("/lore/qg/promote")
            .then().statusCode(200).body("outcome", equalTo("created"))
            .extract().path("task_uid");
        // Повтор не заводит вторую задачу под ту же рекомендацию.
        admin().body(Map.of("rec_id", REC, "sprint_id", SPRINT))
            .when().post("/lore/qg/promote")
            .then().statusCode(200)
            .body("outcome", equalTo("unchanged"))
            .body("task_uid", equalTo(uid));
        assertEquals(1, count("SELECT count(*) AS n FROM PROMOTED_TO WHERE @out.rec_id=:r", Map.of("r", REC)));
    }
}
