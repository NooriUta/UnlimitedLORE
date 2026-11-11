package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-ACL-1 · S7B-ACL-2 — путь записи допуска «человек → машина» в граф и
 * чтение срезом machine_acl. Живая изолированная БД (testcontainers). Локально НЕ гонять — только CI.
 *
 * <p>Владелец-не-admin здесь не проверяется: в тестовом профиле OIDC выключен, sub токена нет —
 * правило «решает владелец» покрыто чистым {@code MachineAccessTest.writeRefusal_*}. Здесь — admin
 * и отказ человеку без роли admin, не владельцу.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class MachineAccessLiveDbTest {

    private static final String MACHINE = "acl1-test-machine";
    private static final String CLIENT = "minilore-link-" + MACHINE;
    private static final String ACTOR = "acl1-test-machine-actor";
    private static final String OWNER = "acl1-owner-sub-0001";
    private static final String KID = "acl1-kid-sub-0001";
    private static final String PROJECT = "LORE_TEST_ORG/acl1-repo";

    private static String body(String extra) {
        return "{\"machine_id\":\"" + MACHINE + "\",\"kc_sub\":\"" + KID + "\"" + extra + "}";
    }

    @Test
    @Order(1)
    void setUp() {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"slug\":\"" + PROJECT + "\"}").when().post("/lore/project").then().statusCode(200);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + OWNER + "\",\"display_name\":\"ACL Owner\"}").when().post("/lore/user").then().statusCode(200);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"actor_id\":\"" + ACTOR + "\",\"name\":\"ACL test machine\",\"kind\":\"agent\"}")
            .when().post("/lore/actor").then().statusCode(200);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"actor_id\":\"" + ACTOR + "\",\"client_id\":\"" + CLIENT + "\",\"kc_sub\":\"" + OWNER
                + "\",\"machine_id\":\"" + MACHINE + "\"}")
            .when().post("/lore/actor/owner").then().statusCode(200).body("owner_linked", equalTo(true));
    }

    @Test
    @Order(2)
    void schemaAndDictionarySeeded() {
        given().header("X-Seer-Role", "admin").when().get("/lore/slice/dictionary?dict_type=machine_access_role")
            .then().statusCode(200).body("rows.code", hasItem("viewer")).body("rows.code", hasItem("actor"));
    }

    @Test
    @Order(3)
    void unknownMachine_isNotFound_nonOwnerNonAdmin_isForbiddenInWords() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"machine_id\":\"acl1-nope\",\"kc_sub\":\"" + KID + "\",\"role\":\"viewer\",\"projects\":[\"" + PROJECT + "\"]}")
            .when().post("/lore/user/machine-access").then().statusCode(404).body("error", equalTo("TARGET_NOT_FOUND"));
        given().header("X-Seer-Role", "editor").contentType("application/json")
            .body(body(",\"role\":\"viewer\",\"projects\":[\"" + PROJECT + "\"]"))
            .when().post("/lore/user/machine-access").then().statusCode(403)
            .body("error", equalTo("MACHINE_ACCESS_FORBIDDEN"));
    }

    @Test
    @Order(4)
    void dryRun_plansWithoutWriting() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(body(",\"role\":\"viewer\",\"projects\":[\"" + PROJECT + "\"],\"dry_run\":true"))
            .when().post("/lore/user/machine-access").then().statusCode(200)
            .body("dry_run", equalTo(true)).body("plan.kind", equalTo("grant"));
        given().header("X-Seer-Role", "admin").when().get("/lore/slice/machine_acl?client_id=" + CLIENT)
            .then().statusCode(200).body("rows[0].grant_kc_subs.size()", equalTo(0));
    }

    @Test
    @Order(5)
    @SuppressWarnings("unchecked")
    void grant_isVisibleInSlice_byMachineAndByPerson() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(body(",\"display_name\":\"ACL Kid\",\"role\":\"viewer\",\"projects\":[\"" + PROJECT + "\"]"))
            .when().post("/lore/user/machine-access").then().statusCode(200)
            .body("machine_id", equalTo(MACHINE)).body("outcome", equalTo(LoreOutcome.CREATED));

        Map<String, Object> row = given().header("X-Seer-Role", "admin")
            .when().get("/lore/slice/machine_acl?client_id=" + CLIENT).then().statusCode(200)
            .extract().jsonPath().getMap("rows[0]");
        assertEquals(OWNER, MachineAccess.ownerOf(row));
        List<MachineAccess.Grant> grants = MachineAccess.grantsOf(row);
        assertEquals(List.of(new MachineAccess.Grant(KID, "viewer", List.of(PROJECT), List.of())), grants,
            "строка среза: " + row);
        assertTrue(MachineAccess.check(OWNER, grants, KID, MachineAccess.Action.VIEW, PROJECT, null).allowed());

        given().header("X-Seer-Role", "admin").when().get("/lore/slice/machine_acl?kc_sub=" + KID)
            .then().statusCode(200).body("rows.client_id", hasItem(CLIENT));
        given().header("X-Seer-Role", "admin").when().get("/lore/slice/machine_acl?kc_sub=" + OWNER)
            .then().statusCode(200).body("rows.client_id", hasItem(CLIENT));
    }

    @Test
    @Order(6)
    void regrant_updatesTheSameEdge_repeatIsUnchanged() {
        String up = body(",\"role\":\"actor\",\"projects\":[\"" + PROJECT + "\"],\"harnesses\":[\"codex\"]");
        given().header("X-Seer-Role", "admin").contentType("application/json").body(up)
            .when().post("/lore/user/machine-access").then().statusCode(200).body("outcome", equalTo(LoreOutcome.UPDATED));
        given().header("X-Seer-Role", "admin").contentType("application/json").body(up)
            .when().post("/lore/user/machine-access").then().statusCode(200).body("outcome", equalTo(LoreOutcome.UNCHANGED));
        given().header("X-Seer-Role", "admin").when().get("/lore/slice/machine_acl?client_id=" + CLIENT)
            .then().statusCode(200)
            .body("rows[0].grant_kc_subs.size()", equalTo(1))
            .body("rows[0].grant_roles[0]", equalTo("actor"))
            .body("rows[0].grant_harnesses[0]", hasItem("codex"));
    }

    @Test
    @Order(7)
    void ownerCannotBeGranted_unknownProjectRefused() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"machine_id\":\"" + MACHINE + "\",\"kc_sub\":\"" + OWNER + "\",\"role\":\"viewer\",\"projects\":[\"" + PROJECT + "\"]}")
            .when().post("/lore/user/machine-access").then().statusCode(400);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(body(",\"role\":\"viewer\",\"projects\":[\"LORE_TEST_ORG/acl1-no-such\"]"))
            .when().post("/lore/user/machine-access").then().statusCode(404);
    }

    @Test
    @Order(8)
    void revoke_removesEdge_repeatIsUnchanged() {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body(",\"action\":\"revoke\""))
            .when().post("/lore/user/machine-access").then().statusCode(200).body("outcome", equalTo(LoreOutcome.DELETED));
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body(",\"action\":\"revoke\""))
            .when().post("/lore/user/machine-access").then().statusCode(200).body("outcome", equalTo(LoreOutcome.UNCHANGED));
        given().header("X-Seer-Role", "admin").when().get("/lore/slice/machine_acl?client_id=" + CLIENT)
            .then().statusCode(200).body("rows[0].grant_kc_subs.size()", equalTo(0));
    }
}
