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

/**
 * Исходы связывания в Bragi (ADR-LORE-043, TR-10).
 *
 * <p>Тест написан по конкретному поводу, а не для покрытия. Переводя Bragi на
 * норму исходов, я назвала тип ребра рубрики по памяти — {@code HAS_RUBRIC},
 * тогда как в коде он {@code IN_RUBRIC}. Проба по несуществующему типу
 * возвращает «нет» на КАЖДЫЙ вызов: уверенный ответ, всегда неверный и внешне
 * неотличимый от честного «связи не было».
 *
 * <p>Поймано это чтением соседнего метода, то есть случайно. У остальных
 * ресурсов такая ошибка упала бы на живом тесте — у Bragi живых тестов на
 * связки не было вовсе.
 *
 * <p>Компилятор здесь не помощник: тип ребра — строка. Спросить можно только
 * настоящую базу.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreBragiLinkOutcomeLiveDbTest {

    private static final String PUB    = "PUB-OUT-1";
    private static final String SPRINT = "SPRINT_BRAGI_OUT";
    private static final String RUBRIC = "RUB-OUT-1";

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    @Test
    @Order(1)
    void setUp() {
        admin().body("{\"publication_id\":\"" + PUB + "\",\"title\":\"Публикация про исходы\","
                + "\"topic\":\"тест\",\"type\":\"article\"}")
            .when().post("/lore/bragi/publication").then().statusCode(200);
        admin().body("{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"Спринт для Bragi\"}")
            .when().post("/lore/sprint/create").then().statusCode(200);
        admin().body("{\"rubric_id\":\"" + RUBRIC + "\",\"name\":\"Рубрика для теста\"}")
            .when().post("/lore/bragi/rubric").then().statusCode(200);
    }

    @Test
    @Order(2)
    void firstLinkIsCreated() {
        admin().body(link(SPRINT, null))
            .when().post("/lore/bragi/link")
            .then().statusCode(200)
            .body("outcome", equalTo("created"))
            .body("action", equalTo("added")); // старый ключ остался
    }

    /** Повтор — законный {@code unchanged}, и без причины отказа. */
    @Test
    @Order(3)
    void repeatIsUnchanged() {
        admin().body(link(SPRINT, null))
            .when().post("/lore/bragi/link")
            .then().statusCode(200)
            .body("outcome", equalTo("unchanged"))
            .body("reason", equalTo(null));
    }

    @Test
    @Order(4)
    void missingTargetIsNoopWithReason() {
        admin().body(link("SPRINT_НЕТ_ТАКОГО", null))
            .when().post("/lore/bragi/link")
            .then().statusCode(200)
            .body("outcome", equalTo("noop"))
            .body("reason", containsString("SPRINT_НЕТ_ТАКОГО"));
    }

    @Test
    @Order(5)
    void removingExistingIsDeletedAndRepeatIsUnchanged() {
        admin().body(link(SPRINT, "remove"))
            .when().post("/lore/bragi/link")
            .then().statusCode(200).body("outcome", equalTo("deleted"));
        admin().body(link(SPRINT, "remove"))
            .when().post("/lore/bragi/link")
            .then().statusCode(200).body("outcome", equalTo("unchanged"));
    }

    /**
     * РУБРИКА — то самое место, где имя типа ребра было написано неверно.
     *
     * <p>Если проба спрашивает про несуществующий тип, повторная привязка той
     * же рубрики ответит {@code created} вместо {@code unchanged}: «нет связи»
     * приходит всегда. Именно эта проверка и ловит расхождение имени.
     */
    @Test
    @Order(6)
    void rubricProbeAsksAboutTheEdgeThatIsActuallyWritten() {
        admin().body("{\"entity_type\":\"publication\",\"entity_id\":\"" + PUB + "\","
                + "\"rubric_id\":\"" + RUBRIC + "\"}")
            .when().post("/lore/bragi/rubric/link")
            .then().statusCode(200).body("outcome", equalTo("created"));

        admin().body("{\"entity_type\":\"publication\",\"entity_id\":\"" + PUB + "\","
                + "\"rubric_id\":\"" + RUBRIC + "\"}")
            .when().post("/lore/bragi/rubric/link")
            .then().statusCode(200)
            .body("outcome", equalTo("unchanged"));
    }

    @Test
    @Order(7)
    void removingRubricIsDeletedThenUnchanged() {
        admin().body("{\"entity_type\":\"publication\",\"entity_id\":\"" + PUB + "\","
                + "\"rubric_id\":\"" + RUBRIC + "\",\"action\":\"remove\"}")
            .when().post("/lore/bragi/rubric/link")
            .then().statusCode(200).body("outcome", equalTo("deleted"));
        admin().body("{\"entity_type\":\"publication\",\"entity_id\":\"" + PUB + "\","
                + "\"rubric_id\":\"" + RUBRIC + "\",\"action\":\"remove\"}")
            .when().post("/lore/bragi/rubric/link")
            .then().statusCode(200).body("outcome", equalTo("unchanged"));
    }

    private static String link(String sprintId, String action) {
        return "{\"entity_type\":\"publication\",\"entity_id\":\"" + PUB + "\","
            + "\"edge_type\":\"PRODUCED_BY\",\"target_type\":\"sprint\","
            + "\"target_id\":\"" + sprintId + "\""
            + (action == null ? "" : ",\"action\":\"" + action + "\"") + "}";
    }
}
