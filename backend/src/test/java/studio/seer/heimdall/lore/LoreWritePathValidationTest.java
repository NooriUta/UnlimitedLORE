package studio.seer.heimdall.lore;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

/**
 * Write-path input validation (C5, SPRINT_LORE_PROD_HARDENING) — every
 * write endpoint rejects an illegal-character id via SAFE_ID BEFORE it ever
 * reaches ArcadeDB. These assertions hold with no live database: badParams()
 * short-circuits ahead of any writeClient/client call, so the response is
 * fully determined by the REST layer alone. Also serves as a routing smoke
 * test for the B2 domain split — one request per newly-extracted resource
 * class, proving each is registered under /lore and reachable.
 *
 * requireAdmin(role) is checked before SAFE_ID in every handler, so these
 * requests must carry X-Seer-Role: admin to actually reach the SAFE_ID check
 * (see LoreAdminGuardTest for the requireAdmin contract itself).
 */
@QuarkusTest
class LoreWritePathValidationTest {

    private static final String ILLEGAL_ID = "bad id with spaces & stuff!";

    @Test
    void sprintCreateRejectsIllegalId() {
        given()
            .header("X-Seer-Role", "admin")
            .contentType("application/json")
            .body("{\"sprint_id\":\"" + ILLEGAL_ID + "\"}")
        .when()
            .post("/lore/sprint/create")
        .then()
            .statusCode(400)
            .body("error", equalTo("BAD_PARAMS"));
    }

    @Test
    void taskCreateRejectsIllegalSprintId() {
        given()
            .header("X-Seer-Role", "admin")
            .contentType("application/json")
            .body("{\"sprint_id\":\"" + ILLEGAL_ID + "\",\"task_id\":\"T01\",\"title\":\"x\"}")
        .when()
            .post("/lore/task")
        .then()
            .statusCode(400)
            .body("error", equalTo("BAD_PARAMS"));
    }

    @Test
    void phaseCreateRejectsIllegalPhaseKey() {
        given()
            .header("X-Seer-Role", "admin")
            .contentType("application/json")
            .body("{\"sprint_id\":\"SPRINT_X\",\"phase_key\":\"bad key!\"}")
        .when()
            .post("/lore/phase")
        .then()
            .statusCode(400)
            .body("error", equalTo("BAD_PARAMS"));
    }

    @Test
    void adrCreateRejectsIllegalId() {
        given()
            .header("X-Seer-Role", "admin")
            .contentType("application/json")
            .body("{\"adr_id\":\"" + ILLEGAL_ID + "\",\"name\":\"x\"}")
        .when()
            .post("/lore/adr")
        .then()
            .statusCode(400)
            .body("error", equalTo("BAD_PARAMS"));
    }

    @Test
    void specUpsertRejectsIllegalId() {
        given()
            .header("X-Seer-Role", "admin")
            .contentType("application/json")
            .body("{\"spec_id\":\"" + ILLEGAL_ID + "\",\"title\":\"x\"}")
        .when()
            .post("/lore/spec")
        .then()
            .statusCode(400)
            .body("error", equalTo("BAD_PARAMS"));
    }

    @Test
    void componentCreateRejectsIllegalId() {
        given()
            .header("X-Seer-Role", "admin")
            .contentType("application/json")
            .body("{\"component_id\":\"" + ILLEGAL_ID + "\"}")
        .when()
            .post("/lore/component/create")
        .then()
            .statusCode(400)
            .body("error", equalTo("BAD_PARAMS"));
    }

    @Test
    void runbookUpsertRejectsIllegalId() {
        given()
            .header("X-Seer-Role", "admin")
            .contentType("application/json")
            .body("{\"runbook_id\":\"" + ILLEGAL_ID + "\",\"name\":\"x\"}")
        .when()
            .post("/lore/runbook")
        .then()
            .statusCode(400)
            .body("error", equalTo("BAD_PARAMS"));
    }

    @Test
    void releaseCreateRejectsIllegalId() {
        given()
            .header("X-Seer-Role", "admin")
            .contentType("application/json")
            .body("{\"release_id\":\"" + ILLEGAL_ID + "\"}")
        .when()
            .post("/lore/release")
        .then()
            .statusCode(400)
            .body("error", equalTo("BAD_PARAMS"));
    }

    @Test
    void qualityGateUpsertRejectsIllegalId() {
        given()
            .header("X-Seer-Role", "admin")
            .contentType("application/json")
            .body("{\"qg_id\":\"" + ILLEGAL_ID + "\",\"name\":\"x\"}")
        .when()
            .post("/lore/quality-gate")
        .then()
            .statusCode(400)
            .body("error", equalTo("BAD_PARAMS"));
    }

    @Test
    void statusUpdateRejectsIllegalId() {
        given()
            .header("X-Seer-Role", "admin")
            .contentType("application/json")
            .body("{\"entity_type\":\"sprint\",\"id\":\"" + ILLEGAL_ID + "\",\"status\":\"done\"}")
        .when()
            .post("/lore/status")
        .then()
            .statusCode(400)
            .body("error", equalTo("BAD_PARAMS"));
    }

    @Test
    void sprintDepRejectsIllegalSprintIds() {
        given()
            .header("X-Seer-Role", "admin")
            .contentType("application/json")
            .body("{\"from_sprint\":\"" + ILLEGAL_ID + "\",\"to_sprint\":\"SPRINT_Y\"}")
        .when()
            .post("/lore/sprint/dep")
        .then()
            .statusCode(400)
            .body("error", equalTo("BAD_PARAMS"));
    }

    @Test
    void sprintPlanRejectsIllegalId() {
        given()
            .header("X-Seer-Role", "admin")
            .contentType("application/json")
            .body("{\"sprint_id\":\"" + ILLEGAL_ID + "\",\"priority\":\"P0\"}")
        .when()
            .post("/lore/sprint/plan")
        .then()
            .statusCode(400)
            .body("error", equalTo("BAD_PARAMS"));
    }
}
