package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;

/**
 * PL-34: перепривязка спеки к другому компоненту — РЕБРОМ.
 *
 * <p>Почему понадобился отдельный эндпоинт. {@code /lore/spec} пишет
 * {@code component_id} полем вершины, а слайс {@code specs} читает привязку
 * через ребро {@code BELONGS_TO}. Поэтому «сменить компонент» через
 * {@code spec_set} возвращало {@code ok: true} и не меняло НИЧЕГО видимого:
 * поле новое, ребро старое, спека по-прежнему в списке прежнего компонента.
 * Ровно так и не удавалось перевезти {@code LORE_DB_SPEC} с LORE на OMILORE.
 *
 * <p>Поэтому оба теста проверяют ФАКТ в слайсе, а не код возврата — и второй
 * из них про то, что несуществующий компонент обязан быть ОТКАЗОМ:
 * {@code CREATE EDGE … TO (SELECT …)} с пустой выборкой создаёт ноль рёбер и
 * не падает, так что «успех» тут — самая правдоподобная форма поломки.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreSpecLinkLiveDbTest {

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    @Test
    @Order(1)
    void setUp() {
        post("/lore/component/create", "{\"component_id\":\"SL_FROM\",\"full_name\":\"Откуда\"}");
        post("/lore/component/create", "{\"component_id\":\"SL_TO\",\"full_name\":\"Куда\"}");
        post("/lore/spec", "{\"spec_id\":\"SPEC_LINK_T\",\"title\":\"перепривязка\","
            + "\"component_id\":\"SL_FROM\"}");
        post("/lore/spec/link",
            "{\"spec_id\":\"SPEC_LINK_T\",\"rel\":\"component\",\"target_id\":\"SL_FROM\"}");
    }

    /**
     * После перепривязки спека видна ТОЛЬКО у нового компонента.
     *
     * <p>Проверка «появилась у SL_TO» одна поймала бы не всё: при {@code add}
     * она тоже появится, оставшись у SL_FROM, и спека числилась бы сразу у
     * двух владельцев. Отрицательная половина — существенная.
     */
    @Test
    @Order(2)
    void rebindMovesSpecAndLeavesNoTrailBehind() {
        post("/lore/spec/link",
            "{\"spec_id\":\"SPEC_LINK_T\",\"rel\":\"component\",\"target_id\":\"SL_TO\"}");

        given().header("X-Seer-Role", "admin").queryParam("component", "SL_TO")
        .when().get("/lore/slice/specs")
        .then().statusCode(200).body("rows.spec_id", hasItem("SPEC_LINK_T"));

        given().header("X-Seer-Role", "admin").queryParam("component", "SL_FROM")
        .when().get("/lore/slice/specs")
        .then().statusCode(200).body("rows.spec_id", not(hasItem("SPEC_LINK_T")));
    }

    /** Несуществующий компонент — 404, а не тихий {@code ok:true} без ребра. */
    @Test
    @Order(3)
    void unknownTargetIsRefusedRatherThanSilentlyAccepted() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"spec_id\":\"SPEC_LINK_T\",\"rel\":\"component\",\"target_id\":\"SL_NOPE\"}")
        .when().post("/lore/spec/link")
        .then().statusCode(404);
    }
}
