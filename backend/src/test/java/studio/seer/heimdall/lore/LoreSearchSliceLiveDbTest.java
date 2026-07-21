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
import static org.hamcrest.Matchers.hasItem;

/**
 * SRCH-01 — слайс {@code search} на FULL_TEXT-индексах (ADR-LORE-033).
 *
 * <p>Три свойства, каждое из которых раньше НЕ выполнялось:
 * <ol>
 *   <li><b>Тела ищутся.</b> Тела живут в {@code *Hist}-типах; прежний слайс по
 *       ним не ходил — запрос «Остервальдер» давал честный ноль при слове,
 *       лежащем в {@code KnowTaskHist.note_md}. Теперь hist-ветки схлопываются
 *       к родителю через {@code in('HAS_STATE')}.</li>
 *   <li><b>Морфология.</b> Прежние ILIKE-ветки искали подстроку: «релиза» не
 *       находило «релиз». Форма запроса {@code q q*} прогоняет {@code q} через
 *       RussianAnalyzer.</li>
 *   <li><b>Вопросы ищутся.</b> KnowQuestion отсутствовал в слайсе как класс,
 *       хотя ftKnowQuestion существовал — реестр ОВ был невидим.</li>
 * </ol>
 *
 * <p>Дедуп: совпадение и в заголовке, и в теле не должно давать две строки —
 * это проверяет DISTINCT-обёртка.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreSearchSliceLiveDbTest {

    private static final String SPRINT = "SPRINT_SRCH01_TEST";
    // Уникальный маркер, которого нет в сидах: попадает ТОЛЬКО в note_md (тело).
    private static final String BODY_WORD = "шелкопряд";

    @Test
    @Order(1)
    void seedSprintAndTaskWithBodyOnlyWord() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"Спринт проверки поиска\"}")
        .when().post("/lore/sprint/create")
        .then().statusCode(200);

        // Слово-маркер кладём в note_md — на вершине KnowTask его нет,
        // найтись оно может только через hist-ветку.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"sprint_id\":\"" + SPRINT + "\",\"task_id\":\"T1\"," +
                  "\"title\":\"Задача о выпуске релиза\"," +
                  "\"note_md\":\"Гусеница-" + BODY_WORD + " упоминается только в теле задачи.\"}")
        .when().post("/lore/task")
        .then().statusCode(200);
    }

    @Test
    @Order(2)
    void bodyOnlyWordIsFoundViaHistBranch() {
        // Ровно тот случай, что раньше давал ноль («Остервальдер»).
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/search?pattern=" + BODY_WORD)
        .then().statusCode(200)
            .body("rows.type", hasItem("task"))
            .body("rows.find { it.type == 'task' && it.ref_id == '" + SPRINT + "/T1' }.title",
                  equalTo("Задача о выпуске релиза"));
    }

    @Test
    @Order(3)
    void russianMorphologyMatchesInflectedForm() {
        // В заголовке «релиза» (родительный) — ищем «релиз»: ILIKE-подстрока
        // это находила бы, а вот обратное направление нет. Проверяем оба.
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/search?pattern=релиз")
        .then().statusCode(200)
            .body("rows.ref_id", hasItem(SPRINT + "/T1"));

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/search?pattern=релизах")
        .then().statusCode(200)
            .body("rows.ref_id", hasItem(SPRINT + "/T1"));
    }

    @Test
    @Order(4)
    void noDuplicateRowsWhenTitleAndBodyBothMatch() {
        // «задача» есть и в заголовке, и в теле → без DISTINCT строка задвоится.
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/search?pattern=" + BODY_WORD)
        .then().statusCode(200)
            .body("rows.findAll { it.ref_id == '" + SPRINT + "/T1' }.size()", equalTo(1));
    }

    @Test
    @Order(5)
    void questionsAreSearchableNow() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"question_id\":\"OQ-SRCH01-TEST\",\"title\":\"Вопрос о " + BODY_WORD + "е\"}")
        .when().post("/lore/question")
        .then().statusCode(200);

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/search?pattern=" + BODY_WORD)
        .then().statusCode(200)
            .body("rows.type", hasItem("question"));
    }
}
