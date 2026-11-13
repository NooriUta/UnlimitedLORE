package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.path.json.JsonPath;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_AS_CONFIG/MC-05 — SPEC-LORE-MODEL-CONFIG-STORE, «Готово, когда», на живой ArcadeDB:
 * модель из LORE совпадает с файлом-семенем; правка видна паспорту следующим запросом без рестарта;
 * несогласованная правка отвергнута и записи нет; устаревший hash — 409; откат возвращает прежнее.
 * Только CI.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreModelStoreLiveDbTest {

    static final String SPRINT = "SPRINT_MC05_STORE";

    static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    static JsonPath config() {
        return given().get("/lore/model/config").then().statusCode(200).extract().jsonPath();
    }

    static int versions() {
        List<?> rows = given().get("/lore/slice/model_config_history").then().statusCode(200).extract().jsonPath().getList("rows");
        return rows.size();
    }

    static io.restassured.response.Response put(String content, String reason, String expected) {
        return admin().body(Map.of("content", content, "reason", reason, "expected_hash", expected)).put("/lore/model/config");
    }

    static String sprintLabel() {
        return admin().get("/lore/record/sprint/" + SPRINT).then().statusCode(200).extract().jsonPath().getString("schema.label");
    }

    @AfterAll
    static void backToCanon() throws Exception {
        LoreModelFile.replace(LoreModelFile.parse(LoreModelLiveReplaceTest.canon()));
    }

    @Test
    @Order(1)
    void modelFromLoreEqualsTheSeedFile() throws Exception {
        admin().body("{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"" + SPRINT + "\"}").post("/lore/sprint/create").then().statusCode(200);
        JsonPath c = config();
        assertEquals(LoreModelStore.hashOf(LoreModelFile.render(LoreModelFile.parse(LoreModelLiveReplaceTest.canon()))), c.getString("hash"),
            "действующая модель = файл-семя (эталон MC-01 держит файл): " + c.getString("warning"));
        assertFalse(c.getBoolean("seed_drift"));
        assertEquals("Спринт", sprintLabel());
    }

    @Test
    @Order(2)
    void editIsSeenByPassportWithoutRestartAndOpensAVersion() throws Exception {
        int before = versions();
        String hash = config().getString("hash");
        String edited = LoreModelLiveReplaceTest.canon().replaceFirst("\"label\" : \"Спринт\"", "\"label\" : \"Спринт MC-05\"");
        JsonPath r = put(edited, "проверка MC-05: подпись типа", hash).then().statusCode(200).extract().jsonPath();
        assertEquals(List.of("sprint"), r.getList("types_changed"));
        assertEquals("Спринт MC-05", sprintLabel(), "паспорт видит правку следующим запросом — без рестарта");
        assertEquals(before + 1, versions(), "правка — новая версия в истории");
        assertEquals("lore", config().getString("source"));
        assertTrue(config().getBoolean("seed_drift"), "модель разошлась с файлом — это видно");
    }

    @Test
    @Order(3)
    void inconsistentEditIsRefusedAndNothingIsWritten() throws Exception {
        int before = versions();
        String hash = config().getString("hash");
        String broken = LoreModelLiveReplaceTest.canon().replaceFirst("\"slice\" : \"phases_of_sprint\"", "\"slice\" : \"нет_такого_среза\"");
        JsonPath r = put(broken, "ломаем нарочно", hash).then().statusCode(422).extract().jsonPath();
        assertEquals("MODEL_INCONSISTENT", r.getString("error"));
        assertTrue(r.getList("problems").toString().contains("нет_такого_среза"), r.getList("problems").toString());
        assertEquals(before, versions(), "отказ — записи нет");
        assertEquals("Спринт MC-05", sprintLabel(), "действующая модель не тронута");
    }

    @Test
    @Order(4)
    void staleHashIsAConflict() throws Exception {
        put(LoreModelLiveReplaceTest.canon(), "чужая устаревшая версия", "0000000000000000").then().statusCode(409);
    }

    @Test
    @Order(5)
    void rollbackRestoresThePreviousContent() throws Exception {
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rows = given().get("/lore/slice/model_config_history").then().statusCode(200).extract().jsonPath().getList("rows");
        String older = rows.stream().filter(x -> x.get("valid_to") != null).map(x -> String.valueOf(x.get("state_uid"))).findFirst().orElse(null);
        String content = older != null
            ? given().get("/lore/model/config/" + older).then().statusCode(200).extract().jsonPath().getString("content")
            : LoreModelLiveReplaceTest.canon();
        put(content, "откат проверки MC-05", config().getString("hash")).then().statusCode(200);
        assertEquals("Спринт", sprintLabel(), "откат вернул прежнюю подпись");
        assertFalse(config().getBoolean("seed_drift"));
    }
}
