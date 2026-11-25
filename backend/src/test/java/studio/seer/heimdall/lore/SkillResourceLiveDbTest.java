package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Assumptions;
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
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * SPRINT_LORE_KNOW_REGISTRY/SKILL-01 (приёмка зонтика) — {@code POST /lore/skill} и {@code POST /lore/skill/link}
 * энд-ту-энд на встроенной ArcadeDB (SPEC-SKILLS-TAGS-062 §5–§7): создание с рёбрами, отказ без проекта/роли,
 * цикл SKILL_EXTENDS, снятие последнего проекта, жизненный цикл (NOOP deprecated→active не владельцем,
 * INVALID_VALUE вне цикла), карточка describe из реестра. Плюс посев V97 на базе без логина владельца:
 * скиллы рождаются без OWNED_BY, а не валят шаг.
 *
 * <p>Факт проверяется в графе (рёбра), а не только кодом ответа.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class SkillResourceLiveDbTest {

    private static final String PROJECT = "LORE_TEST_ORG/skill01-probe";
    private static final String ROLE = "skill01probe";
    private static final String A = "skill:skill01-a";
    private static final String B = "skill:skill01-b";

    private static List<Map<String, Object>> sql(String query) throws Exception {
        HttpClient http = LiveDbHttp.client();
        String body = io.vertx.core.json.JsonObject.of("language", "sql", "command", query).encode();
        HttpRequest req = HttpRequest.newBuilder(
                URI.create(LoreArcadeDbTestResource.BASE_URL + "/api/v1/command/" + LoreArcadeDbTestResource.TEST_DB))
            .header("Content-Type", "application/json")
            .header("Authorization", "Basic " + Base64.getEncoder().encodeToString(
                ("root:" + LoreArcadeDbTestResource.ROOT_PASSWORD).getBytes(StandardCharsets.UTF_8)))
            .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        HttpResponse<String> r = http.send(req, HttpResponse.BodyHandlers.ofString());
        io.vertx.core.json.JsonObject j = new io.vertx.core.json.JsonObject(r.body());
        List<Map<String, Object>> out = new ArrayList<>();
        io.vertx.core.json.JsonArray arr = j.getJsonArray("result", new io.vertx.core.json.JsonArray());
        for (int i = 0; i < arr.size(); i++) out.add(arr.getJsonObject(i).getMap());
        return out;
    }

    private static long n(String query) throws Exception {
        return ((Number) sql(query).get(0).get("n")).longValue();
    }

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    private static Map<String, Object> skill(String id, List<String> projects, List<String> roles) {
        Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("skill_id", id);
        m.put("title", "проба SKILL-01 " + id);
        m.put("body_md", "## Шаги\n1. проба");
        if (projects != null) m.put("projects", projects);
        if (roles != null) m.put("roles", roles);
        return m;
    }

    @Test
    @Order(1)
    void setUpProjectAndRole() throws Exception {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"slug\":\"" + PROJECT + "\"}").when().post("/lore/project").then().statusCode(200);
        sql("UPDATE KnowDictEntry SET dict_type='agent_profile', code='" + ROLE + "', label_ru='проба SKILL-01', "
            + "sort_order=999, is_active=true UPSERT WHERE dict_type='agent_profile' AND code='" + ROLE + "'");
        assertEquals(1, n("SELECT count(*) AS n FROM KnowGitProject WHERE slug = '" + PROJECT + "'"), "положительный контроль: проект");
        assertEquals(1, n("SELECT count(*) AS n FROM KnowDictEntry WHERE dict_type='agent_profile' AND code='" + ROLE + "'"),
            "положительный контроль: роль");
    }

    /** V97 на базе без логина владельца: посевные скиллы есть, OWNED_BY не поставлен — шаг не упал. */
    @Test
    @Order(2)
    void v97SeedsSkillsWithoutOwnerWhenOwnerLoginIsAbsent() throws Exception {
        Assumptions.assumeTrue(n("SELECT count(*) AS n FROM KnowUser WHERE login = '" + SkillSeed.OWNER_LOGIN + "'") == 0,
            "в тестовой базе есть логин владельца — сценарий «без владельца» не воспроизводится");
        for (SkillSeed.Skill s : SkillSeed.SKILLS) {
            assertEquals(1, n("SELECT count(*) AS n FROM KnowSkill WHERE skill_id = '" + s.skillId() + "'"),
                s.skillId() + " посеян");
            assertEquals(0, n("SELECT out('OWNED_BY').size() AS n FROM KnowSkill WHERE skill_id = '" + s.skillId() + "'"),
                s.skillId() + ": без логина владельца OWNED_BY не ставится");
        }
    }

    @Test
    @Order(3)
    void createWithoutProjectOrRoleIsRefused() throws Exception {
        admin().body(skill(A, null, List.of(ROLE))).when().post("/lore/skill")
            .then().statusCode(422).body("error", equalTo("REFUSED")).body("missing", hasItem("BELONGS_TO_PROJECT"));
        admin().body(skill(A, List.of(PROJECT), null)).when().post("/lore/skill")
            .then().statusCode(422).body("error", equalTo("REFUSED")).body("missing", hasItem("APPLIES_TO_ROLE"));
        assertEquals(0, n("SELECT count(*) AS n FROM KnowSkill WHERE skill_id = '" + A + "'"), "отказ ничего не записал");
    }

    @Test
    @Order(4)
    void createWithEdgesIsDraftAndWired() throws Exception {
        admin().body(skill(A, List.of(PROJECT), List.of(ROLE))).when().post("/lore/skill")
            .then().statusCode(201).body("ok", equalTo(true)).body("status", equalTo("draft"));
        assertEquals(1, n("SELECT out('BELONGS_TO_PROJECT').size() AS n FROM KnowSkill WHERE skill_id = '" + A + "'"));
        assertEquals(1, n("SELECT out('APPLIES_TO_ROLE').size() AS n FROM KnowSkill WHERE skill_id = '" + A + "'"));
        Map<String, Object> b = skill(B, List.of(PROJECT), List.of(ROLE));
        b.put("extends_ids", List.of(A));
        admin().body(b).when().post("/lore/skill").then().statusCode(201);
        assertEquals(1, n("SELECT out('SKILL_EXTENDS').size() AS n FROM KnowSkill WHERE skill_id = '" + B + "'"),
            "B расширяет A — ребро SKILL_EXTENDS");
    }

    @Test
    @Order(5)
    void extendsCycleIsRefused() throws Exception {
        admin().body(Map.of("skill_id", A, "rel", "extends", "target_id", B)).when().post("/lore/skill/link")
            .then().statusCode(422).body("error", equalTo("REFUSED")).body("chain", hasItem(A));
        assertEquals(0, n("SELECT out('SKILL_EXTENDS').size() AS n FROM KnowSkill WHERE skill_id = '" + A + "'"),
            "цикл не записан");
    }

    @Test
    @Order(6)
    void removingTheLastProjectIsRefused() throws Exception {
        admin().body(Map.of("skill_id", A, "rel", "project", "target_id", PROJECT, "action", "remove"))
            .when().post("/lore/skill/link")
            .then().statusCode(422).body("error", equalTo("REFUSED"));
        assertEquals(1, n("SELECT out('BELONGS_TO_PROJECT').size() AS n FROM KnowSkill WHERE skill_id = '" + A + "'"),
            "последний проект остался");
    }

    @Test
    @Order(7)
    void lifecycleNoopAndInvalidValue() {
        admin().body(Map.of("skill_id", A, "status", "deprecated")).when().post("/lore/skill")
            .then().statusCode(200).body("status", equalTo("deprecated"));
        // deprecated → active не владельцем (у скилла владельца нет) — NOOP, статус не меняется
        admin().body(Map.of("skill_id", A, "status", "active")).when().post("/lore/skill")
            .then().statusCode(409).body("error", equalTo("NOOP")).body("status", equalTo("deprecated"));
        // вне жизненного цикла — INVALID_VALUE (061 §5), прежний код — в legacy_code
        admin().body(Map.of("skill_id", A, "status", "draft")).when().post("/lore/skill")
            .then().statusCode(409).body("error", equalTo("INVALID_VALUE")).body("legacy_code", equalTo("BAD_TRANSITION"));
    }

    /** Карточка describe — из реестра видов (один источник), коды 061 §5. */
    @Test
    @Order(8)
    void describeComesFromTheRegistry() {
        admin().when().get("/lore/skill/describe?kind=skill:*").then().statusCode(200)
            .body("kind", equalTo("skill:*"))
            .body("errors.code", hasItem("INVALID_VALUE"))
            .body("errors.code", hasItem("NOOP"))
            .body("enums.skill_status", hasItem("deprecated"));
        admin().when().get("/lore/skill/describe?kind=adr:*").then().statusCode(404).body("error", equalTo("UNKNOWN_KIND"));
    }
}
