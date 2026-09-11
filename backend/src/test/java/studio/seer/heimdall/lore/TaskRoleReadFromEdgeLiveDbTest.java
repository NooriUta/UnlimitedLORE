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
import static org.hamcrest.Matchers.nullValue;

/**
 * Роль в списках задач читается ИЗ РЕБРА, а не из поля вершины (TR-05).
 *
 * <p>Ключи ответа остались прежними — `author_agent` и соседи, — поэтому по
 * виду выдачи не отличить, откуда взято значение. Ровно поэтому нужен этот
 * тест: подмена источника — самая тихая из возможных правок, и без проверки
 * «поле сняли, а срез всё ещё смотрит на вершину» обнаружилось бы прочерком в
 * интерфейсе через неделю.
 *
 * <p>Проверка построена так, чтобы поле НЕ МОГЛО дать правильный ответ:
 * задача заводится без ролей вовсе, роль появляется только ребром.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class TaskRoleReadFromEdgeLiveDbTest {

    private static final String PROJECT = "tr-edge-read";
    private static final String SPRINT  = "SPRINT_TR_EDGE_READ";
    private static final String TASK    = SPRINT + "/RE-1";
    private static final String PERSON  = "RE Человек";
    private static final String AGENT   = "re-agent";
    /** Читаемое имя агента — именно ОНО обязано попадать в списки. */
    private static final String AGENT_NAME = "RE агент";

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    @Test
    @Order(1)
    void setUp() {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"slug\":\"" + PROJECT + "\"}")
        .when().post("/lore/project").then().statusCode(200);

        admin().body("{\"kc_sub\":\"re-sub\",\"display_name\":\"" + PERSON + "\"}")
            .when().post("/lore/user").then().statusCode(200);
        admin().body("{\"kc_sub\":\"re-sub\",\"project\":\"" + PROJECT + "\",\"role\":\"owner\"}")
            .when().post("/lore/user/role").then().statusCode(200);
        admin().body("{\"actor_id\":\"" + AGENT + "\",\"name\":\"RE агент\",\"kind\":\"agent\"}")
            .when().post("/lore/actor").then().statusCode(200);

        admin().body("{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"Спринт чтения ролей\","
                + "\"git_project\":\"" + PROJECT + "\"}")
            .when().post("/lore/sprint/create").then().statusCode(200);
        // БЕЗ ролей: если срез читает поле, ответ останется пустым навсегда.
        admin().body("{\"sprint_id\":\"" + SPRINT + "\",\"task_id\":\"RE-1\",\"title\":\"Задача\"}")
            .when().post("/lore/task").then().statusCode(200);
    }

    /** Пока ребра нет — роль пуста. Иначе следующая проверка ничего не докажет. */
    @Test
    @Order(2)
    void withoutAnEdgeTheRoleIsEmpty() {
        given().when().get("/lore/slice/tasks_of_sprint?sprint_id=" + SPRINT)
            .then().statusCode(200)
            .body("rows[0].executor_agent", nullValue());
    }

    /**
     * Ребро появилось — срез обязан показать ЧИТАЕМОЕ ИМЯ, хотя поле пусто.
     *
     * <p>Назначаем по идентификатору (`re-agent`), а ждём имя («RE агент») —
     * то есть проверяем ровно подмену того, что видит человек, не трогая того,
     * чем пользуются машины. Раньше в списке стоял идентификатор со служебным
     * хвостом времени заведения: `AGENT-FULL-msbt0fed` в колонке «кто».
     */
    @Test
    @Order(3)
    void theEdgeShowsUpInTheTaskList() {
        admin().body("{\"task_uid\":\"" + TASK + "\",\"role\":\"executor\",\"identity\":\"" + AGENT + "\"}")
            .when().post("/lore/task/role").then().statusCode(200);

        given().when().get("/lore/slice/tasks_of_sprint?sprint_id=" + SPRINT)
            .then().statusCode(200)
            .body("rows[0].executor_agent", equalTo(AGENT_NAME));
    }

    /**
     * Человек и агент дают ОДИН ключ.
     *
     * <p>Личность лежит в разных полях у человека и у агента; два ключа
     * заставили бы каждого читателя склеивать их заново, по-своему.
     */
    @Test
    @Order(4)
    void aHumanHolderReadsThroughTheSameKey() {
        admin().body("{\"task_uid\":\"" + TASK + "\",\"role\":\"author\",\"identity\":\"" + PERSON + "\"}")
            .when().post("/lore/task/role").then().statusCode(200);

        given().when().get("/lore/slice/tasks_of_sprint?sprint_id=" + SPRINT)
            .then().statusCode(200)
            .body("rows[0].author_agent", equalTo(PERSON));
    }

    /**
     * ЗАКРЫТОЕ ребро не показывается: смена держателя видна сразу, а прежний
     * исчезает из списка, оставаясь в истории.
     *
     * <p>Без фильтра по открытости список показывал бы обоих — и «кто делает
     * сейчас» снова стало бы неоднозначным, ради чего роли и уехали в рёбра.
     */
    @Test
    @Order(5)
    void aReplacedHolderDisappearsFromTheList() {
        admin().body("{\"task_uid\":\"" + TASK + "\",\"role\":\"executor\",\"identity\":\"" + PERSON + "\"}")
            .when().post("/lore/task/role").then().statusCode(200)
            .body("outcome", equalTo("updated"));

        given().when().get("/lore/slice/tasks_of_sprint?sprint_id=" + SPRINT)
            .then().statusCode(200)
            .body("rows[0].executor_agent", equalTo(PERSON));

        // Прежний держатель остался в истории — проверяем, что он не потерян.
        given().when().get("/lore/slice/task_roles_history?id=" + TASK)
            .then().statusCode(200)
            .body("rows.findAll { it.identity == '" + AGENT + "' }.size()", equalTo(1));
    }

    /** Тот же источник — и в общем списке задач, не только в списке спринта. */
    @Test
    @Order(6)
    void theBatchListReadsTheEdgeToo() {
        given().when().get("/lore/slice/all_tasks")
            .then().statusCode(200)
            .body("rows.find { it.task_uid == '" + TASK + "' }.author_agent", equalTo(PERSON));
    }
}
