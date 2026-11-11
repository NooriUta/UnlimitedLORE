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
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.notNullValue;

/**
 * SPRINT_UXR_S10_SEIDR_KIT_2/MD-AUTOLINK · spec:SPEC-LORE-MD-INLINE-REF §7, критерии сервера:
 * ADR с {@code [[component:X]]} в теле связан с компонентом; повтор — {@code unchanged};
 * битая и неоднозначная ссылка — в {@code skipped} с причиной; бэкфилл — только сухой отчёт.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreMentionAutoLinkLiveDbTest {

    private static final String BODY =
        "{\"adr_id\":\"ADR-MA-1\",\"name\":\"автосвязь\",\"context_md\":"
        + "\"Про [[component:COMP-MA]], битая [[component:COMP-MA-NONE]], `[[component:COMP-MA-CODE]]` и [[pain:P-MA]]\"}";

    @Test
    @Order(1)
    void setUp() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"component_id\":\"COMP-MA\",\"full_name\":\"автосвязь\"}")
            .when().post("/lore/component/create").then().statusCode(200);
    }

    @Test
    @Order(2)
    void adrMentioningComponentGetsEdgeOnBodyWrite() {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(BODY)
        .when().post("/lore/adr")
        .then().statusCode(200)
            .body("ok", equalTo(true))
            .body("mentions.added", hasSize(1))
            .body("mentions.added[0].edge_type", equalTo("BELONGS_TO"))
            .body("mentions.added[0].to_id", equalTo("COMP-MA"))
            .body("mentions.added[0].origin", equalTo("mention-auto"))
            .body("mentions.skipped.reason", hasItem("not_found"))
            .body("mentions.skipped.reason", hasItem("references_only"))
            .body("mentions.skipped.id", org.hamcrest.Matchers.not(hasItem("COMP-MA-CODE")));
    }

    @Test
    @Order(3)
    void repeatIsUnchangedAndEdgeIsSingle() {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(BODY)
        .when().post("/lore/adr")
        .then().statusCode(200)
            .body("mentions.added", hasSize(0))
            .body("mentions.unchanged", hasSize(1))
            .body("mentions.unchanged[0].to_id", equalTo("COMP-MA"));
    }

    @Test
    @Order(4)
    void backfillIsDryRunOnly() {
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/link/mentions/backfill?dry_run=true&types=adr")
        .then().statusCode(200)
            .body("dry_run", equalTo(true))
            .body("totals.mentions", notNullValue())
            .body("totals.unchanged", org.hamcrest.Matchers.greaterThanOrEqualTo(1));
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/link/mentions/backfill?dry_run=false")
        .then().statusCode(400);
    }
}
