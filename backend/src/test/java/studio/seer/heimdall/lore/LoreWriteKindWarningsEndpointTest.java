package studio.seer.heimdall.lore;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.nullValue;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-06 · предупреждение о виде значения доходит до ответа записи, а тело
 * запроса после проверки доходит до ресурса целым.
 *
 * <p>Без живой базы: недопустимый код спринта ресурс отвергает до первого обращения к базе
 * (как в {@link LoreWritePathValidationTest}). То, что ответ — именно «недопустимые символы», а не
 * «sprint_id required», и доказывает, что фильтр прочитал тело и вернул его ресурсу.
 */
@QuarkusTest
class LoreWriteKindWarningsEndpointTest {

    static final String ILLEGAL = "bad id!";

    @Test
    void stringInNumberFieldComesBackAsWarning() {
        given()
            .header("X-Seer-Role", "admin")
            .contentType("application/json")
            .body("{\"sprint_id\":\"" + ILLEGAL + "\",\"task_id\":\"T01\",\"title\":\"x\",\"effort_days\":\"2\"}")
        .when()
            .post("/lore/task")
        .then()
            .statusCode(400)
            .body("error", equalTo("BAD_PARAMS"))
            .body("detail", equalTo("sprint_id / task_id contain illegal characters"))
            .body("warnings.field", hasItem("effort_days"))
            .body("warnings.code", hasItem("FIELD_KIND_MISMATCH"));
    }

    @Test
    void dateNotInFormatComesBackAsWarning() {
        given()
            .header("X-Seer-Role", "admin")
            .contentType("application/json")
            .body("{\"sprint_id\":\"" + ILLEGAL + "\",\"planned_start_date\":\"15.11.2026\"}")
        .when()
            .post("/lore/sprint/plan")
        .then()
            .statusCode(400)
            .body("detail", equalTo("sprint_id contains illegal characters"))
            .body("warnings.field", hasItem("planned_start_date"));
    }

    @Test
    void rightValuesGiveNoWarnings() {
        given()
            .header("X-Seer-Role", "admin")
            .contentType("application/json")
            .body("{\"sprint_id\":\"" + ILLEGAL + "\",\"task_id\":\"T01\",\"title\":\"x\",\"effort_days\":2}")
        .when()
            .post("/lore/task")
        .then()
            .statusCode(400)
            .body("detail", equalTo("sprint_id / task_id contain illegal characters"))
            .body("warnings", nullValue());
    }
}
