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
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Исходы {@code POST /lore/spec/link} на живой базе (ADR-LORE-043, DBR-17).
 *
 * <p>Кроме словаря исходов здесь закреплены два дефекта, найденные при раскатке:
 * повтор {@code mode=add} плодил второе ребро (CREATE EDGE без IF NOT EXISTS),
 * а {@code mode=replace} на несуществующую цель СНАЧАЛА сносил текущую привязку
 * и только потом отвечал 404 — отказ, после которого спека осталась без
 * компонента.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreSpecLinkOutcomeLiveDbTest {

    private static final String SPEC = "SPEC-OUT-1";
    private static final String C1   = "TEST-SPECOUT-C1";
    private static final String C2   = "TEST-SPECOUT-C2";

    @Inject
    LoreIngestService ingest;

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    private static String link(String target, String mode) {
        return "{\"spec_id\":\"" + SPEC + "\",\"rel\":\"component\",\"target_id\":\"" + target
            + "\",\"mode\":\"" + mode + "\"}";
    }

    private long componentEdges(String componentId) {
        List<Map<String, Object>> rows = ingest.queryPublic(
            "SELECT count(*) AS n FROM BELONGS_TO WHERE @out.spec_id=:s AND @in.component_id=:c",
            Map.of("s", SPEC, "c", componentId));
        return rows.isEmpty() ? 0 : ((Number) rows.get(0).getOrDefault("n", 0)).longValue();
    }

    @Test
    @Order(1)
    void setUp() {
        for (String c : List.of(C1, C2))
            admin().body("{\"component_id\":\"" + c + "\",\"full_name\":\"проба исходов спеки\"}")
                .when().post("/lore/component/create").then().statusCode(200);
        admin().body(Map.of("spec_id", SPEC, "title", "проба исходов связи спеки", "content_md", "# x"))
            .when().post("/lore/spec").then().statusCode(200);
    }

    @Test
    @Order(2)
    void firstAddIsCreated() {
        admin().body(link(C1, "add")).when().post("/lore/spec/link")
            .then().statusCode(200)
            .body("outcome", equalTo("created"))
            .body("ok", equalTo(true));
    }

    /** Повтор — {@code unchanged}, и ребро по-прежнему одно, а не два. */
    @Test
    @Order(3)
    void repeatedAddIsUnchangedAndDoesNotDuplicate() {
        admin().body(link(C1, "add")).when().post("/lore/spec/link")
            .then().statusCode(200)
            .body("outcome", equalTo("unchanged"));
        assertEquals(1, componentEdges(C1), "повтор add не должен создавать второе ребро");
    }

    /** Отказ не имеет права менять состояние: прежняя привязка обязана уцелеть. */
    @Test
    @Order(4)
    void replaceToMissingTargetKeepsCurrentLink() {
        admin().body(link("TEST-SPECOUT-НЕТ", "replace")).when().post("/lore/spec/link")
            .then().statusCode(404)
            .body("error", equalTo("TARGET_NOT_FOUND"));
        assertEquals(1, componentEdges(C1), "отклонённый replace снёс текущую привязку");
    }

    @Test
    @Order(5)
    void replaceSameTargetIsUnchanged() {
        admin().body(link(C1, "replace")).when().post("/lore/spec/link")
            .then().statusCode(200)
            .body("outcome", equalTo("unchanged"));
    }

    @Test
    @Order(6)
    void replaceToOtherTargetIsUpdated() {
        admin().body(link(C2, "replace")).when().post("/lore/spec/link")
            .then().statusCode(200)
            .body("outcome", equalTo("updated"));
        assertEquals(0, componentEdges(C1));
        assertEquals(1, componentEdges(C2));
    }

    /**
     * Снять НЕпривязанный компонент — {@code unchanged}, и настоящая привязка
     * цела. Раньше remove звал синхронизацию с пустым компонентом, а она
     * снимает ВСЕ рёбра BELONGS_TO спеки — то есть удаление чужого.
     */
    @Test
    @Order(7)
    void removingOtherComponentKeepsActualOne() {
        admin().body(link(C1, "remove")).when().post("/lore/spec/link")
            .then().statusCode(200)
            .body("outcome", equalTo("unchanged"));
        assertEquals(1, componentEdges(C2), "remove C1 снял привязку к C2");
    }

    @Test
    @Order(8)
    void removeExistingIsDeleted() {
        admin().body(link(C2, "remove")).when().post("/lore/spec/link")
            .then().statusCode(200)
            .body("outcome", equalTo("deleted"));
    }

    @Test
    @Order(9)
    void removeWhatIsNotThereIsUnchanged() {
        admin().body(link(C2, "remove")).when().post("/lore/spec/link")
            .then().statusCode(200)
            .body("outcome", equalTo("unchanged"));
    }
}
