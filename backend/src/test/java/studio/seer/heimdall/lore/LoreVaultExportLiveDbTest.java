package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.quarkus.test.security.TestSecurity;
import io.quarkus.test.security.jwt.Claim;
import io.quarkus.test.security.jwt.JwtSecurity;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_MD_ARCHIVE/MDA-02 на живой базе: {@code GET /lore/export/project/{owner}/{repo}}.
 * <ul>
 *   <li>свой проект — zip; тело задачи — из ОТКРЫТОЙ версии истории, а не из первой с заметкой;</li>
 *   <li>проект без роли — 403 со словами, а не пустой архив;</li>
 *   <li>незарегистрированный проект — 404;</li>
 *   <li>две выгрузки одного состояния — те же байты.</li>
 * </ul>
 */
@QuarkusTest
@TestProfile(ScopeEnforcedProfile.class)
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreVaultExportLiveDbTest {

    private static final String P_OWN = "LORE_TEST_ORG/mda02-own";
    private static final String P_HIDDEN = "LORE_TEST_ORG/mda02-hidden";
    private static final String VIEWER_SUB = "mda02-viewer-sub";
    private static final String SPRINT = "SPRINT_MDA02_VAULT";

    private static void admin(String path, String body) {
        given().header("X-Seer-Role", "superadmin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    private static Map<String, String> unzip(byte[] zip) throws Exception {
        Map<String, String> out = new TreeMap<>();
        try (ZipInputStream z = new ZipInputStream(new ByteArrayInputStream(zip), StandardCharsets.UTF_8)) {
            ZipEntry e;
            while ((e = z.getNextEntry()) != null) out.put(e.getName(), new String(z.readAllBytes(), StandardCharsets.UTF_8));
        }
        return out;
    }

    @Test
    @Order(1)
    void setUp() {
        for (String slug : List.of(P_OWN, P_HIDDEN)) admin("/lore/project", "{\"slug\":\"" + slug + "\"}");
        admin("/lore/user", "{\"kc_sub\":\"" + VIEWER_SUB + "\",\"display_name\":\"MDA-02 Viewer\"}");
        admin("/lore/user/role", "{\"kc_sub\":\"" + VIEWER_SUB + "\",\"project\":\"" + P_OWN + "\",\"role\":\"reader\"}");
        admin("/lore/sprint/create", "{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"MDA-02 выгрузка\",\"git_project\":\"" + P_OWN + "\"}");
        admin("/lore/task", "{\"sprint_id\":\"" + SPRINT + "\",\"task_id\":\"T-1\",\"title\":\"Проба выгрузки\",\"note_md\":\"первая версия\"}");
        // Новая версия истории: тело в выгрузке — из ОТКРЫТОЙ версии.
        admin("/lore/status", "{\"entity_type\":\"task\",\"id\":\"" + SPRINT + "/T-1\",\"status\":\"active\"}");
        admin("/lore/task/edit", "{\"task_uid\":\"" + SPRINT + "/T-1\",\"title\":\"Проба выгрузки\",\"note_md\":\"вторая версия\"}");
        // Смена статуса ПОСЛЕ заметки: открытая версия — без заметки и оценки. Выгрузка обязана
        // показать то же, что паспорт (срез tasks_by_uids): статус, тело, оценку (прод 15.11).
        admin("/lore/task", "{\"sprint_id\":\"" + SPRINT + "\",\"task_id\":\"T-2\",\"title\":\"Статус после заметки\",\"note_md\":\"единственная заметка\",\"effort_days\":1.5}");
        admin("/lore/status", "{\"entity_type\":\"task\",\"id\":\"" + SPRINT + "/T-2\",\"status\":\"active\"}");
    }

    @Test
    @Order(2)
    @TestSecurity(user = "mda02-viewer", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = VIEWER_SUB))
    void ownProjectExportsZipWithOpenVersionBody() throws Exception {
        byte[] zip = given().when().get("/lore/export/project/" + P_OWN)
            .then().statusCode(200).contentType("application/zip").extract().asByteArray();
        Map<String, String> files = unzip(zip);
        String root = "LORE/LORE_TEST_ORG__mda02-own/";
        assertTrue(files.containsKey(root + "index.md"), files.keySet().toString());
        assertTrue(files.containsKey(root + "sprints/" + SPRINT + ".md"), files.keySet().toString());
        String task = files.get(root + "tasks/" + SPRINT + "/T-1.md");
        assertNotNull(task, "задача — в папке своего спринта: " + files.keySet());
        assertTrue(task.contains("вторая версия"), "тело из открытой версии: " + task);
        assertFalse(task.contains("первая версия"), "закрытая версия в выгрузку не попадает: " + task);
        assertTrue(task.contains("status: active"), task);
        String flipped = files.get(root + "tasks/" + SPRINT + "/T-2.md");
        assertNotNull(flipped, files.keySet().toString());
        assertTrue(flipped.contains("status: active"), "статус после смены — как в паспорте: " + flipped);
        assertTrue(flipped.contains("единственная заметка"), "тело не теряется от смены статуса: " + flipped);
        assertTrue(flipped.contains("effort_days: 1.5"), "оценка не теряется от смены статуса: " + flipped);

        byte[] again = given().when().get("/lore/export/project/" + P_OWN)
            .then().statusCode(200).extract().asByteArray();
        assertArrayEquals(zip, again, "две выгрузки без изменений в базе — те же байты");

        // Скорость (прод 15.11: 7,8 с): фазы выгрузки видны в Server-Timing — «долго» проверяется числом.
        String timing = given().when().get("/lore/export/project/" + P_OWN)
            .then().statusCode(200).extract().header("Server-Timing");
        assertNotNull(timing, "Server-Timing обязателен");
        assertTrue(timing.contains("records;dur=") && timing.contains("tasks;dur="), timing);
    }

    /** MDA-03: тот же архив картой «путь → текст» — для MCP, который раскладывает файлы на диск. */
    @Test
    @Order(2)
    @TestSecurity(user = "mda02-viewer", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = VIEWER_SUB))
    @SuppressWarnings("unchecked")
    void jsonFormatCarriesExactlyTheZipFiles() throws Exception {
        byte[] zip = given().when().get("/lore/export/project/" + P_OWN)
            .then().statusCode(200).extract().asByteArray();
        var json = given().queryParam("format", "json").when().get("/lore/export/project/" + P_OWN)
            .then().statusCode(200).contentType("application/json").extract().jsonPath();
        Map<String, String> files = json.getMap("files");
        assertEquals(unzip(zip), new TreeMap<>(files), "json и zip — одни и те же файлы");
        assertEquals("LORE/LORE_TEST_ORG__mda02-own/", json.getString("root"));
        assertEquals(2, json.getInt("counts.task"), "счётчики по типам рядом с файлами (T-1 и T-2)");
        assertEquals(0, json.getInt("hidden_by_rights"));
    }

    @Test
    @Order(3)
    @TestSecurity(user = "mda02-viewer", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = VIEWER_SUB))
    void projectWithoutRoleIsForbiddenNotAnEmptyArchive() {
        String err = given().when().get("/lore/export/project/" + P_HIDDEN)
            .then().statusCode(403).extract().jsonPath().getString("error");
        assertEquals("PROJECT_FORBIDDEN", err);
    }

    @Test
    @Order(4)
    void unknownProjectIs404() {
        String err = given().header("X-Seer-Role", "superadmin")
            .when().get("/lore/export/project/LORE_TEST_ORG/mda02-no-such-project")
            .then().statusCode(404).extract().jsonPath().getString("error");
        assertEquals("PROJECT_NOT_FOUND", err);
    }
}
