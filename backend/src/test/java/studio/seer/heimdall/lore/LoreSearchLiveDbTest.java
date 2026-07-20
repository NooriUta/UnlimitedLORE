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
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;

/**
 * SRCH-05 — {@code GET /lore/search} на живой БД (ADR-LORE-033 D1–D5).
 *
 * <p>Проверяются ровно те свойства, которые НЕ проверить юнитом:
 * ранжирование (заголовок обгоняет тело через title-ветку против hist-ветки),
 * охват {@code *Hist} со схлопыванием к родителю, фасет-фильтр на уровне ветки
 * и наследование компонента задачей от спринта.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreSearchLiveDbTest {

    private static final String SPRINT = "SPRINT_SRCH05_TEST";
    // Маркер, которого нет в сидах; кириллица намеренная (ASCII-ловушки).
    private static final String WORD = "мангустин";

    @Test
    @Order(1)
    void seed() {
        // Компонент заводим ЯВНО, не полагаясь на LoreComponentSeeder: на свежей
        // тест-БД его @PostConstruct гонится со штормом DDL раннера миграций и
        // молча (warn) проигрывает — компонентов после boot может не быть вовсе.
        // Гонка зафиксирована находкой, тест от неё не зависит.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"component_id\":\"SRCH05C\",\"full_name\":\"Поисковый компонент\",\"area\":\"core\"}")
        .when().post("/lore/component/create").then().statusCode(200);

        // Спринт с компонентом SRCH05C — источник НАСЛЕДУЕМОГО компонента.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"Спринт про " + WORD + "\"}")
        .when().post("/lore/sprint/create").then().statusCode(200);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"sprint_id\":\"" + SPRINT + "\",\"component_id\":\"SRCH05C\"}")
        .when().post("/lore/sprint/component").then().statusCode(200);

        // Задача: маркер ТОЛЬКО в теле (note_md); прямых компонентов НЕТ —
        // компонент обязан вывестись от спринта.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"sprint_id\":\"" + SPRINT + "\",\"task_id\":\"T1\"," +
                  "\"title\":\"Обычная задача без маркера\"," +
                  "\"note_md\":\"В теле упоминается " + WORD + " — и только здесь.\"}")
        .when().post("/lore/task").then().statusCode(200);

        // Вопрос: маркер В ЗАГОЛОВКЕ — при равном BM25 заголовок должен
        // обогнать тело за счёт type_priority (question 1.0 > task 0.7).
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"question_id\":\"OQ-SRCH05-TEST\",\"title\":\"Что делать с " + WORD + "ом?\"}")
        .when().post("/lore/question").then().statusCode(200);
    }

    @Test
    @Order(2)
    void findsBodyViaHistAndTitleDirectly_titleOutranksBody() {
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/search?q=" + WORD)
        .then().statusCode(200)
            .body("hits.type", hasItem("task"))
            .body("hits.type", hasItem("question"))
            .body("took_ms", notNullValue())
            // Ранжирование: вопрос (маркер в заголовке, приоритет 1.0) выше
            // задачи (маркер в теле, приоритет 0.7).
            .body("hits[0].type", equalTo("question"))
            .body("by_type.task", greaterThan(0))
            .body("by_type.question", greaterThan(0));
    }

    @Test
    @Order(3)
    void taskInheritsComponentFromSprint() {
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/search?q=" + WORD + "&types=task")
        .then().statusCode(200)
            .body("hits[0].ref_id", equalTo(SPRINT + "/T1"))
            .body("hits[0].components", hasItem("SRCH05C"))
            .body("hits[0].inherited_from", equalTo("sprint"))
            .body("hits[0].snippet", notNullValue())
            .body("hits[0].matched_field", equalTo("note_md"));
    }

    @Test
    @Order(4)
    void componentFacetFiltersAtBranchLevel() {
        // Фильтр по SRCH05C: задача проходит (выведенный компонент),
        // вопрос — нет (компонентов не имеет вовсе).
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/search?q=" + WORD + "&components=SRCH05C")
        .then().statusCode(200)
            .body("hits.type", hasItem("task"))
            .body("hits.findAll { it.type == 'question' }.size()", equalTo(0));

        // Фильтр по несуществующему компоненту: пусто, а не «всё подряд».
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/search?q=" + WORD + "&components=NO_SUCH")
        .then().statusCode(200)
            .body("hits.size()", equalTo(0));
    }

    @Test
    @Order(5)
    void typesFacetLimitsBranches() {
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/search?q=" + WORD + "&types=question")
        .then().statusCode(200)
            .body("hits.findAll { it.type != 'question' }.size()", equalTo(0))
            .body("by_type.containsKey('task')", equalTo(false));
    }

    @Test
    @Order(6)
    void luceneMetacharactersAreNeutralized() {
        // queryParam, НЕ ручное %-кодирование в URL: RestAssured кодирует сам,
        // и «%2A» доехал бы до сервера литералом «%2A», а не звёздочкой.
        given().header("X-Seer-Role", "admin")
            .queryParam("q", WORD + "\"~*?\\")
        .when().get("/lore/search")
        .then().statusCode(200)
            .body("hits.type", hasItem("question"));

        // Запрос ТОЛЬКО из метасимволов — внятный 400, не 500.
        given().header("X-Seer-Role", "admin")
            .queryParam("q", "*?~")
        .when().get("/lore/search")
        .then().statusCode(400);
    }

    @Test
    @Order(7)
    void noBranchSilentlyFails() {
        // -1 в by_type = ветка упала (эндпоинт честно это показывает, а не
        // молчит). Ловит класс «SQL одной ветки не парсится»: так quality_gate
        // падала на вложенных скобках ILIKE-fallback'а, пока остальные 14
        // веток выглядели здоровыми.
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/search?q=" + WORD)
        .then().statusCode(200)
            .body("by_type.findAll { it.value == -1 }.size()", equalTo(0));
    }

    @Test
    @Order(8)
    void morphologyWorksInSmartMode() {
        // «мангустина» (родительный) — заголовок несёт «мангустин»/«мангустином».
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/search?q=" + WORD + "а&types=question")
        .then().statusCode(200)
            .body("hits.size()", greaterThan(0));
    }
}
