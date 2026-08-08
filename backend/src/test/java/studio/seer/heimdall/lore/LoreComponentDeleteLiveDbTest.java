package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;

/**
 * AL-110 — component_del — единственный из `_del`-инструментов LORE с гейтом
 * ссылок, а не безусловным удалением (adr_del/doc_del удаляют без проверки —
 * их контракт прямо документирует это как «для тестовых артефактов»).
 *
 * <p>Оба состояния обязательны: без негативного кейса зелёный тест на пустом
 * компоненте ничего не доказывал бы про сам гейт — он мог бы удалять всегда,
 * просто в этом тесте нечему было бы помешать.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreComponentDeleteLiveDbTest {

    @Test
    void emptyComponentIsDeleted() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"component_id\":\"TEST-DEL-EMPTY\",\"full_name\":\"будет удалён\"}")
        .when().post("/lore/component/create")
        .then().statusCode(200);

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"component_id\":\"TEST-DEL-EMPTY\"}")
        .when().post("/lore/component/delete")
        .then().statusCode(200)
            .body("ok", org.hamcrest.Matchers.is(true));

        // Действительно снесён, а не просто ответил 200 — тот самый класс
        // подмены («ok:true», хотя рёбра/вершина остались), от которого
        // предостерегает вся линия FEAT-LORE-HONEST.
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/component?id=TEST-DEL-EMPTY")
        .then().statusCode(200)
            .body("rows", org.hamcrest.Matchers.hasSize(0));
    }

    @Test
    void componentWithChildIsNotDeleted() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"component_id\":\"TEST-DEL-PARENT\",\"full_name\":\"родитель\"}")
        .when().post("/lore/component/create")
        .then().statusCode(200);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"component_id\":\"TEST-DEL-CHILD\",\"full_name\":\"ребёнок\",\"parent_id\":\"TEST-DEL-PARENT\"}")
        .when().post("/lore/component/create")
        .then().statusCode(200);

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"component_id\":\"TEST-DEL-PARENT\"}")
        .when().post("/lore/component/delete")
        .then().statusCode(409)
            .body("detail", containsString("children"));

        // Родитель цел — отказ был реальным, не молчаливым частичным сносом.
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/component?id=TEST-DEL-PARENT")
        .then().statusCode(200)
            .body("rows", org.hamcrest.Matchers.hasSize(1));
    }

    @Test
    void componentReferencedByTaskIsNotDeleted() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"component_id\":\"TEST-DEL-USED\",\"full_name\":\"используется задачей\"}")
        .when().post("/lore/component/create")
        .then().statusCode(200);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"sprint_id\":\"SPRINT_TEST_DEL_USED\",\"name\":\"спринт для проверки гейта\"}")
        .when().post("/lore/sprint/create")
        .then().statusCode(200);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"sprint_id\":\"SPRINT_TEST_DEL_USED\",\"task_id\":\"T1\",\"title\":\"держит компонент\"}")
        .when().post("/lore/task")
        .then().statusCode(200);
        // TaskCreateRequest НЕ несёт component_id вовсе (только sprint_id/task_id/
        // title/note_md/phase_uid/*_agent/task_type/work_class/uc_id) — задача и
        // компонент связываются ОТДЕЛЬНЫМ вызовом, TAGGED_WITH-ребром, не полем.
        // Первая версия теста слала component_id прямо в /lore/task: Jackson тихо
        // отбросил незнакомое поле, задача создалась без единой связи с компонентом,
        // и гейт честно нашёл 0 — красный тест на пустом месте (MT-09 в профиль).
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"task_uid\":\"SPRINT_TEST_DEL_USED/T1\",\"component_id\":\"TEST-DEL-USED\"}")
        .when().post("/lore/task/component")
        .then().statusCode(200);

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"component_id\":\"TEST-DEL-USED\"}")
        .when().post("/lore/component/delete")
        .then().statusCode(409)
            .body("detail", containsString("tasks"));
    }
}
