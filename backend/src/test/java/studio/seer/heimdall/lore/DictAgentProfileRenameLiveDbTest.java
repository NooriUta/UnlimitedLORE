package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.hasItem;
import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * SE-06 / V48 (D-2026-LORE-AGENT-ROLE-DICT-IS-PROFILE): справочник agent_role
 * хранит ПРОФИЛИ агентов и переименовывается в agent_profile с сохранением кодов
 * — и записи, и её истории (история связана с записью парой dict_type+code, а не
 * ключом, поэтому переносится тоже).
 *
 * <p>Проверка чтением из БД и через срез, а не по отсутствию ошибки: UPDATE,
 * ничего не задевший, отвечает так же успешно, как сделавший работу.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class DictAgentProfileRenameLiveDbTest {

    private static final String CODE = "v48probe";

    @Inject
    LoreSchemaMigrationRunner runner;

    private static List<Map<String, Object>> sql(String query) throws Exception {
        HttpClient http = HttpClient.newHttpClient();
        String body = io.vertx.core.json.JsonObject.of("language", "sql", "command", query).encode();
        HttpRequest req = HttpRequest.newBuilder(
                URI.create(LoreArcadeDbTestResource.BASE_URL + "/api/v1/command/" + LoreArcadeDbTestResource.TEST_DB))
            .header("Content-Type", "application/json")
            .header("Authorization", "Basic " + Base64.getEncoder().encodeToString(
                ("root:" + LoreArcadeDbTestResource.ROOT_PASSWORD).getBytes(StandardCharsets.UTF_8)))
            .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        HttpResponse<String> r = http.send(req, HttpResponse.BodyHandlers.ofString());
        io.vertx.core.json.JsonObject j = new io.vertx.core.json.JsonObject(r.body());
        java.util.List<Map<String, Object>> out = new java.util.ArrayList<>();
        io.vertx.core.json.JsonArray arr = j.getJsonArray("result", new io.vertx.core.json.JsonArray());
        for (int i = 0; i < arr.size(); i++) out.add(arr.getJsonObject(i).getMap());
        return out;
    }

    private static long count(String type, String dictType) throws Exception {
        return ((Number) sql("SELECT count(*) AS n FROM " + type + " WHERE dict_type = '" + dictType
            + "' AND code = '" + CODE + "'").get(0).get("n")).longValue();
    }

    @Test
    @Order(1)
    void legacyEntryWithHistoryMovesToAgentProfile() throws Exception {
        sql("UPDATE KnowDictEntry SET dict_type='agent_role', code='" + CODE + "', label_ru='проба V48', "
            + "sort_order=99, is_active=true, is_extensible=true UPSERT WHERE dict_type='agent_role' AND code='" + CODE + "'");
        sql("INSERT INTO KnowDictEntryHist SET dict_type='agent_role', code='" + CODE + "', "
            + "state_uid='v48-probe-hist', valid_from='2026-10-20T00:00:00Z', label_ru='проба V48'");
        assertEquals(1, count("KnowDictEntry", "agent_role"), "положительный контроль: проба посеяна");
        assertEquals(1, count("KnowDictEntryHist", "agent_role"), "положительный контроль: история посеяна");

        runner.renameAgentRoleDictToProfile();

        assertEquals(0, count("KnowDictEntry", "agent_role"), "запись осталась под старым именем словаря");
        assertEquals(1, count("KnowDictEntry", "agent_profile"), "запись не появилась под agent_profile");
        assertEquals(0, count("KnowDictEntryHist", "agent_role"), "история осталась под старым именем");
        assertEquals(1, count("KnowDictEntryHist", "agent_profile"), "история не переехала");
    }

    @Test
    @Order(2)
    void secondRunChangesNothing() throws Exception {
        runner.renameAgentRoleDictToProfile();
        assertEquals(1, count("KnowDictEntry", "agent_profile"));
        assertEquals(1, count("KnowDictEntryHist", "agent_profile"));
    }

    @Test
    @Order(3)
    void dictionarySliceServesItUnderTheNewName() {
        given().header("X-Seer-Role", "admin")
            .queryParam("dict_type", "agent_profile")
            .when().get("/lore/slice/dictionary")
            .then().statusCode(200)
            .body("rows.code", hasItem(CODE));
    }

    @AfterAll
    static void cleanup() throws Exception {
        sql("DELETE FROM KnowDictEntryHist WHERE code = '" + CODE + "'");
        sql("DELETE FROM KnowDictEntry WHERE code = '" + CODE + "'");
    }
}
