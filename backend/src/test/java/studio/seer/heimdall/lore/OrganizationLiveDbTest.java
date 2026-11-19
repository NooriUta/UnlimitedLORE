package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.path.json.JsonPath;
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
import static org.junit.jupiter.api.Assertions.*;

/**
 * Решение владелицы 19.11.2026 (D-2026-MIG-REPOSITORY-ORGANIZATION): «организацию пока с проектами, продуктами и
 * людьми в админке связи и всё, и в админку её минимально». Путь записи на живом графе:
 * <ol>
 *   <li>старая схема (без KnowOrganization): паспорт проекта читается, вкладка «Организации» не роняет его;
 *       создание организации — 409 словами, а не 502 и не заведение типа;</li>
 *   <li>схема с организацией (как после переноса 1.18): super-admin заводит организацию, привязывает проект —
 *       связь видна в паспорте организации и у проекта; admin — 403; снятие — связь уходит.</li>
 * </ol>
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class OrganizationLiveDbTest {

    static final String PROJECT = "LORE_TEST_ORG/org-link-repo";
    static final String ORG = "ORG_LIVE_TEST";

    static boolean hadOrgType;

    private static List<Map<String, Object>> sql(String command) throws Exception {
        HttpClient http = LiveDbHttp.client();
        String body = io.vertx.core.json.JsonObject.of("language", "sql", "command", command).encode();
        HttpRequest req = HttpRequest.newBuilder(
                URI.create(LoreArcadeDbTestResource.BASE_URL + "/api/v1/command/" + LoreArcadeDbTestResource.TEST_DB))
            .header("Content-Type", "application/json; charset=utf-8")
            .header("Authorization", "Basic " + Base64.getEncoder().encodeToString(
                ("root:" + LoreArcadeDbTestResource.ROOT_PASSWORD).getBytes(StandardCharsets.UTF_8)))
            .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8)).build();
        HttpResponse<String> r = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        assertEquals(200, r.statusCode(), r.body());
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rows = (List<Map<String, Object>>) (List<?>) new io.vertx.core.json.JsonObject(r.body())
            .getJsonArray("result").getList();
        return rows;
    }

    private static io.restassured.specification.RequestSpecification as(String role) {
        return given().header("X-Seer-Role", role).contentType("application/json");
    }

    @Test
    @Order(1)
    void старая_схема_паспорт_проекта_цел_создание_отказывает_словами() throws Exception {
        as("superadmin").body("{\"slug\":\"" + PROJECT + "\",\"name\":\"Org link\"}").post("/lore/project").then().statusCode(200);
        hadOrgType = !sql("SELECT name FROM schema:types WHERE name = 'KnowOrganization'").isEmpty();
        JsonPath p = as("superadmin").get("/lore/record/project/" + PROJECT).then().statusCode(200).extract().jsonPath();
        assertEquals("Org link", p.getString("record.title"), "паспорт проекта читается и на старой схеме");
        if (hadOrgType) return;   // постоянная база, где тип уже завели прежним прогоном: 409 не проверить
        as("superadmin").body("{\"org_id\":\"" + ORG + "\",\"name\":\"Org\"}").post("/lore/organization")
            .then().statusCode(409).body("error", org.hamcrest.Matchers.equalTo("NO_ORGANIZATION_SCHEMA"));
    }

    @Test
    @Order(2)
    void схема_с_организацией_создание_привязка_снятие() throws Exception {
        sql("CREATE VERTEX TYPE KnowOrganization IF NOT EXISTS");
        as("admin").body("{\"org_id\":\"" + ORG + "\",\"name\":\"Org\"}").post("/lore/organization").then().statusCode(403);
        as("superadmin").body("{\"org_id\":\"" + ORG + "\",\"name\":\"Организация теста\"}").post("/lore/organization")
            .then().log().ifValidationFails().statusCode(200).body("ok", org.hamcrest.Matchers.equalTo(true));
        for (String e : List.of("ORG_HAS_PROJECT", "ORG_HAS_PRODUCT", "ORG_MEMBER"))
            assertFalse(sql("SELECT name FROM schema:types WHERE name = '" + e + "'").isEmpty(), e + ": тип ребра заведён созданием");

        String rel = "{\"rel\":\"ORG_HAS_PROJECT\",\"dir\":\"out\",\"target\":\"" + PROJECT + "\",\"action\":\"add\"}";
        as("admin").body(rel).post("/lore/record/organization/" + ORG + "/relation").then().statusCode(403);
        as("superadmin").body(rel).post("/lore/record/organization/" + ORG + "/relation").then().statusCode(200);

        JsonPath o = as("superadmin").get("/lore/record/organization/" + ORG).then().statusCode(200).extract().jsonPath();
        assertEquals("Организация теста", o.getString("record.title"));
        assertEquals(true, o.getBoolean("perms.can_edit"), "super-admin правит связи организации");
        List<Map<String, Object>> links = o.getList("links");
        assertTrue(links.stream().anyMatch(l -> "ORG_HAS_PROJECT".equals(l.get("rel")) && PROJECT.equals(l.get("id"))), links.toString());

        JsonPath pr = as("superadmin").get("/lore/record/project/" + PROJECT).then().statusCode(200).extract().jsonPath();
        List<Map<String, Object>> plinks = pr.getList("links");
        assertTrue(plinks.stream().anyMatch(l -> "ORG_HAS_PROJECT".equals(l.get("rel")) && ORG.equals(l.get("id"))
            && "organization".equals(l.get("type"))), "у проекта видна организация: " + plinks);

        as("superadmin").body(rel.replace("\"add\"", "\"remove\"")).post("/lore/record/organization/" + ORG + "/relation").then().statusCode(200);
        JsonPath after = as("superadmin").get("/lore/record/organization/" + ORG).then().statusCode(200).extract().jsonPath();
        List<Map<String, Object>> left = after.getList("links");
        assertFalse(left.stream().anyMatch(l -> "ORG_HAS_PROJECT".equals(l.get("rel"))), "связь снята: " + left);
    }
}
