package studio.seer.heimdall.lore;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

/**
 * requireAdmin(role) rejects a non-admin caller with 403 FORBIDDEN before any
 * SAFE_ID check or DB call runs (LoreResourceBase.requireAdmin, mapped via
 * LoreExceptionMapper). No live database needed — one request per resource
 * class family that uses the shared requireAdmin() guard vs. the
 * hand-rolled 403 in LoreStatusResource.updateStatus (which checks the role
 * directly rather than throwing, so it's covered separately below).
 */
@QuarkusTest
class LoreAdminGuardTest {

    @Test
    void sprintCreateRejectsNonAdminRole() {
        given()
            .header("X-Seer-Role", "viewer")
            .contentType("application/json")
            .body("{\"sprint_id\":\"SPRINT_X\"}")
        .when()
            .post("/lore/sprint/create")
        .then()
            .statusCode(403)
            .body("error", equalTo("FORBIDDEN"));
    }

    @Test
    void adrCreateRejectsMissingRole() {
        given()
            .contentType("application/json")
            .body("{\"adr_id\":\"ADR-X\",\"name\":\"x\"}")
        .when()
            .post("/lore/adr")
        .then()
            .statusCode(403)
            .body("error", equalTo("FORBIDDEN"));
    }

    @Test
    void releaseCreateRejectsNonAdminRole() {
        given()
            .header("X-Seer-Role", "viewer")
            .contentType("application/json")
            .body("{\"release_id\":\"v1.0.0\"}")
        .when()
            .post("/lore/release")
        .then()
            .statusCode(403)
            .body("error", equalTo("FORBIDDEN"));
    }

    @Test
    void componentUpdateRejectsNonAdminRole() {
        given()
            .header("X-Seer-Role", "viewer")
            .contentType("application/json")
            .body("{\"component_id\":\"AIDA\"}")
        .when()
            .post("/lore/component/update")
        .then()
            .statusCode(403)
            .body("error", equalTo("FORBIDDEN"));
    }

    // LoreStatusResource.updateStatus checks the role directly (returns a
    // hand-built Response) rather than throwing LoreExceptions.Forbidden —
    // predates the exception-mapper convention (B3) and was never migrated
    // since its dispatch logic already branches heavily. Same status/code on
    // the wire, different code path — worth its own assertion so a future
    // refactor that touches this method can't silently drop the 403.
    @Test
    void statusUpdateRejectsNonAdminRole() {
        given()
            .header("X-Seer-Role", "viewer")
            .contentType("application/json")
            .body("{\"entity_type\":\"sprint\",\"id\":\"SPRINT_X\",\"status\":\"done\"}")
        .when()
            .post("/lore/status")
        .then()
            .statusCode(403)
            .body("error", equalTo("FORBIDDEN"));
    }
}
