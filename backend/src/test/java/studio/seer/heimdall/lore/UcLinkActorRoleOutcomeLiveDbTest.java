package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.path.json.JsonPath;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * MT-12: {@code uc_link(rel=actor, actor_role=…)} на УЖЕ существующем ребре
 * меняет роль, а отвечал «unchanged» с подсказкой «повторять вызов не нужно».
 *
 * <p>Исход считался только по созданию ребра; {@code UPDATE HAS_ACTOR SET role}
 * в него не попадал. Читатель решал, что роль уже была такой, и не узнавал,
 * что это он её только что поставил — а при ошибочном вызове не узнавал, что
 * переназначил primary. Тот же класс, что «ok:true при несделанной работе»,
 * только наоборот: «ничего не изменилось» при изменении.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class UcLinkActorRoleOutcomeLiveDbTest {

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    private static JsonPath link(String actor, String role) {
        String r = role == null ? "" : ",\"actor_role\":\"" + role + "\"";
        return given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"uc_id\":\"UC-MT12\",\"rel\":\"actor\",\"target_id\":\"" + actor + "\"" + r + "}")
            .when().post("/lore/uc/link").then().statusCode(200).extract().jsonPath();
    }

    @Test
    void roleChangeOnExistingEdgeIsReportedAsUpdated() {
        post("/lore/project-actor", "{\"actor_id\":\"ACT-MT12-A\",\"name\":\"Роль А\",\"kind\":\"human-role\"}");
        post("/lore/project-actor", "{\"actor_id\":\"ACT-MT12-B\",\"name\":\"Роль Б\",\"kind\":\"human-role\"}");
        post("/lore/feature", "{\"feature_id\":\"FEAT-MT12\",\"title\":\"Фича MT-12\"}");
        post("/lore/uc", "{\"uc_id\":\"UC-MT12\",\"title\":\"Сценарий MT-12\","
            + "\"parent_uc_id\":\"FEAT-MT12\",\"goal_level\":\"sea-level\"}");

        // Свежие рёбра: первый актор — primary по умолчанию, второй — supporting.
        assertEquals("created", link("ACT-MT12-A", null).getString("outcome"));
        assertEquals("created", link("ACT-MT12-B", null).getString("outcome"));

        // Существующее ребро, роль меняется → updated, с прежней и новой ролью.
        JsonPath changed = link("ACT-MT12-B", "primary");
        assertEquals("updated", changed.getString("outcome"),
            "роль сменилась supporting → primary, а исход не 'updated': " + changed.prettify());
        assertEquals("supporting", changed.getString("role_before"));
        assertEquals("primary", changed.getString("role_after"));
        assertNull(changed.get("hint"), "подсказка «повторять не нужно» при изменении — ложь");

        // Повтор того же вызова — роль уже такая: законный unchanged.
        assertEquals("unchanged", link("ACT-MT12-B", "primary").getString("outcome"));
        // Без actor_role существующее ребро не трогается — тоже unchanged.
        // Сюда ловился второй дефект: CREATE EDGE IF NOT EXISTS на повторе
        // отдаёт строку существующего ребра, оно принималось за свежее, и
        // роль молча сбрасывалась на дефолт — у А primary → supporting,
        // потому что primary в сценарии уже есть (Б).
        assertEquals("unchanged", link("ACT-MT12-A", null).getString("outcome"));
        // Роль А и правда осталась primary: явный primary ничего не меняет.
        assertEquals("unchanged", link("ACT-MT12-A", "primary").getString("outcome"),
            "повторная привязка без роли переписала роль существующего ребра");
    }
}
