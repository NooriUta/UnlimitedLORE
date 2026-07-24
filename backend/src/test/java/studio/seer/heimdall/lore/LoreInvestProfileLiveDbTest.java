package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.nullValue;

/**
 * AN-04 (ADR-LORE-030 §2 срез D): инвестиционный профиль возит СЫРЫЕ слим-факты —
 * GROUP BY на этой версии ArcadeDB молча группирует неверно (прецедент MartSlices),
 * поэтому доли uc/jtd/enb считает клиент. Слайс обязан отдать всё, что для этого
 * нужно: work_class (включая null), effort_days из открытой HAS_STATE (null =
 * строка попадёт в фолбэк «по штукам» и честно помечается), спринт и его релизы.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreInvestProfileLiveDbTest {

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    @Test
    void rawFactsCarryEverythingTheClientNeeds() {
        post("/lore/sprint/create", "{\"sprint_id\":\"SPRINT_INV_TEST\",\"name\":\"Спринт профиля\"}");
        post("/lore/task", "{\"sprint_id\":\"SPRINT_INV_TEST\",\"task_id\":\"INV-UC\","
            + "\"title\":\"Ценность\",\"work_class\":\"uc\"}");
        post("/lore/task", "{\"sprint_id\":\"SPRINT_INV_TEST\",\"task_id\":\"INV-JTD\","
            + "\"title\":\"Обвязка\",\"work_class\":\"jtd\"}");
        post("/lore/task", "{\"sprint_id\":\"SPRINT_INV_TEST\",\"task_id\":\"INV-RAW\","
            + "\"title\":\"Неклассифицированная\"}");
        // effort только у ценности — обвязка уйдёт в фолбэк «по штукам».
        post("/lore/task/edit", "{\"task_uid\":\"SPRINT_INV_TEST/INV-UC\","
            + "\"title\":\"Ценность\",\"effort_days\":0.5}");

        given().when().get("/lore/slice/invest_profile")
        .then().statusCode(200)
            .body("rows.find { it.task_uid == 'SPRINT_INV_TEST/INV-UC' }.work_class", equalTo("uc"))
            .body("rows.find { it.task_uid == 'SPRINT_INV_TEST/INV-UC' }.effort_days", equalTo(0.5f))
            .body("rows.find { it.task_uid == 'SPRINT_INV_TEST/INV-UC' }.sprint_id", equalTo("SPRINT_INV_TEST"))
            // Фолбэк-строка: класс есть, трудоёмкости нет — клиент обязан это видеть.
            .body("rows.find { it.task_uid == 'SPRINT_INV_TEST/INV-JTD' }.work_class", equalTo("jtd"))
            .body("rows.find { it.task_uid == 'SPRINT_INV_TEST/INV-JTD' }.effort_days", nullValue())
            // Неклассифицированное — легальная строка, не потеря.
            .body("rows.find { it.task_uid == 'SPRINT_INV_TEST/INV-RAW' }.work_class", nullValue());
    }
}
