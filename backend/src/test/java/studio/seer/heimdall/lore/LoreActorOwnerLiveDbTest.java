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
import static org.hamcrest.Matchers.notNullValue;

/**
 * AL-83 (ADR-LORE-036): связка KnowActor(kind=agent) ↔ владелец-человек через
 * client_id + OWNED_BY. Живая изолированная БД (testcontainers, lore_c5_test).
 * AgentScopeFilter'у не даёт бить сюда ЛЮБОЙ агентный профиль (subpath
 * "actor/owner" → пустой набор) — не проверяется здесь тем же путём, что и
 * "user" в AL-82: фильтр JWT/OIDC-гейт, в тестовом профиле (oidcEnabled=false)
 * не срабатывает на голый X-Seer-Role, покрытие семейства — статически,
 * AgentScopeMatrixCoverageTest.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreActorOwnerLiveDbTest {

    private static final String ACTOR = "al83-test-agent";
    private static final String NON_AGENT_ACTOR = "al83-test-human-role";
    private static final String CLIENT_ID = "lore-mcp-al83-test";
    private static final String OWNER_SUB = "al83-owner-sub-0001";
    private static final String OTHER_SUB = "al83-owner-sub-0002";

    @Test
    @Order(1)
    void setUp() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"actor_id\":\"" + ACTOR + "\",\"name\":\"AL-83 Test Agent\",\"kind\":\"agent\"}")
        .when().post("/lore/actor")
        .then().statusCode(200);

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"actor_id\":\"" + NON_AGENT_ACTOR + "\",\"name\":\"AL-83 Test Human Role\",\"kind\":\"human-role\"}")
        .when().post("/lore/actor")
        .then().statusCode(200);

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + OWNER_SUB + "\",\"display_name\":\"AL-83 Owner\"}")
        .when().post("/lore/user")
        .then().statusCode(200);

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + OTHER_SUB + "\",\"display_name\":\"AL-83 Other Owner\"}")
        .when().post("/lore/user")
        .then().statusCode(200);
    }

    @Test
    @Order(2)
    void unknownActorIsRejected() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"actor_id\":\"al83-does-not-exist\",\"client_id\":\"" + CLIENT_ID + "\",\"kc_sub\":\"" + OWNER_SUB + "\"}")
        .when().post("/lore/actor/owner")
        .then().statusCode(400)
            .body("error", equalTo("BAD_PARAMS"));
    }

    @Test
    @Order(3)
    void nonAgentActorIsRejected() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"actor_id\":\"" + NON_AGENT_ACTOR + "\",\"client_id\":\"" + CLIENT_ID + "\",\"kc_sub\":\"" + OWNER_SUB + "\"}")
        .when().post("/lore/actor/owner")
        .then().statusCode(400)
            .body("error", equalTo("BAD_PARAMS"));
    }

    @Test
    @Order(4)
    void assigningOwnerLinksClientIdAndEdgeVisibleInSlice() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"actor_id\":\"" + ACTOR + "\",\"client_id\":\"" + CLIENT_ID + "\",\"kc_sub\":\"" + OWNER_SUB + "\"}")
        .when().post("/lore/actor/owner")
        .then().statusCode(200)
            .body("owner_linked", equalTo(true))
            .body("client_id", equalTo(CLIENT_ID));

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/agent_owners")
        .then().statusCode(200)
            .body("rows.actor_id", hasItem(ACTOR))
            .body("rows.find { it.actor_id == '" + ACTOR + "' }.client_id", equalTo(CLIENT_ID))
            .body("rows.find { it.actor_id == '" + ACTOR + "' }.owner_kc_sub", hasItem(OWNER_SUB));
    }

    @Test
    @Order(5)
    void reassigningOwnerReplacesEdgeNotDuplicates() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"actor_id\":\"" + ACTOR + "\",\"client_id\":\"" + CLIENT_ID + "\",\"kc_sub\":\"" + OTHER_SUB + "\"}")
        .when().post("/lore/actor/owner")
        .then().statusCode(200)
            .body("owner_linked", equalTo(true));

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/agent_owners")
        .then().statusCode(200)
            .body("rows.find { it.actor_id == '" + ACTOR + "' }.owner_kc_sub", hasItem(OTHER_SUB))
            .body("rows.findAll { it.actor_id == '" + ACTOR + "' }.size()", equalTo(1));
    }

    @Test
    @Order(6)
    void assigningUnknownOwnerReportsUnlinkedWithHint() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"actor_id\":\"" + ACTOR + "\",\"client_id\":\"" + CLIENT_ID + "\",\"kc_sub\":\"al83-nobody\"}")
        .when().post("/lore/actor/owner")
        .then().statusCode(200)
            .body("owner_linked", equalTo(false))
            .body("hint", notNullValue());
    }
}
