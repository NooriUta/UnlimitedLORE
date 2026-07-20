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
 * AL-26: инвариант «closed ⇔ на вопрос есть ANSWERS» проверяется в ОБЕ стороны.
 *
 * <p><b>Что ломалось.</b> Постановка ребра ANSWERS корректно закрывала вопрос, а
 * снятие — оставляло его closed. Вопрос повисал закрытым без единого ответа, и
 * состояние графа врало: инвариант держался только на пути «закрыть».
 *
 * <p>Асимметрию не ловил ни один тест, потому что все проверки шли по счастливому
 * пути (поставили ребро → закрылось). Здесь проверяется именно обратный ход, и
 * отдельно — что снятие ОДНОГО из двух ответов оставляет вопрос закрытым: возврат
 * в open допустим только когда снят ПОСЛЕДНИЙ ответ.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreQuestionAnswersCycleLiveDbTest {

    private static final String QID = "OQ-TEST-ANSWERS-CYCLE";
    private static final String D1 = "DEC-TEST-ANSWERS-1";
    private static final String D2 = "DEC-TEST-ANSWERS-2";

    private static String questionStatus() {
        return given().header("X-Seer-Role", "admin")
            .when().get("/lore/slice/open_questions")
            .then().extract().jsonPath()
            .getString("rows.find { it.question_id == '" + QID + "' }?.status");
    }

    @Test
    @Order(1)
    void setup_openQuestionAndTwoDecisions() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(Map.of("question_id", QID, "title", "проба цикла ответов", "status", "open"))
        .when().post("/lore/question").then().statusCode(200);

        for (String d : new String[]{D1, D2}) {
            given().header("X-Seer-Role", "admin").contentType("application/json")
                .body(Map.of("decision_id", d, "title", "решение " + d))
            .when().post("/lore/decision").then().statusCode(200);
        }
    }

    @Test
    @Order(2)
    void answering_closesTheQuestion() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(Map.of("decision_id", D1, "question_id", QID, "action", "add"))
        .when().post("/lore/question/answers").then().statusCode(200);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(Map.of("decision_id", D2, "question_id", QID, "action", "add"))
        .when().post("/lore/question/answers").then().statusCode(200);
        // Вопрос ушёл из open_questions — значит closed. Slice отдаёт только открытые.
        org.junit.jupiter.api.Assertions.assertNull(questionStatus(),
            "два ответа — вопрос должен быть закрыт и уйти из open_questions");
    }

    @Test
    @Order(3)
    void removingOneOfTwo_keepsClosed() {
        // Снят один ответ, второй остался — вопрос закрыт по праву, в open не возвращается.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(Map.of("decision_id", D1, "question_id", QID, "action", "remove"))
        .when().post("/lore/question/answers").then().statusCode(200);
        org.junit.jupiter.api.Assertions.assertNull(questionStatus(),
            "остался один ответ — вопрос обязан оставаться закрытым");
    }

    @Test
    @Order(4)
    void removingLast_reopens() {
        // Снят ПОСЛЕДНИЙ ответ — инвариант обязан сработать в обратную сторону:
        // вопрос возвращается в open. Ровно это и не работало до AL-26.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body(Map.of("decision_id", D2, "question_id", QID, "action", "remove"))
        .when().post("/lore/question/answers").then().statusCode(200);
        org.junit.jupiter.api.Assertions.assertEquals("open", questionStatus(),
            "снят последний ответ — вопрос обязан вернуться в open, а не повиснуть closed");
    }
}
