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
import static org.hamcrest.Matchers.greaterThanOrEqualTo;

/**
 * Правка решения обязана появляться в ленте событием «изменено» (SE-02).
 *
 * <p><b>Что было сломано и почему это не поломка запроса.</b> Событие
 * «изменено» для решений строилось из типа {@code KnowDecisionHist}, который
 * СОЗДАЁТСЯ схемой, ЧИТАЕТСЯ одним срезом и не ПИШЕТСЯ никем: решение
 * намеренно живёт без истории (плоская модель, в коде так и написано —
 * «Decision stays vertex-only»). Строки в нём остались от прежней модели,
 * самая свежая — 14 июня.
 *
 * <p>Отказ был тихим ровно в нашем любимом смысле: лента НЕ пустела. События
 * создания шли, экран выглядел рабочим, и отсутствовало только то, чего
 * читатель не ждёт увидеть поимённо. Ни ошибки, ни признака обрезки.
 *
 * <p><b>Положительный контроль здесь встроен в порядок проверок.</b> Сначала
 * доказывается, что созданное решение в ленте ВИДНО, и только потом — что
 * правка добавляет отдельное событие. Без первой проверки красная вторая
 * означала бы что угодно, включая «лента вообще не отвечает».
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class DecisionEditShowsInNewsLiveDbTest {

    private static final String DECISION = "D-NEWS-EDIT-PROBE";
    /**
     * Дата создания В ПРОШЛОМ — и это не косметика.
     *
     * <p>Свёртка событий намеренно пропускает правку в ДЕНЬ СОЗДАНИЯ: тот день
     * уже покрыт событием «создано», и вторая строка об одном факте только
     * зашумила бы ленту. Так устроено и у ADR, и у спек.
     *
     * <p>Первая редакция теста создавала и правила решение сегодня — и ждала
     * «изменено», которого по этому правилу быть не может. Красный результат
     * был верным ответом на неверный вопрос: правка была права, тест — нет.
     */
    private static final String CREATED_ON = "2026-08-01";
    private static final String TITLE    = "Правка решения обязана быть видна";

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    /** Путь до событий этого решения в ответе ленты. */
    private static String itemsOfProbe(String event) {
        return "items.findAll { it.kind == 'decision' && it.ref?.id == '" + DECISION
             + "' && it.event == '" + event + "' }.size()";
    }

    @Test
    @Order(1)
    void aFreshDecisionShowsUpAsCreated() {
        admin().body("{\"decision_id\":\"" + DECISION + "\",\"title\":\"" + TITLE + "\","
                + "\"date_created\":\"" + CREATED_ON + "\","
                + "\"body_md\":\"Первая редакция.\",\"status\":\"proposed\"}")
            .when().post("/lore/decision").then().statusCode(200);

        given().when().get("/lore/news?days=3650&limit=5000")
            .then().statusCode(200)
            .body(itemsOfProbe("created"), greaterThanOrEqualTo(1));
    }

    /**
     * Правка даёт СВОЁ событие, отдельное от создания.
     *
     * <p>Проверяется именно наличие второго события, а не изменение первого:
     * «создано» и «изменено» отвечают на разные вопросы, и подмена одного
     * другим выглядела бы в ленте как будто правки не было вовсе.
     */
    @Test
    @Order(2)
    void anEditShowsUpAsChanged() {
        admin().body("{\"decision_id\":\"" + DECISION + "\",\"title\":\"" + TITLE + "\","
                + "\"body_md\":\"Вторая редакция — тело переписано.\"}")
            .when().post("/lore/decision").then().statusCode(200);

        given().when().get("/lore/news?days=3650&limit=5000")
            .then().statusCode(200)
            .body(itemsOfProbe("changed"), greaterThanOrEqualTo(1))
            .body(itemsOfProbe("created"), greaterThanOrEqualTo(1));
    }

    /**
     * Повторная правка В ТОТ ЖЕ ДЕНЬ не плодит вторую строку.
     *
     * <p>Свёртка по дню уже есть у ADR и спек, и решение обязано вести себя
     * так же: пять правок за день дали бы пять одинаковых строк, и лента
     * утонула бы в шуме — ровно то, ради чего свёртка и делалась.
     */
    @Test
    @Order(3)
    void aSecondEditTheSameDayDoesNotDuplicateTheEvent() {
        admin().body("{\"decision_id\":\"" + DECISION + "\",\"title\":\"" + TITLE + "\","
                + "\"body_md\":\"Третья редакция.\"}")
            .when().post("/lore/decision").then().statusCode(200);

        given().when().get("/lore/news?days=3650&limit=5000")
            .then().statusCode(200)
            .body(itemsOfProbe("changed"), equalTo(1));
    }
}
