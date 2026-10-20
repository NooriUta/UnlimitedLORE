package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;

/**
 * Событие ленты несёт ВСЕ свои принадлежности списком (SE-05).
 *
 * <p><b>Правило владельца, 31.08.2026:</b> «событие при группировке пусть
 * показывает в каждом проекте, в этом фишка; у нас бывают и спринты, и ADR
 * совместные между проектами». Принадлежность множественна по замыслу.
 *
 * <p><b>Что было не так — в ЧТЕНИИ, а не в данных.</b> База честно хранила обе
 * принадлежности, а лента брала первую из списка и клала в одно поле. Одна из
 * двух показывалась, вторая исчезала, и какая именно — решал порядок обхода
 * графа. Это наш обычный класс «признак беднее состояния», только виноват
 * читатель.
 *
 * <p><b>Почему проверка именно на ДВУХ проектах.</b> На одном старое и новое
 * поведение неразличимы: и поле, и список из одного элемента показали бы то же
 * самое. Тест на одной принадлежности был бы зелёным и пустым.
 *
 * <p><b>Контракт согласован с сессией мобильного клиента 31.08.2026</b> — она
 * выпустила свою половину заранее, поэтому форма менялась один раз и по
 * договорённости, а не подбором:
 * <ul>
 *   <li>одно событие — ОДНА строка, принадлежности списком внутри неё. Двумя
 *       строками нельзя: у клиента ключ строки не содержит проекта, дубли
 *       схлопнулись бы и показали случайную принадлежность — та же болезнь,
 *       переехавшая к потребителю;</li>
 *   <li>{@code projects} присутствует всегда, пустым списком в том числе:
 *       «нет проекта» и «поле не пришло» — разные ответы;</li>
 *   <li>{@code project} остаётся первым из списка, ради сборок, которые ещё
 *       читают строку;</li>
 *   <li>порядок детерминированный — иначе «первый» прыгал бы между выкладками
 *       и запись меняла бы проект без единой правки данных.</li>
 * </ul>
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class NewsCarriesAllProjectsLiveDbTest {

    /** Слаги нарочно в обратном алфавитном порядке заведения — сортировку это и проверяет. */
    private static final String PROJECT_B = "zeta-multi-probe";
    private static final String PROJECT_A = "alpha-multi-probe";

    private static final String SHARED = "D-MULTI-PROJECT-PROBE";
    private static final String LONELY = "D-NO-PROJECT-PROBE";

    private static final String SPRINT = "SPRINT_MULTI_PROJECT_PROBE";
    private static final String TASK_UID = SPRINT + "/T-MULTI";

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    private static String itemOf(String decision, String field) {
        return "items.find { it.kind == 'decision' && it.ref?.id == '" + decision + "' }." + field;
    }

    @Test
    @Order(1)
    void setUp() {
        for (String slug : new String[]{PROJECT_B, PROJECT_A}) {
            given().header("X-Seer-Role", "superadmin").contentType("application/json")
                .body("{\"slug\":\"" + slug + "\"}")
            .when().post("/lore/project").then().statusCode(200);
        }

        admin().body("{\"decision_id\":\"" + SHARED + "\",\"title\":\"Общее для двух проектов\","
                + "\"date_created\":\"2026-08-01\",\"body_md\":\"Тело.\"}")
            .when().post("/lore/decision").then().statusCode(200);
        for (String slug : new String[]{PROJECT_B, PROJECT_A}) {
            admin().body("{\"decision_id\":\"" + SHARED + "\",\"project\":\"" + slug + "\"}")
                .when().post("/lore/decision/project").then().statusCode(200);
        }

        admin().body("{\"decision_id\":\"" + LONELY + "\",\"title\":\"Ничьё\","
                + "\"date_created\":\"2026-08-01\",\"body_md\":\"Тело.\"}")
            .when().post("/lore/decision").then().statusCode(200);

        // Спринт двух проектов, задача заведена и закрыта.
        admin().body("{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"Спринт двух проектов\"}")
            .when().post("/lore/sprint/create").then().statusCode(200);
        for (String slug : new String[]{PROJECT_B, PROJECT_A}) {
            admin().body("{\"sprint_id\":\"" + SPRINT + "\",\"git_project\":\"" + slug + "\"}")
                .when().post("/lore/sprint/project").then().statusCode(200);
        }
        admin().body("{\"sprint_id\":\"" + SPRINT + "\",\"task_id\":\"T-MULTI\",\"title\":\"Задача двух проектов\"}")
            .when().post("/lore/task").then().statusCode(200);
        admin().body("{\"entity_type\":\"task\",\"id\":\"" + TASK_UID + "\",\"status\":\"done\"}")
            .when().post("/lore/status").then().statusCode(200);
    }

    /**
     * Спринт и его задачи — те же правила, что у решений (найдено 20.10.2026).
     *
     * <p>SE-05 перевёл на список решения и ADR, а спринт по-прежнему отдавал в
     * ленту ПЕРВЫЙ свой git-проект — и задачи наследовали его. Спринт
     * SPRINT_MINILORE_CUTOVER привязан к трём репо, первым в обходе шёл
     * UnlimitedLORE, и в строке miniLORE у владелицы за день не было ни одной
     * задачи при исправно закрытых — «вы задачи вообще закрываете?».
     */
    @Test
    @Order(5)
    void sprintAndItsTaskEventsCarryEverySprintProject() {
        var news = given().when().get("/lore/news?days=3650&limit=5000").then().statusCode(200);
        news.body("items.find { it.kind == 'sprint' && it.event == 'created' && it.title == 'Спринт двух проектов' }.projects",
                contains(PROJECT_A, PROJECT_B))
            .body("items.find { it.kind == 'tasks' && it.event == 'created' && it.ref?.id == '" + TASK_UID + "' }.projects",
                contains(PROJECT_A, PROJECT_B))
            .body("items.find { it.kind == 'tasks' && it.event == 'closed' && it.ref?.id == '" + TASK_UID + "' }.projects",
                contains(PROJECT_A, PROJECT_B));
    }

    /** Обе принадлежности видны, и обе — в ОДНОЙ строке. */
    @Test
    @Order(2)
    void bothProjectsTravelInOneRow() {
        given().when().get("/lore/news?days=3650&limit=5000")
            .then().statusCode(200)
            .body("items.findAll { it.kind == 'decision' && it.ref?.id == '" + SHARED + "' }", hasSize(1))
            .body(itemOf(SHARED, "projects"), contains(PROJECT_A, PROJECT_B));
    }

    /**
     * Старое поле осталось и равно ПЕРВОМУ из списка.
     *
     * <p>Клиент со старой сборкой читает именно его; выбросив поле, мы ослепили
     * бы телефоны, которые ещё не обновились, — и выглядело бы это как пропажа
     * проекта, а не как смена контракта.
     */
    @Test
    @Order(3)
    void theLegacyFieldIsTheFirstOfTheList() {
        given().when().get("/lore/news?days=3650&limit=5000")
            .then().statusCode(200)
            .body(itemOf(SHARED, "project"), equalTo(PROJECT_A));
    }

    /**
     * Без принадлежностей приходит ПУСТОЙ СПИСОК, а не отсутствующий ключ.
     *
     * <p>Ровно то различие, ради которого контракт и писался: «нет проекта» и
     * «поле не пришло» обязаны выглядеть по-разному, иначе читатель снова
     * начнёт гадать — и снова спишет собственную ошибку на пропажу данных.
     */
    @Test
    @Order(4)
    void noProjectsMeansAnEmptyListNotAMissingKey() {
        given().when().get("/lore/news?days=3650&limit=5000")
            .then().statusCode(200)
            .body(itemOf(LONELY, "projects"), hasSize(0))
            .body(itemOf(LONELY, "project"), equalTo(null));
    }
}
