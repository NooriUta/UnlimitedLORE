package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;

/**
 * PL-28 (решение №141): продуктовый слой — ОДИН тип с само-иерархией.
 *
 * Что тут доказывается и почему именно это. Слияние типов легко «сделать» так,
 * что схема новая, а поведение старое: корни не попадают в свой раздел,
 * иерархия замыкается в кольцо, поиск теряет половину тел. Каждый тест ниже
 * закрывает один такой способ соврать.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreFeatureMergeLiveDbTest {

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    /**
     * Тип KnowFeature обязан ОТСУТСТВОВАТЬ. Это не косметика: пока тип жив,
     * старые ветки поиска и слайсы продолжают его читать, и слияние существует
     * только на бумаге — данные тихо разъезжаются по двум местам.
     */
    @Test
    @Order(1)
    void featureTypeIsGone() {
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/features")
        .then().statusCode(200); // сам слайс жив и читает уже KnowUseCase

        post("/lore/feature", "{\"feature_id\":\"FEAT-M\",\"title\":\"Корень\","
            + "\"body_md\":\"ценность\",\"context_md\":\"большой контекст\"}");

        // Запись через /lore/feature легла в KnowUseCase — её видно слайсом
        // сценариев, а не только «фич». Если бы тип остался, тут был бы пусто.
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/search?q=FEAT-M")
        .then().statusCode(200)
            .body("hits.find { it.ref_id == 'FEAT-M' }.type", equalTo("use_case"));
    }

    /**
     * Корень отбирается по goal_level, и умолчание обязано быть проставлено.
     * Иначе фича, заведённая без явного уровня, исчезала бы из раздела «Фичи» —
     * запись прошла, ok:true, а на экране пусто.
     */
    @Test
    @Order(2)
    void rootGetsDefaultAltitudeAndAppearsInFeatures() {
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/features")
        .then().statusCode(200)
            .body("rows.find { it.uc_id == 'FEAT-M' }.goal_level", equalTo("cloud"))
            .body("rows.find { it.uc_id == 'FEAT-M' }.context_md", equalTo("большой контекст"));

        // Нижние ступени шкалы корнем быть не могут (ADR-032 §1) — иначе
        // «фича» и «сценарий» перестали бы различаться вовсе.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"feature_id\":\"FEAT-BAD\",\"goal_level\":\"sea-level\"}")
        .when().post("/lore/feature")
        .then().statusCode(400);
    }

    /**
     * Дети видны через ребро DECOMPOSES_INTO, а сами в список корней не лезут.
     * Обратное означало бы, что раздел «Фичи» показывает вперемешку всё подряд.
     */
    @Test
    @Order(3)
    void childrenHangOnTheRootAndStayOutOfRoots() {
        post("/lore/uc", "{\"uc_id\":\"UC-M-1\",\"title\":\"Сценарий\",\"parent_uc_id\":\"FEAT-M\","
            + "\"goal_level\":\"sea-level\"}");

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/use_cases_of_feature?id=FEAT-M")
        .then().statusCode(200)
            .body("rows.uc_id", hasItem("UC-M-1"))
            .body("rows.find { it.uc_id == 'UC-M-1' }.parent_uc_id", equalTo("FEAT-M"));

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/features")
        .then().statusCode(200)
            .body("rows.uc_id", not(hasItem("UC-M-1")))
            .body("rows.find { it.uc_id == 'FEAT-M' }.uc_total", equalTo(1))
            .body("rows.find { it.uc_id == 'FEAT-M' }.uc_shipped", equalTo(0));
    }

    /**
     * Цикл. До слияния «фича внутри своего сценария» была невозможна по
     * построению — типов было два. Один тип это разрешает, и без явной защиты
     * кольцо повесило бы обход слайса и вычислитель готовности, причём молча.
     */
    @Test
    @Order(4)
    void selfHierarchyRejectsCycles() {
        // Прямой самородитель.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"uc_id\":\"UC-M-1\",\"parent_uc_id\":\"UC-M-1\"}")
        .when().post("/lore/uc")
        .then().statusCode(400);

        // Косвенный: назначить корню родителем собственного потомка.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"uc_id\":\"FEAT-M\",\"parent_uc_id\":\"UC-M-1\"}")
        .when().post("/lore/uc")
        .then().statusCode(400);

        // Иерархия цела — отказ не оставил половинчатых правок.
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/use_cases_of_feature?id=FEAT-M")
        .then().statusCode(200).body("rows.uc_id", hasItem("UC-M-1"));
    }

    /**
     * Поиск. При слиянии индексов легко потерять половину охвата: body_md и
     * context_md жили у фичи, scenario_md — у сценария. Если ftKnowUseCase
     * останется со старым набором полей, контекст корня перестанет находиться,
     * и заметить это можно будет только руками.
     */
    @Test
    @Order(5)
    void searchCoversBothFormerBodies() {
        post("/lore/uc", "{\"uc_id\":\"UC-M-2\",\"title\":\"Сценарий поиска\",\"parent_uc_id\":\"FEAT-M\","
            + "\"goal_level\":\"sea-level\",\"scenario_md\":\"### Триггер\\nагентная выдача\"}");

        // Тело бывшей фичи.
        given().header("X-Seer-Role", "admin").queryParam("q", "контекст")
        .when().get("/lore/search")
        .then().statusCode(200).body("hits.ref_id", hasItem("FEAT-M"));

        // Тело бывшего UC — та же ветка, тот же индекс.
        given().header("X-Seer-Role", "admin").queryParam("q", "агентная")
        .when().get("/lore/search")
        .then().statusCode(200).body("hits.ref_id", hasItem("UC-M-2"));

        // Ветки feature больше нет: тип в фасетах не появляется, иначе один и
        // тот же документ считался бы дважды.
        given().header("X-Seer-Role", "admin").queryParam("q", "сценарий")
        .when().get("/lore/search")
        .then().statusCode(200)
            .body("facets.by_type.feature", nullValue())
            .body("hits.findAll { it.type == 'feature' }", empty());
    }
}
