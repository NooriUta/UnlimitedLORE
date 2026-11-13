package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.path.json.JsonPath;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_POLISH_UAT_1113/PU-17, шаг 3 — срез сухого прогона {@value LoreRolesLostOnMove#SLICE} на
 * живой ArcadeDB. Потеря воспроизводится так, как её делал task_mv до #1313: задача перенесена, а у
 * копии открытых рёбер ролей нет (здесь — закрыты после переноса). Контроль: перенос без потери в
 * выдачу не попадает. Только CI.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class RolesLostOnMoveSliceLiveDbTest {

    private static final String PROJECT = "pu17-lost-project";
    private static final String SRC = "SPRINT_PU17L_SRC";
    private static final String DST = "SPRINT_PU17L_DST";
    private static final String PERSON = "PU17L Ревьюер";
    private static final String AGENT = "pu17l-agent-dev";

    @Inject
    @org.eclipse.microprofile.rest.client.inject.RestClient
    LoreCommandClient client;

    @Inject
    MartCredentials creds;

    @ConfigProperty(name = "lore.db")
    String db;

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    private static void ok(String path, String body) {
        admin().body(body).when().post(path).then().statusCode(200);
    }

    private static String move(String uid) {
        return admin().body("{\"task_uid\":\"" + uid + "\",\"target_sprint_id\":\"" + DST + "\"}")
            .post("/lore/task/move").then().statusCode(200).extract().jsonPath().getString("new_task_uid");
    }

    @Test
    @Order(1)
    void setUp() {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"slug\":\"" + PROJECT + "\"}").when().post("/lore/project").then().statusCode(200);
        ok("/lore/user", "{\"kc_sub\":\"pu17l-sub\",\"display_name\":\"" + PERSON + "\"}");
        ok("/lore/user/role", "{\"kc_sub\":\"pu17l-sub\",\"project\":\"" + PROJECT + "\",\"role\":\"owner\"}");
        ok("/lore/actor", "{\"actor_id\":\"" + AGENT + "\",\"name\":\"PU17L агент\",\"kind\":\"agent\"}");
        for (String s : List.of(SRC, DST))
            ok("/lore/sprint/create", "{\"sprint_id\":\"" + s + "\",\"name\":\"" + s + "\",\"git_project\":\"" + PROJECT + "\"}");
        for (String t : List.of("L-1", "L-2")) {
            ok("/lore/task", "{\"sprint_id\":\"" + SRC + "\",\"task_id\":\"" + t + "\",\"title\":\"задача " + t + "\"}");
            ok("/lore/task/role", "{\"task_uid\":\"" + SRC + "/" + t + "\",\"role\":\"executor\",\"identity\":\"" + AGENT + "\"}");
            ok("/lore/task/role", "{\"task_uid\":\"" + SRC + "/" + t + "\",\"role\":\"reviewer\",\"identity\":\"" + PERSON + "\"}");
        }
        // L-1: перенос «как до #1313» — у копии рёбер ролей нет (закрываем их после переноса).
        String lost = move(SRC + "/L-1");
        client.command(db, creds.basicAuth(), new LoreCommandClient.LoreCommand("sql",
            "UPDATE ROLE_HELD_BY SET valid_to = '2026-11-13T00:00:00Z' WHERE @out.task_uid = '" + lost + "' AND valid_to IS NULL", null))
            .await().indefinitely();
        // L-2: перенос с ролями (после #1313) — контроль, в выдачу не попадает.
        move(SRC + "/L-2");
    }

    @Test
    @Order(2)
    void sliceFindsExactlyTheMoveThatLostRoles() {
        JsonPath r = given().when().get("/lore/slice/" + LoreRolesLostOnMove.SLICE + "?scope_projects=" + PROJECT)
            .then().statusCode(200).extract().jsonPath();
        List<Map<String, Object>> rows = r.getList("rows");
        List<Map<String, Object>> mine = rows.stream()
            .filter(x -> String.valueOf(x.get("from_task_uid")).startsWith(SRC + "/")).toList();
        assertEquals(1, mine.size(), "ровно один перенос потерял роли: " + rows);
        Map<String, Object> p = mine.get(0);
        assertEquals(SRC + "/L-1", p.get("from_task_uid"));
        assertEquals(DST + "/L-1", p.get("to_task_uid"));
        assertEquals("pair", p.get("verdict"));
        assertEquals(AGENT, p.get("executor"));
        assertEquals(PERSON, p.get("reviewer"));
        assertNotNull(r.get("checked.cancelled_with_roles"), "счётчики проверенного — ноль пар не выглядит как «не смотрели»");
    }
}
