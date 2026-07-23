package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.notNullValue;

/**
 * SRCH-10 (ADR-LORE-033): третья ось фасета и честные предупреждения.
 *
 * Два обещания ADR не выполнялись, и оба «работали» на вид:
 * <ul>
 *   <li>агрегата {@code by_project} не было — UI считал проекты по текущей
 *       странице, то есть счётчики врали за пределами первых 50 хитов, а
 *       серверный фильтр по проекту не задействовался вовсе;</li>
 *   <li>при падении ветки в {@code by_type} клался {@code -1} — и уходил в
 *       фасет КАК СЧЁТЧИК. Выдача выглядела полной, хотя часть корпуса не
 *       просматривалась.</li>
 * </ul>
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreSearchFacetsLiveDbTest {

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    @Test
    @Order(1)
    void setUp() {
        post("/lore/project", "{\"slug\":\"acme/alpha\",\"name\":\"Альфа\"}");
        post("/lore/project", "{\"slug\":\"acme/beta\",\"name\":\"Бета\"}");

        post("/lore/sprint/create", "{\"sprint_id\":\"SPRINT_FA\",\"name\":\"фасеты альфа контекст\"}");
        post("/lore/sprint/create", "{\"sprint_id\":\"SPRINT_FB\",\"name\":\"фасеты бета контекст\"}");
        post("/lore/sprint/project", "{\"sprint_id\":\"SPRINT_FA\",\"git_project\":\"acme/alpha\"}");
        post("/lore/sprint/project", "{\"sprint_id\":\"SPRINT_FB\",\"git_project\":\"acme/beta\"}");
        // Запись С КОМПОНЕНТОМ — иначе ось «компонент» нечем проверять.
        // Берём ADR: компонент задаётся прямо при создании. Отдельного эндпоинта
        // привязки компонента к спринту в API нет — первая редакция теста звала
        // `/lore/sprint/link`, которого не существует, и CI упал на 404.
        post("/lore/adr", "{\"adr_id\":\"ADR-FACET-1\",\"name\":\"фасеты и компонентная ось\","
            + "\"status\":\"ACCEPTED\",\"component_ids\":[\"OMILORE\"]}");
    }

    /**
     * Ось КОМПОНЕНТА считается — и это не дубль соседнего теста, а страховка от
     * того, КАК поломка пряталась.
     *
     * `by_component` был пуст всегда: агрегация читала `comp_direct`, тогда как
     * `queryBranch` уже переименовал поле в `components` (через shapeHit). Ось
     * не показывала ни одного чипа — фильтровать по компоненту было нечем.
     *
     * Не замечали потому, что СОСЕДНЯЯ ось работала: `by_project` добавился
     * позже и сразу читал новое имя. Проекты на экране были, и пустой
     * «компонент» читался как «у этих записей нет компонента», а не как отказ.
     *
     * Поэтому проверяется СВЯЗКА: если у хитов компоненты есть, агрегат обязан
     * быть непустым. Проверка «by_component != null» такую поломку пропустила
     * бы — пустая карта не null.
     */
    @Test
    @Order(2)
    void byComponentIsCountedWhenHitsHaveComponents() {
        var res = given().header("X-Seer-Role", "admin").queryParam("q", "фасеты")
            .when().get("/lore/search").then().statusCode(200).extract();

        java.util.List<java.util.List<String>> hitComps = res.path("hits.components");
        boolean anyHitHasComponent = hitComps != null
            && hitComps.stream().anyMatch(c -> c != null && !c.isEmpty());
        java.util.Map<String, Object> byComponent = res.path("by_component");

        assertNotNull(byComponent, "by_component обязан присутствовать всегда");
        if (anyHitHasComponent) {
            assertFalse(byComponent.isEmpty(),
                "у хитов есть компоненты, а агрегат пуст — ось не заполняется");
        }
    }

    /** Ось проекта приходит С СЕРВЕРА и считается по всей выборке ветки. */
    @Test
    @Order(2)
    void byProjectIsReturnedAndCounted() {
        given().header("X-Seer-Role", "admin").queryParam("q", "фасеты")
        .when().get("/lore/search")
        .then().statusCode(200)
            .body("by_project", notNullValue())
            .body("by_project.'acme/alpha'", greaterThan(0))
            .body("by_project.'acme/beta'", greaterThan(0));
    }

    /**
     * Фильтр по проекту отсекает НА СЕРВЕРЕ. Раньше он не отправлялся вовсе, и
     * UI выбрасывал уже загруженную страницу — то есть «фильтр» умел только
     * уменьшать видимое, но не расширять охват.
     */
    @Test
    @Order(3)
    void projectFilterCutsOnTheServer() {
        given().header("X-Seer-Role", "admin")
            .queryParam("q", "фасеты").queryParam("projects", "acme/alpha")
        .when().get("/lore/search")
        .then().statusCode(200)
            .body("hits.ref_id", hasItem("SPRINT_FA"))
            .body("hits.ref_id", not(hasItem("SPRINT_FB")));
    }

    /** Ось множественная — «два продукта из пяти» скаляром было не выбрать. */
    @Test
    @Order(4)
    void projectFilterAcceptsSeveralValues() {
        given().header("X-Seer-Role", "admin")
            .queryParam("q", "фасеты").queryParam("projects", "acme/alpha,acme/beta")
        .when().get("/lore/search")
        .then().statusCode(200)
            .body("hits.ref_id", hasItem("SPRINT_FA"))
            .body("hits.ref_id", hasItem("SPRINT_FB"));
    }

    /**
     * Ключ `warnings` присутствует ВСЕГДА — пустым списком. Потребителю не
     * приходится различать «поле не пришло» и «предупреждений нет».
     *
     * И главное: в `by_type` не должно быть отрицательных значений ни при
     * каких обстоятельствах. Счётчик отвечает на вопрос «сколько нашлось»;
     * «−1» — не ответ, а поломка, замаскированная под данные.
     */
    @Test
    @Order(5)
    void warningsAlwaysPresentAndCountsNeverNegative() {
        given().header("X-Seer-Role", "admin").queryParam("q", "фасеты")
        .when().get("/lore/search")
        .then().statusCode(200)
            .body("warnings", notNullValue())
            .body("warnings", empty())
            .body("by_type.values()", everyItem(greaterThan(-1)));
    }

    /** Неизвестный проект — пустая выдача, а не 500 и не игнор фильтра. */
    @Test
    @Order(6)
    void unknownProjectYieldsNothingRatherThanIgnoringTheFilter() {
        given().header("X-Seer-Role", "admin")
            .queryParam("q", "фасеты").queryParam("projects", "acme/no-such")
        .when().get("/lore/search")
        .then().statusCode(200)
            .body("hits", empty())
            .body("total_collected", equalTo(0));
    }
}
