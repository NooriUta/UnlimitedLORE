package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import io.quarkus.test.security.jwt.Claim;
import io.quarkus.test.security.jwt.JwtSecurity;
import io.restassured.response.Response;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-04 · decision:D-2026-UXR-VIEWS-SERVER.
 *
 * <p>Виды, избранное, недавние и личные настройки на сервере — сквозь REST,
 * на живой изолированной БД, с JWT (владелец = {@code sub} токена).
 *
 * <p>Ключевые свойства, каждое — отдельным кейсом:
 * <ul>
 *   <li>чужой личный вид не виден и не правится (даже админом);</li>
 *   <li>видимость «все» и «роли» (роль проекта из графа);</li>
 *   <li>командный вид по умолчанию заводит только админ, личный вид его переопределяет;</li>
 *   <li>оптимистическая блокировка (S2-09): устаревшая версия → 409 с текущим состоянием,
 *       положительный контроль — правка по свежей версии проходит;</li>
 *   <li>без опознанного вызывающего — 401, а не «пусто».</li>
 * </ul>
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreMeLiveDbTest {

    private static final String SUB_A = "s204-user-a";
    private static final String SUB_B = "s204-user-b";
    private static final String SUB_ADMIN = "s204-admin";
    private static final String PROJECT = "LORE_TEST_ORG/s204-me-repo";

    private static String privateViewUid;
    private static String sharedViewUid;
    private static String rolesViewUid;
    private static String teamViewUid;
    private static int privateViewVersion;

    private static Response post(String path, String body) {
        return given().contentType("application/json").body(body).when().post(path);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> views(String section) {
        return given().when().get("/lore/me/views?section=" + section)
            .then().statusCode(200).extract().path("views");
    }

    private static List<String> uids(List<Map<String, Object>> vs) {
        return vs.stream().map(v -> String.valueOf(v.get("view_uid"))).toList();
    }

    // ── Подготовка: проект и роль tester у B (без JWT — auth выключен) ──────

    @Test
    @Order(1)
    void setUp() {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"slug\":\"" + PROJECT + "\"}")
        .when().post("/lore/project").then().statusCode(200);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + SUB_B + "\",\"project\":\"" + PROJECT + "\",\"role\":\"tester\"}")
        .when().post("/lore/user/role").then().statusCode(200);
    }

    // ── Без опознанного вызывающего — честный 401 ───────────────────────────

    @Test
    @Order(2)
    void withoutIdentityIsUnauthorizedNotEmpty() {
        given().when().get("/lore/me/views").then().statusCode(401).body("error", equalTo("NO_IDENTITY"));
        given().when().get("/lore/me/settings").then().statusCode(401);
        post("/lore/me/favorites", "{\"ref_type\":\"adr\",\"ref_id\":\"ADR-X\"}").then().statusCode(401);
    }

    // ── Виды ────────────────────────────────────────────────────────────────

    @Test
    @Order(10)
    @TestSecurity(user = "s204-a", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = SUB_A))
    void ownerCreatesViewsOfEachVisibility() {
        privateViewUid = post("/lore/me/views",
            "{\"name\":\"Мои открытые\",\"section\":\"tasks\",\"query\":\"status=open&mine=1\"}")
            .then().statusCode(200)
            .body("outcome", equalTo("created"))
            .body("view.visibility", equalTo("me"))
            .body("view.version", equalTo(1))
            .body("view.own", equalTo(true))
            .extract().path("view.view_uid");
        privateViewVersion = 1;
        sharedViewUid = post("/lore/me/views",
            "{\"name\":\"Блокеры\",\"section\":\"tasks\",\"query\":\"status=blocked\",\"visibility\":\"all\"}")
            .then().statusCode(200).extract().path("view.view_uid");
        rolesViewUid = post("/lore/me/views",
            "{\"name\":\"Для тестеров\",\"section\":\"tasks\",\"query\":\"type=test\","
            + "\"visibility\":\"roles\",\"roles\":[\"tester\"]}")
            .then().statusCode(200).body("view.roles", equalTo(List.of("tester")))
            .extract().path("view.view_uid");

        List<String> mine = uids(views("tasks"));
        assertTrue(mine.containsAll(List.of(privateViewUid, sharedViewUid, rolesViewUid)), mine.toString());
    }

    @Test
    @Order(11)
    @TestSecurity(user = "s204-a", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = SUB_A))
    void badViewIsRejectedBeforeWrite() {
        post("/lore/me/views", "{\"name\":\"x\",\"section\":\"tasks\",\"visibility\":\"roles\"}")
            .then().statusCode(400).body("error", equalTo("BAD_PARAMS"));
        post("/lore/me/views", "{\"name\":\"\",\"section\":\"tasks\"}").then().statusCode(400);
    }

    @Test
    @Order(12)
    @TestSecurity(user = "s204-b", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = SUB_B))
    void otherUserSeesSharedAndRoleViewsButNotPrivate() {
        List<Map<String, Object>> vs = views("tasks");
        List<String> ids = uids(vs);
        assertFalse(ids.contains(privateViewUid), "чужой личный вид утёк: " + ids);
        assertTrue(ids.contains(sharedViewUid), "вид «все» обязан быть виден");
        assertTrue(ids.contains(rolesViewUid), "вид для роли tester виден носителю роли проекта");
        Map<String, Object> shared = vs.stream().filter(v -> sharedViewUid.equals(v.get("view_uid"))).findFirst().orElseThrow();
        assertEquals(false, shared.get("own"));
        assertFalse(shared.containsKey("owner_sub"), "kc_sub чужого владельца наружу не отдаём");
    }

    @Test
    @Order(13)
    @TestSecurity(user = "s204-b", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = SUB_B))
    void otherUserCannotEditOrDeleteAndPrivateLooksAbsent() {
        post("/lore/me/views", "{\"view_uid\":\"" + sharedViewUid + "\",\"name\":\"чужое\"}")
            .then().statusCode(403).body("error", equalTo("NOT_OWNER"));
        post("/lore/me/views/delete", "{\"view_uid\":\"" + sharedViewUid + "\"}").then().statusCode(403);
        // Личный вид для B не существует: 404, а не 403 — сам факт его наличия тоже не раскрываем.
        post("/lore/me/views", "{\"view_uid\":\"" + privateViewUid + "\",\"name\":\"чужое\"}")
            .then().statusCode(404);
    }

    @Test
    @Order(14)
    @TestSecurity(user = "s204-admin", roles = {"admin"})
    @JwtSecurity(claims = @Claim(key = "sub", value = SUB_ADMIN))
    void adminDoesNotSeeSomeoneElsesPrivateView() {
        assertFalse(uids(views("tasks")).contains(privateViewUid),
            "личный вид — личный и для админа");
    }

    @Test
    @Order(20)
    @TestSecurity(user = "s204-a", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = SUB_A))
    void staleVersionGets409WithCurrentAndFreshVersionPasses() {
        // Положительный контроль: правка по свежей версии проходит и поднимает версию.
        post("/lore/me/views", "{\"view_uid\":\"" + privateViewUid + "\",\"query\":\"status=open\","
            + "\"expected_version\":" + privateViewVersion + "}")
            .then().statusCode(200).body("outcome", equalTo("updated")).body("view.version", equalTo(2));
        // Вторая вкладка всё ещё думает, что версия 1.
        post("/lore/me/views", "{\"view_uid\":\"" + privateViewUid + "\",\"query\":\"stale\","
            + "\"expected_version\":1}")
            .then().statusCode(409)
            .body("error", equalTo("CONFLICT"))
            .body("current.version", equalTo(2))
            .body("current.query", equalTo("status=open"));
        privateViewVersion = 2;
        // Повтор того же значения — не правка.
        post("/lore/me/views", "{\"view_uid\":\"" + privateViewUid + "\",\"query\":\"status=open\"}")
            .then().statusCode(200).body("outcome", equalTo("unchanged")).body("view.version", equalTo(2));
    }

    @Test
    @Order(21)
    @TestSecurity(user = "s204-a", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = SUB_A))
    void nonAdminCannotCreateTeamDefault() {
        post("/lore/me/views", "{\"name\":\"Команда\",\"section\":\"sprints\",\"visibility\":\"all\","
            + "\"is_team_default\":true}")
            .then().statusCode(403);
    }

    @Test
    @Order(22)
    @TestSecurity(user = "s204-admin", roles = {"admin"})
    @JwtSecurity(claims = @Claim(key = "sub", value = SUB_ADMIN))
    void adminCreatesTeamDefault() {
        // Командный вид обязан быть виден кому-то кроме автора.
        post("/lore/me/views", "{\"name\":\"Команда\",\"section\":\"sprints\",\"visibility\":\"me\","
            + "\"is_team_default\":true}")
            .then().statusCode(400);
        teamViewUid = post("/lore/me/views", "{\"name\":\"Активные спринты\",\"section\":\"sprints\","
            + "\"query\":\"status=active\",\"visibility\":\"all\",\"is_team_default\":true}")
            .then().statusCode(200).body("view.is_team_default", equalTo(true))
            .extract().path("view.view_uid");
    }

    @Test
    @Order(23)
    @TestSecurity(user = "s204-b", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = SUB_B))
    void newcomerGetsTeamDefaultThenPersonalOverridesIt() {
        given().when().get("/lore/me/views?section=sprints").then().statusCode(200)
            .body("defaults.sprints", equalTo(teamViewUid));
        String mine = post("/lore/me/views", "{\"name\":\"Мои спринты\",\"section\":\"sprints\","
            + "\"query\":\"owner=me\",\"is_personal_default\":true}")
            .then().statusCode(200).extract().path("view.view_uid");
        given().when().get("/lore/me/views?section=sprints").then().statusCode(200)
            .body("defaults.sprints", equalTo(mine));
        // Второй личный «по умолчанию» в том же разделе снимает флаг с первого.
        String mine2 = post("/lore/me/views", "{\"name\":\"Мои спринты 2\",\"section\":\"sprints\","
            + "\"is_personal_default\":true}")
            .then().statusCode(200).extract().path("view.view_uid");
        List<Map<String, Object>> vs = views("sprints");
        long defaults = vs.stream().filter(v -> Boolean.TRUE.equals(v.get("is_personal_default"))).count();
        assertEquals(1, defaults, "личный вид по умолчанию в разделе — один");
        given().when().get("/lore/me/views?section=sprints").then().body("defaults.sprints", equalTo(mine2));
    }

    @Test
    @Order(24)
    @TestSecurity(user = "s204-a", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = SUB_A))
    void deleteWithStaleVersionIs409ThenDeletes() {
        post("/lore/me/views/delete", "{\"view_uid\":\"" + privateViewUid + "\",\"expected_version\":1}")
            .then().statusCode(409).body("current.version", equalTo(2));
        post("/lore/me/views/delete", "{\"view_uid\":\"" + privateViewUid + "\",\"expected_version\":2}")
            .then().statusCode(200).body("outcome", equalTo("deleted"));
        assertFalse(uids(views("tasks")).contains(privateViewUid));
        post("/lore/me/views/delete", "{\"view_uid\":\"" + privateViewUid + "\"}").then().statusCode(404);
    }

    // ── Избранное ───────────────────────────────────────────────────────────

    @Test
    @Order(30)
    @TestSecurity(user = "s204-a", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = SUB_A))
    void favoritesAddIsIdempotentAndRemoveWorks() {
        String body = "{\"ref_type\":\"task\",\"ref_id\":\"SPRINT_X/CO-11\"}";
        post("/lore/me/favorites", body).then().statusCode(200).body("outcome", equalTo("created"));
        post("/lore/me/favorites", body).then().statusCode(200).body("outcome", equalTo("unchanged"));
        given().when().get("/lore/me/favorites").then().statusCode(200)
            .body("favorites.ref_id", hasItem("SPRINT_X/CO-11"))
            .body("count", equalTo(1));
        post("/lore/me/favorites", "{\"ref_type\":\"bad type\",\"ref_id\":\"x\"}").then().statusCode(400);
    }

    @Test
    @Order(31)
    @TestSecurity(user = "s204-b", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = SUB_B))
    void favoritesArePersonal() {
        given().when().get("/lore/me/favorites").then().statusCode(200)
            .body("favorites.ref_id", not(hasItem("SPRINT_X/CO-11")));
    }

    @Test
    @Order(32)
    @TestSecurity(user = "s204-a", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = SUB_A))
    void favoriteRemove() {
        post("/lore/me/favorites", "{\"ref_type\":\"task\",\"ref_id\":\"SPRINT_X/CO-11\",\"action\":\"remove\"}")
            .then().statusCode(200).body("outcome", equalTo("deleted"));
        post("/lore/me/favorites", "{\"ref_type\":\"task\",\"ref_id\":\"SPRINT_X/CO-11\",\"action\":\"remove\"}")
            .then().statusCode(200).body("outcome", equalTo("noop"));
        given().when().get("/lore/me/favorites").then().body("count", equalTo(0));
    }

    // ── Недавние ────────────────────────────────────────────────────────────

    @Test
    @Order(40)
    @TestSecurity(user = "s204-a", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = SUB_A))
    void recentIsOrderedNewestFirstCountsVisitsAndIsCapped() throws Exception {
        for (int i = 0; i < LoreMePrefs.RECENT_CAP + 3; i++) {
            post("/lore/me/recent", "{\"ref_type\":\"adr\",\"ref_id\":\"ADR-S204-" + i + "\"}")
                .then().statusCode(200);
        }
        Thread.sleep(5);
        post("/lore/me/recent", "{\"ref_type\":\"adr\",\"ref_id\":\"ADR-S204-10\"}").then().statusCode(200);
        Response r = given().when().get("/lore/me/recent");
        r.then().statusCode(200);
        List<String> ids = r.path("recent.ref_id");
        assertEquals(LoreMePrefs.RECENT_CAP, ids.size(), "хвост сверх предела срезан");
        assertEquals("ADR-S204-10", ids.get(0), "последний визит — первым");
        assertEquals(2, (int) r.path("recent[0].visits"));
        assertFalse(ids.contains("ADR-S204-0"), "самый старый вытеснен");
    }

    // ── Настройки ───────────────────────────────────────────────────────────

    @Test
    @Order(50)
    @TestSecurity(user = "s204-a", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = SUB_A))
    void settingsDefaultsThenPartialSaveThenConflict() {
        given().when().get("/lore/me/settings").then().statusCode(200)
            .body("version", equalTo(0))
            .body("settings.new_navigation", equalTo(false))
            .body("schema.text_size.values", hasItem("m"));

        post("/lore/me/settings", "{\"settings\":{\"density\":\"comfortable\",\"stripes\":true},\"expected_version\":0}")
            .then().statusCode(200).body("outcome", equalTo("created")).body("version", equalTo(1))
            .body("settings.density", equalTo("comfortable"));
        post("/lore/me/settings", "{\"settings\":{\"new_navigation\":true},\"expected_version\":1}")
            .then().statusCode(200).body("version", equalTo(2))
            .body("settings.stripes", equalTo(true))
            .body("settings.new_navigation", equalTo(true));
        // Устаревшая вкладка.
        post("/lore/me/settings", "{\"settings\":{\"theme\":\"light\"},\"expected_version\":1}")
            .then().statusCode(409).body("error", equalTo("CONFLICT"))
            .body("current.version", equalTo(2))
            .body("current.settings.new_navigation", equalTo(true));
        // Неизвестный ключ — 400 с именем ключа.
        post("/lore/me/settings", "{\"settings\":{\"colour\":\"red\"}}")
            .then().statusCode(400);
        // null снимает личное значение.
        post("/lore/me/settings", "{\"settings\":{\"stripes\":null}}")
            .then().statusCode(200).body("settings.stripes", equalTo(false)).body("version", equalTo(3))
            .body("stored.stripes", equalTo(null));
    }

    @Test
    @Order(51)
    @TestSecurity(user = "s204-b", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = SUB_B))
    void settingsArePersonal() {
        given().when().get("/lore/me/settings").then().statusCode(200)
            .body("version", equalTo(0)).body("settings.density", equalTo("compact"));
    }
}
