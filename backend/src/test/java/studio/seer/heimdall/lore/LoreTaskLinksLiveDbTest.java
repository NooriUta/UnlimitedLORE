package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.notNullValue;

/**
 * PL-14 (ADR-LORE-022 D16): обязательные связки классов работ.
 *
 * До этой задачи дисциплина держалась на внимательности: REALIZES ставился
 * ВТОРЫМ вызовом со стороны сценария, а `JUSTIFIED_BY` был объявлен в схеме и
 * не имел ни писателей, ни читателей — правило «энейблер обосновывается
 * решением» существовало только на бумаге. Тесты закрывают оба провала.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreTaskLinksLiveDbTest {

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    @Test
    @Order(1)
    void setUp() {
        post("/lore/sprint/create", "{\"sprint_id\":\"SPRINT_TL\",\"name\":\"task-links\"}");
        post("/lore/feature", "{\"feature_id\":\"FEAT-TL\",\"title\":\"Корень\",\"status\":\"active\"}");
        post("/lore/uc", "{\"uc_id\":\"UC-TL-1\",\"title\":\"Сценарий\",\"parent_uc_id\":\"FEAT-TL\","
            + "\"goal_level\":\"sea-level\"}");
        post("/lore/adr", "{\"adr_id\":\"ADR-TL-1\",\"name\":\"Обоснование энейблера\",\"status\":\"ACCEPTED\"}");
    }

    /**
     * Связка создаётся ВМЕСТЕ с задачей, одним вызовом. Раньше между созданием
     * задачи и её привязкой существовало окно, в котором uc-задача жила без
     * REALIZES — и если второй вызов не делали, нарушение всплывало только в
     * advisory-слайсе.
     */
    @Test
    @Order(2)
    void ucIdCreatesRealizesAtomicallyWithTheTask() {
        post("/lore/task", "{\"sprint_id\":\"SPRINT_TL\",\"task_id\":\"T1\",\"title\":\"uc-задача\","
            + "\"work_class\":\"uc\",\"uc_id\":\"UC-TL-1\"}");

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/tasks_of_uc?id=UC-TL-1")
        .then().statusCode(200)
            .body("rows.task_uid", hasItem("SPRINT_TL/T1"));

        // Обратная сторона той же связки — задача знает свой сценарий.
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/tasks_of_sprint?sprint_id=SPRINT_TL")
        .then().statusCode(200)
            .body("rows.find { it.task_id == 'T1' }.realizes_uc", hasItem("UC-TL-1"));

        // И её нет в списке нарушений — слайс перестал быть единственной защитой.
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/unlinked_uc_tasks")
        .then().statusCode(200)
            .body("rows.task_uid", not(hasItem("SPRINT_TL/T1")));
    }

    /**
     * Несуществующий сценарий — отказ, а не «задача создана, ребра нет».
     * CREATE EDGE в пустой TO молча ничего не делает, поэтому без проверки
     * ответ был бы ok:true при отсутствующей связке.
     */
    @Test
    @Order(3)
    void missingUcIsRejectedAndTaskIsNotCreated() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"sprint_id\":\"SPRINT_TL\",\"task_id\":\"T-GHOST\",\"title\":\"x\","
                + "\"work_class\":\"uc\",\"uc_id\":\"UC-NO-SUCH\"}")
        .when().post("/lore/task")
        .then().statusCode(400);

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/tasks_of_sprint?sprint_id=SPRINT_TL")
        .then().statusCode(200)
            .body("rows.findAll { it.task_id == 'T-GHOST' }", empty());
    }

    /** Перепривязка не должна оставлять задачу висеть на двух сценариях сразу. */
    @Test
    @Order(4)
    void taskSetRepointsRealizesInsteadOfAddingSecond() {
        post("/lore/uc", "{\"uc_id\":\"UC-TL-2\",\"title\":\"Второй сценарий\",\"parent_uc_id\":\"FEAT-TL\","
            + "\"goal_level\":\"sea-level\"}");
        post("/lore/task/edit", "{\"task_uid\":\"SPRINT_TL/T1\",\"title\":\"uc-задача\",\"uc_id\":\"UC-TL-2\"}");

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/tasks_of_uc?id=UC-TL-2")
        .then().statusCode(200).body("rows.task_uid", hasItem("SPRINT_TL/T1"));

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/tasks_of_uc?id=UC-TL-1")
        .then().statusCode(200).body("rows.task_uid", not(hasItem("SPRINT_TL/T1")));
    }

    /**
     * JUSTIFIED_BY оживает: до PL-14 тип ребра был объявлен в схеме и не
     * упоминался больше нигде во всём репозитории.
     */
    @Test
    @Order(5)
    void enablerTaskIsJustifiedByAnAdr() {
        post("/lore/task", "{\"sprint_id\":\"SPRINT_TL\",\"task_id\":\"T2\",\"title\":\"enb-задача\","
            + "\"work_class\":\"enb\"}");

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/unlinked_enb_tasks")
        .then().statusCode(200).body("rows.task_uid", hasItem("SPRINT_TL/T2"));

        post("/lore/task/adr", "{\"task_uid\":\"SPRINT_TL/T2\",\"adr_id\":\"ADR-TL-1\"}");

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/unlinked_enb_tasks")
        .then().statusCode(200).body("rows.task_uid", not(hasItem("SPRINT_TL/T2")));

        // Обе стороны проверяются ДО записи — иначе был бы тихий no-op с ok:true.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"task_uid\":\"SPRINT_TL/T2\",\"adr_id\":\"ADR-NO-SUCH\"}")
        .when().post("/lore/task/adr")
        .then().statusCode(400);

        // Снятие связки возвращает задачу в список нарушений.
        post("/lore/task/adr", "{\"task_uid\":\"SPRINT_TL/T2\",\"adr_id\":\"ADR-TL-1\",\"action\":\"remove\"}");
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/unlinked_enb_tasks")
        .then().statusCode(200).body("rows.task_uid", hasItem("SPRINT_TL/T2"));
    }

    /**
     * D16: в сценарии видно не только задачу, но и СТАТУС ЕЁ СПРИНТА — «доехало
     * ли» читается на месте. Раньше слайс отдавал статус задачи и голый
     * sprint_id, и расхождение «задача закрыта, спринт отменён» было невидимо.
     */
    @Test
    @Order(6)
    void tasksOfUcCarrySprintStatus() {
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/tasks_of_uc?id=UC-TL-2")
        .then().statusCode(200)
            .body("rows.find { it.task_uid == 'SPRINT_TL/T1' }.sprint_id", equalTo("SPRINT_TL"))
            .body("rows.find { it.task_uid == 'SPRINT_TL/T1' }.sprint_status_raw", notNullValue());
    }
}
