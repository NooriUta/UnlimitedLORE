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

/**
 * Проект у сценария — ребром `BELONGS_TO_PROJECT` (D18/D22).
 *
 * <p>Слайсы слоя отдавали `projects` с PL-10, но ЗАПИСАТЬ проект было нечем:
 * у `uc_link` такого отношения не существовало. Поле в выдаче приходило пустым
 * всегда, и это читалось как «у сценариев нет проекта», а не как отсутствие
 * write-пути. При нескольких продуктах в одном корпусе сценарии разных
 * продуктов сливаются в один список — та же беда, что у одноимённых ролей
 * акторов без проекта.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreUcProjectLinkLiveDbTest {

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    @Test
    @Order(1)
    void setUp() {
        post("/lore/project", "{\"slug\":\"acme/prod\",\"name\":\"Продукт\"}");
        post("/lore/feature", "{\"feature_id\":\"FEAT-PROJ-1\",\"title\":\"корень с проектом\",\"goal_level\":\"cloud\"}");
        post("/lore/uc/link", "{\"uc_id\":\"FEAT-PROJ-1\",\"rel\":\"project\",\"target_id\":\"acme/prod\"}");
    }

    /** Слайс отдаёт проект, записанный ребром. */
    @Test
    @Order(2)
    void featureSliceReturnsLinkedProject() {
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/features")
        .then().statusCode(200)
            .body("rows.find { it.uc_id == 'FEAT-PROJ-1' }.projects", hasItem("acme/prod"));
    }

    /**
     * Несуществующий проект честно отдаёт {@code linked:false}.
     *
     * <p>`CREATE EDGE … TO (SELECT …)` над пустой выборкой создаёт ноль рёбер и
     * НЕ падает. Контракт link-путей слоя — не 400, а {@code linked} в ответе:
     * связывание идёт вместе с другими действиями, и отказ всего вызова из-за
     * одной непривязанной стороны потерял бы остальное. Проверяется именно
     * ЭТОТ флаг — «ok:true» без него был бы неотличим от успеха.
     */
    @Test
    @Order(3)
    void unknownProjectReportsNotLinked() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"uc_id\":\"FEAT-PROJ-1\",\"rel\":\"project\",\"target_id\":\"acme/nope\"}")
        .when().post("/lore/uc/link")
        .then().statusCode(200)
            .body("linked", org.hamcrest.Matchers.is(false));
    }
}
