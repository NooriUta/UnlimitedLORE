package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.path.json.JsonPath;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-11 — {@code POST /lore/task/dep} на живой ArcadeDB: выделенный путь
 * «задача зависит от задачи» по образцу {@code sprint/dep}, внутри — тот же {@code linkDependency}
 * (MDL-13). Что проверяется здесь, а не в LoreDependencyEmbeddedTest: маршрут зарегистрирован и
 * отвечает в форме {@code from_task}/{@code to_task}; вид по умолчанию — soft; цикл A→B→A отбивается
 * 409 с цепочкой и НЕ пишется; снятие закрывает ребро, и срез зависимостей его больше не видит.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreTaskDepLiveDbTest {

    private static final String S = "SPRINT_KREG11_DEP";
    private static final String T1 = S + "/D1";
    private static final String T2 = S + "/D2";
    private static final String T3 = S + "/D3";

    private static void admin(String path, Map<String, Object> body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    private static JsonPath taskDep(Map<String, Object> body, int expectedStatus) {
        return given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post("/lore/task/dep")
            .then().statusCode(expectedStatus).extract().jsonPath();
    }

    private static List<Map<String, Object>> depsOf(String uid) {
        return given().header("X-Seer-Role", "admin")
            .queryParam("type", "task").queryParam("id", uid)
            .when().get("/lore/slice/deps_of")
            .then().statusCode(200).extract().jsonPath().getList("rows");
    }

    @Test
    @Order(1)
    void setup_sprintAndThreeTasks() {
        admin("/lore/sprint/create", Map.of("sprint_id", S, "name", "kreg-11 dep"));
        for (String id : new String[]{"D1", "D2", "D3"})
            admin("/lore/task", Map.of("sprint_id", S, "task_id", id, "title", "задача " + id));
    }

    @Test
    @Order(2)
    void linkWithKindAndReason_carriesFromToTask() {
        JsonPath jp = taskDep(Map.of("from_task", T1, "to_task", T2, "kind", "waits", "reason", "ждём схему"), 200);
        assertEquals(T1, jp.getString("from_task"), "форма ответа по образцу sprint/dep");
        assertEquals(T2, jp.getString("to_task"));
        assertEquals("waits", jp.getString("kind"));
        assertEquals("created", jp.getString("outcome"));
        assertEquals(1, depsOf(T1).size(), "зависимость видна срезу: " + depsOf(T1));
        assertEquals("out", depsOf(T1).get(0).get("dir"));
        assertEquals(T2, depsOf(T1).get(0).get("other_id"));
    }

    @Test
    @Order(3)
    void linkWithoutKind_defaultsToSoft() {
        JsonPath jp = taskDep(Map.of("from_task", T2, "to_task", T3, "reason", "координация"), 200);
        assertEquals("soft", jp.getString("kind"), "вид не назван — soft, как у спринтов");
    }

    @Test
    @Order(4)
    void newLinkWithoutReason_is422() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(Map.of("from_task", T3, "to_task", T2))
        .when().post("/lore/task/dep")
        .then().statusCode(422).body("error", equalTo("REASON_REQUIRED"));
        assertTrue(depsOf(T3).stream().noneMatch(r -> "out".equals(r.get("dir")) && T2.equals(r.get("other_id"))),
            "ребро без причины не записано: " + depsOf(T3));
    }

    @Test
    @Order(5)
    void cycleAtoBtoA_is409WithTheChainAndNotWritten() {
        JsonPath jp = taskDep(Map.of("from_task", T2, "to_task", T1, "kind", "blocks", "reason", "замкнёт круг"), 409);
        assertEquals("CYCLE", jp.getString("error"));
        assertEquals(List.of("task:" + T2, "task:" + T1, "task:" + T2), jp.getList("cycle"),
            "цепочка цикла названа целиком");
        assertTrue(depsOf(T2).stream().noneMatch(r -> "out".equals(r.get("dir")) && T1.equals(r.get("other_id"))),
            "замыкающее ребро не записано: " + depsOf(T2));
    }

    @Test
    @Order(6)
    void unlinkClosesTheEdge() {
        JsonPath jp = taskDep(Map.of("from_task", T1, "to_task", T2, "action", "remove"), 200);
        assertEquals("deleted", jp.getString("outcome"));
        assertTrue(depsOf(T1).isEmpty(), "закрытое ребро срезу не видно (история осталась в графе)");
    }
}
