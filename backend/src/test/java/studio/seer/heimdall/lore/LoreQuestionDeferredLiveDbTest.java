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
import static org.hamcrest.Matchers.equalTo;

/**
 * Жизненный цикл ОВ open→deferred (ADR-LORE-021 D1/D3) на живой БД.
 *
 * <p><b>Зачем этот тест существует.</b> Половина цикла не работала НИКОГДА и это
 * не замечали, потому что её ничто не проверяло. Поле {@code trigger} —
 * зарезервированное слово SQL ArcadeDB, и запись шла голым именем:
 *
 * <pre>
 *   CommandSQLParsingException: mismatched input ',' … trigger=:trig
 * </pre>
 *
 * Получался замкнутый круг: D3 запрещает {@code deferred} без непустого
 * триггера, а записать триггер было нельзя — запрос не парсился. На 2026-07-19
 * вопросов с заполненным {@code trigger} в корпусе было НОЛЬ, то есть переход
 * из D1 существовал только на бумаге.
 *
 * <p>Проверяется именно то, что ломалось: триггер доезжает до БД и читается
 * обратно. Проверка «отбивается ли deferred без триггера» ловит валидацию, но
 * НЕ поймала бы этот баг — она отрабатывала до SQL и всегда проходила.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreQuestionDeferredLiveDbTest {

    private static final String QID = "OQ-TEST-DEFERRED";
    private static final String TRIG = "Когда наберётся статистика по обходам";

    @Test
    @Order(1)
    void deferredRequiresNonEmptyTrigger() {
        // D3: отложенное без условия возврата — это свалка, а не отложенное.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(Map.of("question_id", QID, "title", "проба цикла", "status", "deferred"))
        .when().post("/lore/question")
        .then().statusCode(400);
    }

    @Test
    @Order(2)
    void deferredWithTriggerIsAcceptedAndPersisted() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(Map.of("question_id", QID, "title", "проба цикла",
                         "status", "deferred", "trigger", TRIG))
        .when().post("/lore/question")
        .then().statusCode(200).body("ok", equalTo(true));
    }

    @Test
    @Order(3)
    void triggerSurvivesRoundTrip() {
        // Ровно то место, где ломался парсер: значение обязано доехать до БД И
        // вернуться читателю. Кириллица намеренная — она же ловит ASCII-ловушки
        // whitelist'а. Проверять только статус недостаточно: без условия
        // возврата отложенный вопрос неотличим от забытого (D3).
        // Слайс отдаёт {"rows":[…]}, а не голый массив — find{} идёт по rows.
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/open_questions")
        .then().statusCode(200)
            .body("rows.find { it.question_id == '" + QID + "' }.status", equalTo("deferred"))
            .body("rows.find { it.question_id == '" + QID + "' }.trigger", equalTo(TRIG));
    }

    @Test
    @Order(4)
    void closedCannotBeSetByHand() {
        // Соседний инвариант того же write-path (D3): closed — следствие ANSWERS.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(Map.of("question_id", QID, "status", "closed"))
        .when().post("/lore/question")
        .then().statusCode(400);
    }
}
