package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.path.json.JsonPath;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MODEL-TYPES — раздел types в /lore/model на живой
 * схеме: четыре типа, деловой ключ, ни одного @-поля в документе, missing без types.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreModelTypesLiveDbTest {

    @Test
    void modelCarriesTypesFromTheLiveSchema() {
        String body = given().header("X-Seer-Role", "admin").when().get("/lore/model").then().statusCode(200)
            .extract().asString();
        JsonPath m = new JsonPath(body);
        assertEquals(List.of("sprint", "task", "adr", "spec", "decision", "question"), List.copyOf(m.getMap("types").keySet()));
        assertEquals("task_uid", m.getString("types.task.key"));
        assertFalse(m.getList("missing").contains("types"), "раздел есть — в missing его нет: " + m.getList("missing"));
        assertFalse(body.contains("\"@rid\"") || body.contains("\"valid_to\"") || body.contains("\"state_uid\""),
            "system-поля в документе модели");
        assertTrue(m.getList("types.task.fields.findAll { it.source == 'CONFIRMS' }").size() > 0,
            "часть полей задачи подтверждена живой схемой");
    }
}
