package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;

/**
 * Роль на задаче ребром, а не полем: ПРОВОДКА (ADR-LORE-042, TR-04/TR-06/TR-07).
 *
 * <p>Правила уже проверены без базы ({@code TaskRoleWriterTest} и соседние), и
 * этого мало. Правило, доказанное на чистой функции, ничего не говорит о том,
 * долетает ли оно до графа: ровно в проводке живут ошибки, которые нас уже
 * ловили — {@code CREATE EDGE} по пустой выборке молчит вместо отказа,
 * {@code expand()} в подзапросе отдаёт 400 от движка, а имя поля, написанное
 * не так, даёт «добавлено 0» под видом успеха.
 *
 * <p>Поэтому здесь проверяется не «что решено», а «что записалось»: рёбра
 * читаются обратно, а не выводятся из кода ответа.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreTaskRoleLiveDbTest {

    private static final String PROJECT = "tr-role-project";
    private static final String SPRINT  = "SPRINT_TR_ROLE";
    private static final String TASK    = SPRINT + "/TR-1";
    private static final String TASK2   = SPRINT + "/TR-2";

    private static final String PERSON  = "TR Владелец";
    private static final String PERSON2 = "TR Второй";
    private static final String AGENT   = "tr-agent-full";

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    @Test
    @Order(1)
    void setUp() {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"slug\":\"" + PROJECT + "\"}")
        .when().post("/lore/project").then().statusCode(200);

        person("tr-sub-1", PERSON);
        person("tr-sub-2", PERSON2);

        admin().body("{\"actor_id\":\"" + AGENT + "\",\"name\":\"TR агент\",\"kind\":\"agent\"}")
            .when().post("/lore/actor").then().statusCode(200);

        admin().body("{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"Спринт ролей\","
                + "\"git_project\":\"" + PROJECT + "\"}")
            .when().post("/lore/sprint/create").then().statusCode(200);

        admin().body("{\"sprint_id\":\"" + SPRINT + "\",\"task_id\":\"TR-1\",\"title\":\"Задача с ролями\"}")
            .when().post("/lore/task").then().statusCode(200);
        admin().body("{\"sprint_id\":\"" + SPRINT + "\",\"task_id\":\"TR-2\",\"title\":\"Вторая задача\"}")
            .when().post("/lore/task").then().statusCode(200);
    }

    private void person(String sub, String name) {
        admin().body("{\"kc_sub\":\"" + sub + "\",\"display_name\":\"" + name + "\"}")
            .when().post("/lore/user").then().statusCode(200);
        admin().body("{\"kc_sub\":\"" + sub + "\",\"project\":\"" + PROJECT + "\",\"role\":\"owner\"}")
            .when().post("/lore/user/role").then().statusCode(200);
    }

    /**
     * Кандидаты выводятся ИЗ ГРАФА по пути задача → спринт → проект.
     *
     * <p>Запрос идёт через подзапрос с {@code expand()} — та самая конструкция,
     * которая у нас уже отдавала 400 от движка и не ловилась ничем, кроме
     * живой базы. Поэтому проверяется содержимое, а не только код ответа:
     * пустой список при 200 выглядел бы как «в проекте никого» и был бы
     * неотличим от исправной работы.
     */
    @Test
    @Order(2)
    void candidatesComeFromTheGraphNotFromAList() {
        admin().when().get("/lore/task/role-candidates?task_uid=" + TASK)
            .then().statusCode(200)
            .body("people", hasItem(PERSON))
            .body("people", hasItem(PERSON2))
            .body("agents", hasItem(AGENT))
            .body("project_has_roles", equalTo(true));
    }

    /** Назначение создаёт РЕБРО, и оно читается обратно, а не подразумевается. */
    @Test
    @Order(3)
    void assigningCreatesAnEdgeThatCanBeReadBack() {
        admin().body("{\"task_uid\":\"" + TASK + "\",\"role\":\"executor\",\"identity\":\"" + AGENT + "\"}")
            .when().post("/lore/task/role")
            .then().statusCode(200)
            .body("outcome", equalTo("created"));

        admin().when().get("/lore/task/role-candidates?task_uid=" + TASK)
            .then().statusCode(200);

        // Ребро есть в графе — спрашиваем сам граф, а не ответ записи.
        given().when().get("/lore/slice/task_roles?id=" + TASK)
            .then().statusCode(200)
            .body("rows", hasSize(1))
            .body("rows[0].role", equalTo("executor"))
            .body("rows[0].identity", equalTo(AGENT));
    }

    /** Повтор — законный {@code unchanged}: работы нет, ошибки тоже. */
    @Test
    @Order(4)
    void repeatingTheSameAssignmentIsUnchanged() {
        admin().body("{\"task_uid\":\"" + TASK + "\",\"role\":\"executor\",\"identity\":\"" + AGENT + "\"}")
            .when().post("/lore/task/role")
            .then().statusCode(200)
            .body("outcome", equalTo("unchanged"));

        given().when().get("/lore/slice/task_roles?id=" + TASK)
            .then().body("rows", hasSize(1));
    }

    /**
     * Смена исполнителя ЗАКРЫВАЕТ прежнее ребро, а не стирает его.
     *
     * <p>Это и есть то, чего поле не умело в принципе: оно отвечало на «кто
     * сейчас» и делало вопрос «сколько раз передавали» неотвечаемым. Проверяем
     * обе стороны: активный держатель один, а закрытая запись о прежнем
     * осталась.
     */
    @Test
    @Order(5)
    void changingTheHolderClosesThePreviousEdgeInsteadOfErasingIt() {
        admin().body("{\"task_uid\":\"" + TASK + "\",\"role\":\"executor\",\"identity\":\"" + PERSON + "\"}")
            .when().post("/lore/task/role")
            .then().statusCode(200)
            .body("outcome", equalTo("updated"))
            .body("replaced", equalTo(AGENT));

        given().when().get("/lore/slice/task_roles?id=" + TASK)
            .then().body("rows", hasSize(1))
            .body("rows[0].identity", equalTo(PERSON));

        given().when().get("/lore/slice/task_roles_history?id=" + TASK)
            .then().statusCode(200)
            .body("rows.findAll { it.identity == '" + AGENT + "' }.valid_to", hasSize(1));
    }

    /** Двойное ревью законно: единственным держателем ограничены только автор и исполнитель. */
    @Test
    @Order(6)
    void twoReviewersAreLegal() {
        admin().body("{\"task_uid\":\"" + TASK + "\",\"role\":\"reviewer\",\"identity\":\"" + PERSON + "\"}")
            .when().post("/lore/task/role").then().statusCode(200).body("outcome", equalTo("created"));
        admin().body("{\"task_uid\":\"" + TASK + "\",\"role\":\"reviewer\",\"identity\":\"" + PERSON2 + "\"}")
            .when().post("/lore/task/role").then().statusCode(200).body("outcome", equalTo("created"));

        given().when().get("/lore/slice/task_roles?id=" + TASK)
            .then().body("rows.findAll { it.role == 'reviewer' }", hasSize(2));
    }

    /** Отзыв ревьюера пишется на ТО ЖЕ ребро: «проверено» перестаёт быть пустой строкой. */
    @Test
    @Order(7)
    void reviewFeedbackLandsOnTheSameEdge() {
        admin().body("{\"task_uid\":\"" + TASK + "\",\"role\":\"reviewer\",\"identity\":\"" + PERSON + "\","
                + "\"verdict\":\"rework\",\"feedback_md\":\"Не хватает теста на пустой список\"}")
            .when().post("/lore/task/role")
            .then().statusCode(200)
            .body("outcome", equalTo("updated"))
            .body("verdict", equalTo("rework"));

        given().when().get("/lore/slice/task_roles?id=" + TASK)
            .then().body("rows.findAll { it.identity == '" + PERSON + "' && it.role == 'reviewer' }[0].verdict",
                equalTo("rework"));
    }

    /** У handoff вердикта нет и быть не может: он ничего не оценивал. */
    @Test
    @Order(8)
    void handoffCannotGiveAVerdict() {
        admin().body("{\"task_uid\":\"" + TASK + "\",\"role\":\"handoff\",\"identity\":\"" + PERSON2 + "\","
                + "\"verdict\":\"accepted\"}")
            .when().post("/lore/task/role")
            .then().statusCode(400)
            .body("outcome", equalTo("noop"))
            .body("reason", containsString("ничего не оценивал"));
    }

    /**
     * Незаявленная личность — отказ СО СПИСКОМ, и запись не происходит.
     *
     * <p>Проверяется и то, и другое: отказ, после которого ребро всё-таки
     * появилось, был бы хуже молчаливой записи.
     */
    @Test
    @Order(9)
    void unknownIdentityIsRefusedWithCandidatesAndNothingIsWritten() {
        admin().body("{\"task_uid\":\"" + TASK2 + "\",\"role\":\"executor\",\"identity\":\"claude-печать\"}")
            .when().post("/lore/task/role")
            .then().statusCode(400)
            .body("outcome", equalTo("noop"))
            .body("reason", containsString(PERSON));

        given().when().get("/lore/slice/task_roles?id=" + TASK2)
            .then().body("rows", hasSize(0));
    }

    /** Несуществующая задача — отказ, а не тихий no-op с ok:true. */
    @Test
    @Order(10)
    void missingTaskIsRefusedNotSilentlyIgnored() {
        admin().body("{\"task_uid\":\"" + SPRINT + "/НЕТ-ТАКОЙ\",\"role\":\"executor\","
                + "\"identity\":\"" + AGENT + "\"}")
            .when().post("/lore/task/role")
            .then().statusCode(400)
            .body("outcome", equalTo("noop"));
    }
}
