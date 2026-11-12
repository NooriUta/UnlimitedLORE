package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-MACH-1 · S7B-ACT-1 — заведение машины одним вызовом (POST /lore/actor/machine)
 * и окно активности машины (POST /lore/user/machine-activity) на живой изолированной БД
 * (testcontainers). Локально НЕ гонять — только CI: любой прогон Quarkus-теста мигрирует базу.
 *
 * <p>Здесь — путь admin и отказы человеку без роли admin. Ветки «агент full — только своему
 * владельцу» и «человек — только себе» требуют токена (OIDC в тестовом профиле выключен) и
 * покрыты чистым {@code MachineEnrollTest}.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class MachineActivityEnrollLiveDbTest {

    private static final String MACHINE = "mach1-test-box";
    private static final String CLIENT = "minilore-link-" + MACHINE;
    private static final String OWNER = "mach1-owner-sub-0001";
    private static final String OTHER = "mach1-other-sub-0001";

    private static String enroll(String extra) {
        return "{\"machine_id\":\"" + MACHINE + "\"" + extra + "}";
    }

    @Test
    @Order(1)
    void setUp_people() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + OWNER + "\",\"display_name\":\"Mach Owner\"}").when().post("/lore/user").then().statusCode(200);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + OTHER + "\",\"display_name\":\"Mach Other\"}").when().post("/lore/user").then().statusCode(200);
    }

    @Test
    @Order(2)
    void enroll_dryRun_plansCreate_writesNothing() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(enroll(",\"kc_sub\":\"" + OWNER + "\",\"harness\":\"claude-code\",\"dry_run\":true"))
            .when().post("/lore/actor/machine").then().statusCode(200)
            .body("machine_id", equalTo(MACHINE)).body("dry_run", equalTo(true)).body("plan.kind", equalTo("create"))
            .body("plan.after.client_id", equalTo(CLIENT));
        given().header("X-Seer-Role", "admin").when().get("/lore/slice/machine_acl?client_id=" + CLIENT)
            .then().statusCode(200).body("rows.size()", equalTo(0));
    }

    @Test
    @Order(3)
    void enroll_createsMachine_visibleInAgentOwners_repeatIsUnchanged() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(enroll(",\"kc_sub\":\"" + OWNER + "\",\"harness\":\"claude-code\""))
            .when().post("/lore/actor/machine").then().statusCode(200)
            .body("outcome", equalTo(LoreOutcome.CREATED)).body("owner_linked", equalTo(true));
        given().header("X-Seer-Role", "admin").when().get("/lore/slice/agent_owners")
            .then().statusCode(200).body("rows.client_id", hasItem(CLIENT)).body("rows.machine_id", hasItem(MACHINE));
        given().header("X-Seer-Role", "admin").when().get("/lore/slice/machine_acl?client_id=" + CLIENT)
            .then().statusCode(200).body("rows[0].owner_kc_sub", hasItem(OWNER))
            .body("rows[0].last_seen_at", nullValue()).body("rows[0].activity_default_h", equalTo(MachineActivity.DEFAULT_H));
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(enroll(",\"kc_sub\":\"" + OWNER + "\",\"harness\":\"claude-code\""))
            .when().post("/lore/actor/machine").then().statusCode(200).body("outcome", equalTo(LoreOutcome.UNCHANGED));
    }

    @Test
    @Order(4)
    void enroll_foreignOwner_refusedWithOwnersName_badName_refused() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(enroll(",\"kc_sub\":\"" + OTHER + "\""))
            .when().post("/lore/actor/machine").then().statusCode(409)
            .body("error", equalTo("MACHINE_TAKEN")).body("detail", containsString("Mach Owner"));
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"machine_id\":\"" + CLIENT + "\",\"kc_sub\":\"" + OWNER + "\"}")
            .when().post("/lore/actor/machine").then().statusCode(400);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"machine_id\":\"mach1-nobody\",\"kc_sub\":\"mach1-no-such-sub\"}")
            .when().post("/lore/actor/machine").then().statusCode(404);
    }

    // ── S7B-ACT-1 ─────────────────────────────────────────────────────────

    private static String activity(String extra) {
        return "{\"machine_id\":\"" + MACHINE + "\"" + extra + "}";
    }

    @Test
    @Order(5)
    void activity_badRange_400_nonOwnerNonAdmin_403() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(activity(",\"window_h\":25")).when().post("/lore/user/machine-activity").then().statusCode(400);
        given().header("X-Seer-Role", "editor").contentType("application/json")
            .body(activity(",\"window_h\":6")).when().post("/lore/user/machine-activity").then().statusCode(403);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"machine_id\":\"mach1-nope\",\"window_h\":6}").when().post("/lore/user/machine-activity").then().statusCode(404);
    }

    @Test
    @Order(6)
    @SuppressWarnings("unchecked")
    void activity_dryRun_thenWrite_readBySlice_repeatUnchanged_reset() {
        String body = activity(",\"window_h\":6,\"harness\":{\"claude-code\":3}");
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(activity(",\"window_h\":6,\"harness\":{\"claude-code\":3},\"dry_run\":true"))
            .when().post("/lore/user/machine-activity").then().statusCode(200)
            .body("plan.kind", equalTo("update")).body("plan.after.window_h", equalTo(6));
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post("/lore/user/machine-activity").then().statusCode(200).body("outcome", equalTo(LoreOutcome.UPDATED));
        Map<String, Object> row = given().header("X-Seer-Role", "admin")
            .when().get("/lore/slice/machine_acl?client_id=" + CLIENT).then().statusCode(200)
            .extract().jsonPath().getMap("rows[0]");
        MachineActivity.Setting s = MachineActivity.settingOf(row);
        assertEquals(new MachineActivity.Setting(6, Map.of("claude-code", 3)), s, "строка среза: " + row);
        assertEquals(3, MachineActivity.effective(s, "claude-code").hours());
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post("/lore/user/machine-activity").then().statusCode(200).body("outcome", equalTo(LoreOutcome.UNCHANGED));
        given().header("X-Seer-Role", "admin").when().get("/lore/slice/agent_owners")
            .then().statusCode(200).body("rows.find { it.client_id == '" + CLIENT + "' }.activity_window_h", equalTo(6));
        given().header("X-Seer-Role", "admin").contentType("application/json").body(activity(""))
            .when().post("/lore/user/machine-activity").then().statusCode(200).body("outcome", equalTo(LoreOutcome.UPDATED));
        given().header("X-Seer-Role", "admin").when().get("/lore/slice/machine_acl?client_id=" + CLIENT)
            .then().statusCode(200).body("rows[0].activity_window_h", nullValue());
    }
}
