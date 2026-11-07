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
 * AN-02 (ADR-LORE-030 §2 срез E): слайс product_hygiene обязан ЛОВИТЬ каждый из
 * четырёх типов нарушений связок D16/D5 — и переставать ловить, когда связка
 * замкнута. Пока срез не ноль, остальная аналитика (fit/покрытие/динамика) врёт,
 * поэтому это первая очередь спринта аналитики.
 *
 * Кириллица в заголовках намеренно: ловушка `\w` vs `\p{L}` уже кусала (SRCH-04).
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreProductHygieneLiveDbTest {

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    @Test
    @Order(1)
    void everyViolationKindIsCaught() {
        post("/lore/sprint/create", "{\"sprint_id\":\"SPRINT_HYG_TEST\",\"name\":\"Спринт гигиены\"}");
        // 1. uc-задача без REALIZES.
        post("/lore/task", "{\"sprint_id\":\"SPRINT_HYG_TEST\",\"task_id\":\"HYG-UC\","
            + "\"title\":\"Сценарная задача без ребра\",\"work_class\":\"uc\"}");
        // 2. enb-задача без JUSTIFIED_BY.
        post("/lore/task", "{\"sprint_id\":\"SPRINT_HYG_TEST\",\"task_id\":\"HYG-ENB\","
            + "\"title\":\"Энейблер без обоснования\",\"work_class\":\"enb\"}");
        // 3. Сценарий (sea-level) без acceptance_md.
        post("/lore/feature", "{\"feature_id\":\"FEAT-HYG\",\"title\":\"Фича гигиены\"}");
        post("/lore/uc", "{\"uc_id\":\"UC-HYG-NOACC\",\"title\":\"Сценарий без приёмки\","
            + "\"parent_uc_id\":\"FEAT-HYG\",\"goal_level\":\"sea-level\"}");
        // 4. Боль, которую ничто не снимает.
        post("/lore/pain", "{\"pain_id\":\"PAIN-HYG-COLD\",\"title\":\"Боль без обезболивающего\","
            + "\"severity\":\"high\"}");

        given().when().get("/lore/slice/product_hygiene")
        .then().statusCode(200)
            .body("rows.findAll { it.finding == 'uc_task_without_realizes' }.ref_id",
                hasItem("SPRINT_HYG_TEST/HYG-UC"))
            .body("rows.findAll { it.finding == 'enb_task_without_justification' }.ref_id",
                hasItem("SPRINT_HYG_TEST/HYG-ENB"))
            .body("rows.findAll { it.finding == 'uc_without_acceptance' }.ref_id",
                hasItem("UC-HYG-NOACC"))
            .body("rows.findAll { it.finding == 'pain_without_relief' }.ref_id",
                hasItem("PAIN-HYG-COLD"))
            // Задачные находки несут спринт — это и есть «ссылка на сущность».
            .body("rows.find { it.ref_id == 'SPRINT_HYG_TEST/HYG-UC' }.sprint_id",
                equalTo("SPRINT_HYG_TEST"));
    }

    @Test
    @Order(2)
    void closedLinkLeavesTheReport() {
        // Замыкаем ровно одну связку: UC снимает боль → находка pain_without_relief
        // обязана исчезнуть, остальные три — остаться (проверка точечности).
        post("/lore/uc/link", "{\"uc_id\":\"UC-HYG-NOACC\",\"rel\":\"relieves\","
            + "\"target_id\":\"PAIN-HYG-COLD\"}");

        given().when().get("/lore/slice/product_hygiene")
        .then().statusCode(200)
            .body("rows.findAll { it.finding == 'pain_without_relief' }.ref_id",
                not(hasItem("PAIN-HYG-COLD")))
            .body("rows.findAll { it.finding == 'uc_task_without_realizes' }.ref_id",
                hasItem("SPRINT_HYG_TEST/HYG-UC"))
            .body("rows.findAll { it.finding == 'uc_without_acceptance' }.ref_id",
                hasItem("UC-HYG-NOACC"));
    }

    /**
     * WK-02 (decision:D-2026-LORE-PRODUCT-PROJECT-ROLE): у связи продукт → проект
     * есть роль. Смена роли — «updated» с прежней ролью, повтор — «unchanged»,
     * срез products отдаёт роль рядом со слагом, размеченная связь в гигиену
     * (product_project_without_role) не попадает — и сам срез с новой веткой жив.
     */
    @Test
    @Order(3)
    void productProjectLinkCarriesRole() {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"slug\":\"HygTest/wk02-repo\"}")
        .when().post("/lore/project").then().statusCode(200);
        post("/lore/dict/entry", "{\"dict_type\":\"product\",\"code\":\"WK02TEST\",\"label_ru\":\"Продукт WK-02\"}");

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"product_code\":\"WK02TEST\",\"rel\":\"project\",\"target_id\":\"HygTest/wk02-repo\",\"role\":\"consumer\"}")
        .when().post("/lore/product/link").then().statusCode(200)
            .body("outcome", equalTo("created")).body("role", equalTo("consumer"));
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"product_code\":\"WK02TEST\",\"rel\":\"project\",\"target_id\":\"HygTest/wk02-repo\",\"role\":\"owner\"}")
        .when().post("/lore/product/link").then().statusCode(200)
            .body("outcome", equalTo("updated")).body("previous_role", equalTo("consumer"));
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"product_code\":\"WK02TEST\",\"rel\":\"project\",\"target_id\":\"HygTest/wk02-repo\",\"role\":\"owner\"}")
        .when().post("/lore/product/link").then().statusCode(200)
            .body("outcome", equalTo("unchanged"));

        given().when().get("/lore/slice/products")
        .then().statusCode(200)
            .body("rows.find { it.code == 'WK02TEST' }.git_projects", hasItem("HygTest/wk02-repo"))
            .body("rows.find { it.code == 'WK02TEST' }.git_project_roles", hasItem("owner"));

        given().when().get("/lore/slice/product_hygiene")
        .then().statusCode(200)
            .body("rows.findAll { it.finding == 'product_project_without_role' }.ref_id", not(hasItem("WK02TEST")));
    }
}
