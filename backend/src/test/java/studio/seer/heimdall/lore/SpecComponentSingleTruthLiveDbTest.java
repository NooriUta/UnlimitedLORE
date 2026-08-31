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
import static org.hamcrest.Matchers.hasSize;

/**
 * Компонент спеки выражается ТРЕМЯ способами, и они расходятся (FIX-9).
 *
 * <p>Три представления одного факта:
 * <ul>
 *   <li>поле {@code KnowSpec.component_id};
 *   <li>ребро {@code DOCUMENTED_IN} компонент → спека — его пишет upsert спеки;
 *   <li>ребро {@code BELONGS_TO} спека → компонент — его пишет {@code spec/link}.
 * </ul>
 *
 * <p>Чтение берёт первое непустое: сперва {@code DOCUMENTED_IN}, потом
 * {@code BELONGS_TO}. Отсюда прямое следствие, которое и проверяется ниже:
 * СМЕНА компонента через {@code spec/link} отвечает успехом и НЕ МЕНЯЕТ
 * видимого, потому что старое ребро другого типа продолжает выигрывать.
 *
 * <p>Это не теория про модель, а неработающая операция: «перенеси спеку в
 * другой компонент» тихо не выполняется.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class SpecComponentSingleTruthLiveDbTest {

    private static final String SPEC = "SPEC-FIX9";
    private static final String COMP_A = "FIX9-A";
    private static final String COMP_B = "FIX9-B";

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    @Test
    @Order(1)
    void setUp() {
        for (String c : new String[]{COMP_A, COMP_B}) {
            admin().body("{\"component_id\":\"" + c + "\",\"full_name\":\"Компонент " + c + "\"}")
                .when().post("/lore/component/create").then().statusCode(200);
        }
        // Спека заводится СРАЗУ с компонентом — путь upsert (пишет DOCUMENTED_IN).
        admin().body("{\"spec_id\":\"" + SPEC + "\",\"title\":\"Спека про три правды\","
                + "\"component_id\":\"" + COMP_A + "\",\"content_md\":\"тело\"}")
            .when().post("/lore/spec").then().statusCode(200);

        given().when().get("/lore/slice/spec_by_id?id=" + SPEC)
            .then().statusCode(200)
            .body("rows[0].component_id", equalTo(COMP_A));
    }

    /**
     * СМЕНА компонента обязана быть видна чтением.
     *
     * <p>До правки здесь возвращался старый компонент: {@code spec/link} писал
     * {@code BELONGS_TO}, а чтение предпочитало оставшийся {@code DOCUMENTED_IN}
     * на прежний компонент. Ответ «ok» при невыполненной операции — ровно тот
     * дефект, против которого написан ADR-LORE-043.
     */
    @Test
    @Order(2)
    void movingTheSpecToAnotherComponentIsVisibleInReads() {
        admin().body("{\"spec_id\":\"" + SPEC + "\",\"rel\":\"component\",\"target_id\":\"" + COMP_B + "\"}")
            .when().post("/lore/spec/link").then().statusCode(200);

        given().when().get("/lore/slice/spec_by_id?id=" + SPEC)
            .then().statusCode(200)
            .body("rows[0].component_id", equalTo(COMP_B));
    }

    /**
     * И обратная сторона: спека обязана исчезнуть из списка ПРЕЖНЕГО компонента.
     *
     * <p>Иначе она числится сразу в двух — а «в двух местах» здесь означает не
     * богатство связей, а расхождение представлений.
     */
    @Test
    @Order(3)
    void theSpecLeavesTheOldComponentList() {
        given().when().get("/lore/slice/component?id=" + COMP_A)
            .then().statusCode(200)
            .body("rows[0].specs.findAll { it == '" + SPEC + "' }", hasSize(0));

        given().when().get("/lore/slice/component?id=" + COMP_B)
            .then().statusCode(200)
            .body("rows[0].specs.findAll { it == '" + SPEC + "' }", hasSize(1));
    }

    /**
     * Обратный ход тем же путём, которым спека заводилась: upsert с другим
     * компонентом. Он тоже обязан быть виден — иначе расхождение просто
     * поменяло направление.
     */
    @Test
    @Order(4)
    void upsertWithAnotherComponentIsAlsoVisible() {
        admin().body("{\"spec_id\":\"" + SPEC + "\",\"component_id\":\"" + COMP_A + "\"}")
            .when().post("/lore/spec").then().statusCode(200);

        given().when().get("/lore/slice/spec_by_id?id=" + SPEC)
            .then().statusCode(200)
            .body("rows[0].component_id", equalTo(COMP_A));
        given().when().get("/lore/slice/component?id=" + COMP_B)
            .then().statusCode(200)
            .body("rows[0].specs.findAll { it == '" + SPEC + "' }", hasSize(0));
    }
}
