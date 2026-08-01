package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;

/**
 * AN-03 (ADR-LORE-030 §2 срез B): обе стороны ребра TARGETS_MILESTONE.
 * KAOS-чтение (ADR-032 §1): веха = goal, корень слоя = refinement — срез обязан
 * показывать дыры в обоих направлениях декомпозиции И не путать источники ребра:
 * в веху целятся и спринты, и корни; веха, закрытая только спринтом,
 * остаётся «целью без ценности».
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreStrategicCoverageLiveDbTest {

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    @Test
    @Order(1)
    void bothDirectionsOfTheGapAreVisible() {
        // Ценность вне стратегии: корень без вехи.
        post("/lore/feature", "{\"feature_id\":\"FEAT-COV-ORPH\",\"title\":\"Фича без стратегии\"}");
        // Цель без реализации: веха без единого корня.
        post("/lore/milestone", "{\"milestone_id\":\"M-COV-EMPTY\",\"label\":\"Пустая веха\",\"week\":90}");

        given().when().get("/lore/slice/strategic_coverage")
        .then().statusCode(200)
            .body("rows.findAll { it.finding == 'feature_without_milestone' }.ref_id",
                hasItem("FEAT-COV-ORPH"))
            .body("rows.findAll { it.finding == 'milestone_without_features' }.ref_id",
                hasItem("M-COV-EMPTY"));
    }

    @Test
    @Order(2)
    void linkedPairLeavesBothLists() {
        post("/lore/milestone", "{\"milestone_id\":\"M-COV-OK\",\"label\":\"Закрытая веха\",\"week\":91}");
        post("/lore/feature/link", "{\"feature_id\":\"FEAT-COV-ORPH\",\"rel\":\"milestone\","
            + "\"target_id\":\"M-COV-OK\"}");

        given().when().get("/lore/slice/strategic_coverage")
        .then().statusCode(200)
            .body("rows.findAll { it.finding == 'feature_without_milestone' }.ref_id",
                not(hasItem("FEAT-COV-ORPH")))
            .body("rows.findAll { it.finding == 'milestone_without_features' }.ref_id",
                not(hasItem("M-COV-OK")));
    }

    @Test
    @Order(3)
    void milestoneCoveredOnlyBySprintIsStillAGoalWithoutValue() {
        // Спринт целится в веху — но фичи под ней нет: веха обязана ОСТАТЬСЯ
        // в списке. Без фильтра по @class спринтовое ребро прятало бы дыру.
        post("/lore/milestone", "{\"milestone_id\":\"M-COV-SPR\",\"label\":\"Веха со спринтом\",\"week\":92}");
        post("/lore/sprint/create", "{\"sprint_id\":\"SPRINT_COV_TEST\",\"name\":\"Спринт покрытия\"}");
        post("/lore/milestone/sprint", "{\"sprint_id\":\"SPRINT_COV_TEST\",\"milestone_id\":\"M-COV-SPR\"}");

        given().when().get("/lore/slice/strategic_coverage")
        .then().statusCode(200)
            .body("rows.findAll { it.finding == 'milestone_without_features' }.ref_id",
                hasItem("M-COV-SPR"));
    }
}
