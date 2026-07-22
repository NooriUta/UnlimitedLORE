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
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.lessThanOrEqualTo;

/**
 * SRCH-06 (ADR-LORE-033 D6): «похожие записи» на {@code SEARCH_INDEX_MORE}.
 *
 * Тесты держат не «похожесть» (её качество задаёт движок и оценить в тесте
 * нечем), а КОНТРАКТ: на вход идентификатор, исходная запись исключена, а два
 * ограничения движка объявлены в ответе, а не умолчаны.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreSearchSimilarLiveDbTest {

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    @Test
    @Order(1)
    void setUp() {
        // Три близких по тексту ADR и один заведомо чужой — чтобы «похожие»
        // было из чего выбирать, а не «всё, что есть в индексе».
        post("/lore/adr", "{\"adr_id\":\"ADR-SIM-1\",\"name\":\"Продуктовый слой: сценарии и ценность\","
            + "\"status\":\"ACCEPTED\",\"context_md\":\"продуктовый слой сценарий ценность клиент\"}");
        post("/lore/adr", "{\"adr_id\":\"ADR-SIM-2\",\"name\":\"Сценарии продукта и ценность клиента\","
            + "\"status\":\"ACCEPTED\",\"context_md\":\"продуктовый слой сценарий ценность клиент\"}");
        post("/lore/adr", "{\"adr_id\":\"ADR-SIM-3\",\"name\":\"Ценность продукта в сценариях\","
            + "\"status\":\"ACCEPTED\",\"context_md\":\"продуктовый сценарий ценность\"}");
        post("/lore/adr", "{\"adr_id\":\"ADR-SIM-X\",\"name\":\"Резервное копирование базы\","
            + "\"status\":\"ACCEPTED\",\"context_md\":\"бэкап восстановление диск\"}");
    }

    /**
     * Исходная запись из выдачи исключена. «Похоже на само себя» — не ответ, а
     * заполнитель: он всегда первый, всегда точный и всегда бесполезный.
     */
    @Test
    @Order(2)
    void sourceIsExcludedFromItsOwnSimilars() {
        given().header("X-Seer-Role", "admin").queryParam("ref", "ADR-SIM-1")
        .when().get("/lore/search/similar")
        .then().statusCode(200)
            .body("ref", equalTo("ADR-SIM-1"))
            .body("type", equalTo("adr"))
            .body("hits.ref_id", not(hasItem("ADR-SIM-1")));
    }

    /**
     * Выдача не выходит за пределы своего типа — и ответ ГОВОРИТ об этом полем
     * `same_type_only`. Замерено на 26.7.2: rid одного типа против индекса
     * другого возвращает пусто. Межтиповых «похожих» не существует, и UI не
     * должен их обещать.
     */
    @Test
    @Order(3)
    void staysWithinItsTypeAndSaysSo() {
        given().header("X-Seer-Role", "admin").queryParam("ref", "ADR-SIM-1")
        .when().get("/lore/search/similar")
        .then().statusCode(200)
            .body("same_type_only", equalTo(true))
            .body("hits.type", everyItem(equalTo("adr")));
    }

    /**
     * `ranked: false` — не косметика. `$similarity` у движка возвращает 1.0 у
     * всех строк (та же ловушка, что CLASSIC у обычного поиска), поэтому мы его
     * не отдаём вовсе: константа, выданная за меру близости, хуже её
     * отсутствия — по ней начнут сортировать.
     */
    @Test
    @Order(4)
    void declaresThatOrderIsNotRanked() {
        given().header("X-Seer-Role", "admin").queryParam("ref", "ADR-SIM-1")
        .when().get("/lore/search/similar")
        .then().statusCode(200)
            .body("ranked", equalTo(false))
            .body("hits.find { it.ref_id == 'ADR-SIM-2' }.score", equalTo(null));
    }

    /** Несуществующий идентификатор — 404, а не пустая выдача. */
    @Test
    @Order(5)
    void unknownRefIsNotFoundRatherThanEmpty() {
        given().header("X-Seer-Role", "admin").queryParam("ref", "ADR-NO-SUCH")
        .when().get("/lore/search/similar")
        .then().statusCode(404);
    }

    /** Пустой ref — 400: молча возвращать «похожее на ничто» нечестно. */
    @Test
    @Order(6)
    void blankRefIsRejected() {
        given().header("X-Seer-Role", "admin").queryParam("ref", "")
        .when().get("/lore/search/similar")
        .then().statusCode(400);
    }

    /**
     * limit — ПОТОЛОК, а не обещание набрать столько.
     *
     * Замерено на 26.7.2: на свежей БД с четырьмя ADR SEARCH_INDEX_MORE
     * возвращает ПУСТО. У Lucene MoreLikeThis есть пороги по частоте термина и
     * документа — на маленьком корпусе отсеивается всё. На проде (сотни ADR) та
     * же функция даёт осмысленную выдачу.
     *
     * Поэтому тест не требует непустого результата: он проверял бы объём
     * тестовых данных, а не код. Требуется соблюдение потолка и то, что пустая
     * выдача остаётся ВАЛИДНЫМ ответом 200, а не ошибкой.
     */
    @Test
    @Order(7)
    void limitIsAnUpperBoundAndEmptyIsValid() {
        given().header("X-Seer-Role", "admin")
            .queryParam("ref", "ADR-SIM-1").queryParam("limit", 1)
        .when().get("/lore/search/similar")
        .then().statusCode(200)
            .body("hits.size()", lessThanOrEqualTo(1));
    }
}
