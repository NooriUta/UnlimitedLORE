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
 * Исходы связывания на живой базе (ADR-LORE-043).
 *
 * <p>Проверяется не словарь значений — он проверен без базы, — а то, что
 * различение доходит до графа. Различить «уже было» и «конца нет» можно только
 * ФАКТОМ, а факт живёт в базе: на чистой функции этот кусок недоказуем в
 * принципе.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreAdrLinkOutcomeLiveDbTest {

    private static final String ADR    = "ADR-OUT-1";
    private static final String SPRINT = "SPRINT_OUT_1";

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    @Test
    @Order(1)
    void setUp() {
        admin().body("{\"adr_id\":\"" + ADR + "\",\"name\":\"ADR про исходы записи\"}")
            .when().post("/lore/adr").then().statusCode(200);
        admin().body("{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"Спринт про исходы\"}")
            .when().post("/lore/sprint/create").then().statusCode(200);
    }

    @Test
    @Order(2)
    void firstLinkIsCreated() {
        admin().body("{\"adr_id\":\"" + ADR + "\",\"sprint_id\":\"" + SPRINT + "\"}")
            .when().post("/lore/adr/link")
            .then().statusCode(200)
            .body("outcome", equalTo("created"))
            .body("ok", equalTo(true))          // старый ключ остался
            .body("action", equalTo("added"));  // и этот тоже — outcome добавлен РЯДОМ
    }

    /**
     * Повтор — {@code unchanged} БЕЗ причины отказа.
     *
     * <p>Раньше здесь приходило {@code linked:false} с подсказкой «проверьте,
     * что adr_id/sprint_id существуют», то есть законная идемпотентность
     * выглядела возможной ошибкой.
     */
    @Test
    @Order(3)
    void repeatIsUnchangedNotAFailure() {
        admin().body("{\"adr_id\":\"" + ADR + "\",\"sprint_id\":\"" + SPRINT + "\"}")
            .when().post("/lore/adr/link")
            .then().statusCode(200)
            .body("outcome", equalTo("unchanged"))
            .body("reason", equalTo(null));
    }

    /**
     * Несуществующий конец — {@code noop} С ПРИЧИНОЙ, называющей, чего не нашли.
     *
     * <p>Тот же ответ, что и у повтора, был бы худшим из исходов: настоящая
     * ошибка выглядела бы возможной нормой.
     */
    @Test
    @Order(4)
    void missingTargetIsNoopWithReason() {
        admin().body("{\"adr_id\":\"" + ADR + "\",\"sprint_id\":\"SPRINT_НЕТ_ТАКОГО\"}")
            .when().post("/lore/adr/link")
            .then().statusCode(200)
            .body("outcome", equalTo("noop"))
            .body("reason", containsString("SPRINT_НЕТ_ТАКОГО"));
    }

    @Test
    @Order(5)
    void removingAnExistingLinkIsDeleted() {
        admin().body("{\"adr_id\":\"" + ADR + "\",\"sprint_id\":\"" + SPRINT + "\",\"action\":\"remove\"}")
            .when().post("/lore/adr/link")
            .then().statusCode(200)
            .body("outcome", equalTo("deleted"));
    }

    /**
     * Снимать нечего — {@code unchanged}, а не «снято».
     *
     * <p>Это и есть смысл пробы ДО удаления: после него связи нет в обоих
     * случаях, и опечатка в идентификаторе читалась бы как успешная работа.
     */
    @Test
    @Order(6)
    void removingWhatIsNotThereIsUnchanged() {
        admin().body("{\"adr_id\":\"" + ADR + "\",\"sprint_id\":\"" + SPRINT + "\",\"action\":\"remove\"}")
            .when().post("/lore/adr/link")
            .then().statusCode(200)
            .body("outcome", equalTo("unchanged"));
    }
}
