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
import static org.hamcrest.Matchers.not;

/**
 * PL-10 (D14/D18): кросс-привязки продуктового слоя.
 *
 * Ядро ценности слоя — тройка «роль × компонент × сценарий», из которой
 * выводится RBAC-матрица. До этой задачи тройка вырождалась: компонент брался
 * только у корня (значит все его дочерние сценарии считались одним модулем), а
 * актор был глобальным (значит одноимённые роли разных продуктов склеивались).
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreCrossLinksLiveDbTest {

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    @Test
    @Order(1)
    void setUp() {
        post("/lore/project", "{\"slug\":\"acme/one\",\"name\":\"Первый продукт\"}");
        post("/lore/project", "{\"slug\":\"acme/two\",\"name\":\"Второй продукт\"}");
        // Компоненты заводим свои, а не полагаемся на сид: сидер компонентов
        // гоняется на старте и на изолированной БД может не успеть/упасть
        // (MIG-31 — гонка сидера с DDL раннера). Тест не должен зависеть от
        // порядка стартовых задач — иначе он будет мигать без причины.
        post("/lore/component/create", "{\"component_id\":\"CL-BACK\",\"full_name\":\"Бэкенд\",\"area\":\"core\"}");
        post("/lore/component/create", "{\"component_id\":\"CL-FRONT\",\"full_name\":\"Фронт\",\"area\":\"core\"}");
        post("/lore/feature", "{\"feature_id\":\"FEAT-CL\",\"title\":\"Корень\"}");
        post("/lore/uc", "{\"uc_id\":\"UC-CL-1\",\"title\":\"Сценарий\",\"parent_uc_id\":\"FEAT-CL\","
            + "\"goal_level\":\"sea-level\"}");
    }

    /**
     * Компонент вешается на сценарий НАПРЯМУЮ. Пока это было возможно только
     * через родителя, весь его поддерев считался принадлежащим одному модулю —
     * и «какой компонент реализует этот сценарий» отвечалось неверно для всех
     * сценариев, кроме случайно совпавших с корнем.
     */
    @Test
    @Order(2)
    void ucCarriesItsOwnComponentSeparatelyFromInherited() {
        post("/lore/feature/link", "{\"feature_id\":\"FEAT-CL\",\"rel\":\"component\",\"target_id\":\"CL-BACK\"}");
        post("/lore/uc/link", "{\"uc_id\":\"UC-CL-1\",\"rel\":\"component\",\"target_id\":\"CL-FRONT\"}");

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/use_cases_of_feature?id=FEAT-CL")
        .then().statusCode(200)
            // Свой компонент — свой.
            .body("rows.find { it.uc_id == 'UC-CL-1' }.component_ids", hasItem("CL-FRONT"))
            // Унаследованный отдаётся ОТДЕЛЬНЫМ полем: склеив их в один список,
            // мы бы не отличили «сценарий про фронт» от «сценарий внутри
            // бэкендового корня», и тройка RBAC соврала бы.
            .body("rows.find { it.uc_id == 'UC-CL-1' }.inherited_component_ids", hasItem("CL-BACK"))
            .body("rows.find { it.uc_id == 'UC-CL-1' }.component_ids", not(hasItem("CL-BACK")));
    }

    /** Снятие связки работает — иначе «привязать» было бы односторонней дверью. */
    @Test
    @Order(3)
    void componentLinkIsRemovable() {
        post("/lore/uc/link", "{\"uc_id\":\"UC-CL-1\",\"rel\":\"component\",\"target_id\":\"CL-FRONT\","
            + "\"action\":\"remove\"}");

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/use_cases_of_feature?id=FEAT-CL")
        .then().statusCode(200)
            .body("rows.find { it.uc_id == 'UC-CL-1' }.component_ids", not(hasItem("CL-FRONT")));
    }

    /**
     * D18: актор принадлежит проекту. Две одноимённые роли разных продуктов
     * обязаны различаться — иначе выводимая RBAC-матрица склеит их в одну
     * строку и выдаст права одного продукта носителю роли в другом.
     */
    @Test
    @Order(4)
    void actorsAreScopedToTheirProject() {
        post("/lore/actor", "{\"actor_id\":\"ACT-ONE-ADMIN\",\"name\":\"Администратор\","
            + "\"kind\":\"human-role\",\"project\":\"acme/one\"}");
        post("/lore/actor", "{\"actor_id\":\"ACT-TWO-ADMIN\",\"name\":\"Администратор\","
            + "\"kind\":\"human-role\",\"project\":\"acme/two\"}");

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/actors")
        .then().statusCode(200)
            .body("rows.find { it.actor_id == 'ACT-ONE-ADMIN' }.projects", hasItem("acme/one"))
            .body("rows.find { it.actor_id == 'ACT-ONE-ADMIN' }.projects", not(hasItem("acme/two")))
            .body("rows.find { it.actor_id == 'ACT-TWO-ADMIN' }.projects", hasItem("acme/two"));
    }

    /**
     * Незарегистрированный проект — честный `project_linked:false`, а не
     * молчаливый успех: CREATE EDGE в пустой TO ничего не делает, и без этого
     * ответа актор остался бы без проекта при `ok:true`.
     */
    @Test
    @Order(5)
    void unknownProjectIsSurfacedNotSwallowed() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"actor_id\":\"ACT-ORPHAN\",\"name\":\"Сирота\",\"project\":\"acme/no-such\"}")
        .when().post("/lore/actor")
        .then().statusCode(200)
            .body("ok", equalTo(true))
            .body("project_linked", equalTo(false));
    }

    /** Проектная ось видна и у корня — фильтровать слой по продукту можно сверху. */
    @Test
    @Order(6)
    void rootsExposeComponentsAndProjects() {
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/features")
        .then().statusCode(200)
            .body("rows.find { it.uc_id == 'FEAT-CL' }.component_ids", hasItem("CL-BACK"));
    }
}
