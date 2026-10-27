package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Исходы {@code POST /lore/release/link|unlink} на живой базе (ADR-LORE-043, DBR-17).
 *
 * <p>Найдено при раскатке: счётчик {@code sprints_linked} рос на каждом
 * исполненном CREATE EDGE, а не на созданном ребре. Несуществующий спринт давал
 * {@code ok:true, sprints_linked:1} при нуле рёбер — ровно та подмена, против
 * которой ADR. И без IF NOT EXISTS повтор создавал второе ребро.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreReleaseLinkOutcomeLiveDbTest {

    private static final String GP     = "test/dbr17-release-outcome";
    private static final String REL    = "v0.0.1-out";
    private static final String RUID   = GP + "#" + REL;
    private static final String SPRINT = "SPRINT_RELOUT_1";

    @Inject
    LoreIngestService ingest;

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    private long count(String sql, Map<String, Object> p) {
        List<Map<String, Object>> rows = ingest.queryPublic(sql, p);
        return rows.isEmpty() ? 0 : ((Number) rows.get(0).getOrDefault("n", 0)).longValue();
    }

    private long sprintEdges() {
        return count("SELECT count(*) AS n FROM IMPLEMENTED_IN_RELEASE WHERE @out.sprint_id=:s AND @in.release_uid=:r",
            Map.of("s", SPRINT, "r", RUID));
    }

    @Test
    @Order(1)
    void setUp() {
        admin().body("{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"Спринт про исходы релиза\"}")
            .when().post("/lore/sprint/create").then().log().ifValidationFails().statusCode(200);
        admin().body(Map.of("release_id", REL, "git_project", GP, "release_date", "2026-10-27"))
            .when().post("/lore/release").then().log().ifValidationFails().statusCode(200);
    }

    @Test
    @Order(2)
    void firstSprintLinkIsCreated() {
        admin().body(Map.of("release_id", REL, "git_project", GP, "sprint_ids", List.of(SPRINT)))
            .when().post("/lore/release/link")
            .then().log().ifValidationFails().statusCode(200)
            .body("outcome", equalTo("created"))
            .body("ok", equalTo(true))
            .body("sprints_linked", equalTo(1));
    }

    @Test
    @Order(3)
    void repeatIsUnchangedAndDoesNotDuplicate() {
        admin().body(Map.of("release_id", REL, "git_project", GP, "sprint_ids", List.of(SPRINT)))
            .when().post("/lore/release/link")
            .then().log().ifValidationFails().statusCode(200)
            .body("outcome", equalTo("unchanged"))
            .body("ok", equalTo(true));
        assertEquals(1, sprintEdges(), "повтор release_link не должен создавать второе ребро");
    }

    /** Несуществующий спринт — noop с причиной и ok:false, а не «привязан 1». */
    @Test
    @Order(4)
    void missingSprintIsNoopNotCounted() {
        admin().body(Map.of("release_id", REL, "git_project", GP, "sprint_ids", List.of("SPRINT_RELOUT_MISSING")))
            .when().post("/lore/release/link")
            .then().log().ifValidationFails().statusCode(200)
            .body("outcome", equalTo("noop"))
            .body("ok", equalTo(false))
            .body("sprints_linked", equalTo(0))
            .body("reason", containsString("SPRINT_RELOUT_MISSING"));
    }

    /** Нет релиза — noop, и вершина PR-сироты не заводится. */
    @Test
    @Order(5)
    void missingReleaseIsNoopAndCreatesNoOrphanPr() {
        admin().body(Map.of("release_id", "v9.9.9-out", "git_project", GP, "pr_numbers", List.of(990001)))
            .when().post("/lore/release/link")
            .then().log().ifValidationFails().statusCode(200)
            .body("outcome", equalTo("noop"))
            .body("ok", equalTo(false))
            .body("prs_linked", equalTo(0));
        assertEquals(0, count("SELECT count(*) AS n FROM KnowPR WHERE pr_uid=:u", Map.of("u", GP + "#990001")));
    }

    @Test
    @Order(6)
    void prLinkCreatedThenUnchanged() {
        admin().body(Map.of("release_id", REL, "git_project", GP, "pr_numbers", List.of(990002)))
            .when().post("/lore/release/link")
            .then().log().ifValidationFails().statusCode(200).body("outcome", equalTo("created")).body("prs_linked", equalTo(1));
        admin().body(Map.of("release_id", REL, "git_project", GP, "pr_numbers", List.of(990002)))
            .when().post("/lore/release/link")
            .then().log().ifValidationFails().statusCode(200).body("outcome", equalTo("unchanged"));
        assertEquals(1, count("SELECT count(*) AS n FROM SHIPPED_IN WHERE @out.pr_uid=:u AND @in.release_uid=:r",
            Map.of("u", GP + "#990002", "r", RUID)));
    }

    @Test
    @Order(7)
    void unlinkExistingIsDeleted() {
        admin().body(Map.of("release_id", REL, "git_project", GP, "sprint_ids", List.of(SPRINT)))
            .when().post("/lore/release/unlink")
            .then().log().ifValidationFails().statusCode(200)
            .body("outcome", equalTo("deleted"))
            .body("sprints_removed", equalTo(1));
    }

    /** Снимать нечего — unchanged; ok:false и errors остаются по CIM-03. */
    @Test
    @Order(8)
    void unlinkMissingIsUnchanged() {
        admin().body(Map.of("release_id", REL, "git_project", GP, "sprint_ids", List.of(SPRINT)))
            .when().post("/lore/release/unlink")
            .then().log().ifValidationFails().statusCode(200)
            .body("outcome", equalTo("unchanged"))
            .body("sprints_removed", equalTo(0));
    }
}
