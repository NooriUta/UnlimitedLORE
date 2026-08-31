package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;

/**
 * AN-07 (ADR-LORE-030 §2 срез A): карта нагрузки ролей из HAS_ACTOR (ADR-028).
 * Два сигнала: перегруз и мёртвая роль (0 UC). Разбивка primary/supporting —
 * по свойству role ребра (D19). Фильтр по проекту обязателен (D18): чужой
 * проект в выдачу попадать не должен — иначе одноимённые роли склеиваются.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreActorLoadLiveDbTest {

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    @Test
    void loadMapSplitsRolesAndRespectsProjectBoundary() {
        // AL-84: /lore/project требует superadmin — общий хелпер post() шлёт admin
        // для остальных семейств этого файла, здесь отдельные вызовы.
        for (String body : new String[]{"{\"slug\":\"TEST/proj-load\",\"name\":\"Проект нагрузки\"}", "{\"slug\":\"TEST/proj-other\",\"name\":\"Чужой проект\"}"}) {
            given().header("X-Seer-Role", "superadmin").contentType("application/json").body(body)
                .when().post("/lore/project").then().statusCode(200);
        }

        post("/lore/project-actor", "{\"actor_id\":\"ACT-LOAD-BUSY\",\"name\":\"Рабочая лошадь\","
            + "\"kind\":\"human-role\",\"project\":\"TEST/proj-load\"}");
        post("/lore/project-actor", "{\"actor_id\":\"ACT-LOAD-DEAD\",\"name\":\"Мёртвая роль\","
            + "\"kind\":\"human-role\",\"project\":\"TEST/proj-load\"}");
        post("/lore/project-actor", "{\"actor_id\":\"ACT-LOAD-ALIEN\",\"name\":\"Чужак\","
            + "\"kind\":\"human-role\",\"project\":\"TEST/proj-other\"}");

        post("/lore/feature", "{\"feature_id\":\"FEAT-LOAD\",\"title\":\"Фича нагрузки\"}");
        post("/lore/uc", "{\"uc_id\":\"UC-LOAD-1\",\"title\":\"Первый сценарий\","
            + "\"parent_uc_id\":\"FEAT-LOAD\",\"goal_level\":\"sea-level\"}");
        post("/lore/uc", "{\"uc_id\":\"UC-LOAD-2\",\"title\":\"Второй сценарий\","
            + "\"parent_uc_id\":\"FEAT-LOAD\",\"goal_level\":\"sea-level\"}");
        // Первый линк — primary по умолчанию (D19), второй — supporting явно.
        post("/lore/uc/link", "{\"uc_id\":\"UC-LOAD-1\",\"rel\":\"actor\",\"target_id\":\"ACT-LOAD-BUSY\"}");
        post("/lore/uc/link", "{\"uc_id\":\"UC-LOAD-2\",\"rel\":\"actor\",\"target_id\":\"ACT-LOAD-BUSY\","
            + "\"actor_role\":\"supporting\"}");

        given().when().get("/lore/slice/actor_load?project=TEST/proj-load")
        .then().statusCode(200)
            .body("rows.find { it.actor_id == 'ACT-LOAD-BUSY' }.uc_count", equalTo(2))
            .body("rows.find { it.actor_id == 'ACT-LOAD-BUSY' }.primary_count", equalTo(1))
            .body("rows.find { it.actor_id == 'ACT-LOAD-BUSY' }.supporting_count", equalTo(1))
            // Мёртвая роль видна с нулём, а не выпадает из карты.
            .body("rows.find { it.actor_id == 'ACT-LOAD-DEAD' }.uc_count", equalTo(0))
            // Граница проекта: чужак не склеивается в нашу карту (D18).
            .body("rows.find { it.actor_id == 'ACT-LOAD-ALIEN' }", nullValue())
            .body("rows.actor_id", not(hasItem("ACT-LOAD-ALIEN")));
    }
}
