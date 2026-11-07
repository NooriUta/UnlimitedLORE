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
import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * SPRINT_LORE_PRODUCT_BACKLOG/REL-UID-01: два проекта выпускают одну версию.
 *
 * <p>Повод — сайт выпускал v1.4.1, а LORE отказал: номер уже был у монорепо.
 * Проверяем на живой базе: оба релиза заводятся; у каждого ровно одна строка
 * истории (раньше HAS_STATE цеплялся ко ВСЕМ релизам с тем же номером);
 * правка релиза одного проекта не трогает одноимённый релиз другого.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class ReleaseSameVersionTwoProjectsLiveDbTest {

    private static final String GP_A = "test/reluid-a";
    private static final String GP_B = "test/reluid-b";
    private static final String REL  = "v9.9.9-reluid";

    @Inject
    LoreIngestService ingest;

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    private long n(String sql, Map<String, Object> p) {
        List<Map<String, Object>> rows = ingest.queryPublic(sql, p);
        return rows.isEmpty() ? 0 : ((Number) rows.get(0).getOrDefault("n", 0)).longValue();
    }

    @Test
    @Order(1)
    void bothProjectsCreateTheSameVersion() {
        for (String gp : List.of(GP_A, GP_B)) {
            given().header("X-Seer-Role", "superadmin").contentType("application/json")
                .body("{\"slug\":\"" + gp + "\"}").when().post("/lore/project").then().statusCode(200);
            admin().body(Map.of("release_id", REL, "git_project", gp, "release_date", "2026-11-07"))
                .when().post("/lore/release").then().log().ifValidationFails().statusCode(200);
        }
        assertEquals(2, n("SELECT count(*) AS n FROM KnowRelease WHERE release_id=:r", Map.of("r", REL)));
    }

    @Test
    @Order(2)
    void eachReleaseHasExactlyOneHistoryRow() {
        for (String gp : List.of(GP_A, GP_B))
            assertEquals(1, n("SELECT out('HAS_STATE').size() AS n FROM KnowRelease WHERE release_uid=:k",
                Map.of("k", gp + "#" + REL)), "строк истории у " + gp);
    }

    @Test
    @Order(3)
    void updatingOneProjectLeavesTheOtherAlone() {
        admin().body(Map.of("release_id", REL, "git_project", GP_A, "description_md", "только проект A"))
            .when().post("/lore/release/update").then().log().ifValidationFails().statusCode(200);
        assertEquals(1, n("SELECT count(*) AS n FROM KnowRelease WHERE release_uid=:k AND description_md='только проект A'",
            Map.of("k", GP_A + "#" + REL)));
        assertEquals(0, n("SELECT count(*) AS n FROM KnowRelease WHERE release_uid=:k AND description_md='только проект A'",
            Map.of("k", GP_B + "#" + REL)));
    }
}
