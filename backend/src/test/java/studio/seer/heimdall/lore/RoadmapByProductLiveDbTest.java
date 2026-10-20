package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * RM-T1: инварианты дорожной карты продукта — на живой ArcadeDB, через срезы.
 *
 * <p>Вердикт «веха без продукта краснеет» уже покрыт ({@code WorkQualityTest},
 * RM-S3). Здесь — то, что не покрывалось ничем:
 * <ol>
 *   <li><b>направление ребра</b>: веха → продукт читается как продукт ВЕХИ, а
 *       состав продукта (компоненты) вехами не засоряется — отдельный тип
 *       {@code TARGETS_PRODUCT} существует ровно ради этого;</li>
 *   <li><b>чужое не видно</b>: карта продукта A не отдаёт ни одной вехи продукта
 *       B. «Отдаёт своё» ловится глазами, «не отдаёт чужое» — только тестом;</li>
 *   <li><b>пустая веха не исчезает</b>: веха без спринтов — сигнал, а не мусор;</li>
 *   <li><b>общая веха</b> видна в картах обоих продуктов ({@code CONTAINS});</li>
 *   <li><b>работа вне плана</b>: спринт продукта без вехи — в
 *       {@code roadmap_unplanned}, спринт с вехой — нет.</li>
 * </ol>
 * Три раза подряд в этом корпусе баг был в стороне ЧТЕНИЯ ребра (SUPERSEDES,
 * DOCUMENTED_IN, статус решения) — поэтому проверяется выдача срезов, а не
 * факт записи.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class RoadmapByProductLiveDbTest {

    private static final String P_A = "RMT1A";
    private static final String P_B = "RMT1B";
    private static final String COMP_A = "RMT1-COMP-A";
    private static final String COMP_B = "RMT1-COMP-B";
    private static final String S_A_PLANNED = "SPRINT_RMT1_A_PLANNED";
    private static final String S_A_FREE = "SPRINT_RMT1_A_FREE";
    private static final String S_B_PLANNED = "SPRINT_RMT1_B_PLANNED";
    private static final String M_A = "RMT1-MA";
    private static final String M_A_EMPTY = "RMT1-MA-EMPTY";
    private static final String M_B = "RMT1-MB";
    private static final String M_AB = "RMT1-MAB";

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "superadmin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    private static List<Map<String, Object>> rows(String slice, String query) {
        return given().contentType("application/json")
            .when().get("/lore/slice/" + slice + (query.isEmpty() ? "" : "?" + query))
            .then().statusCode(200)
            .extract().jsonPath().getList("rows");
    }

    private static List<String> ids(List<Map<String, Object>> rows, String field) {
        return rows.stream().map(r -> String.valueOf(r.get(field))).toList();
    }

    @Test
    @Order(1)
    void setUp() {
        for (String p : List.of(P_A, P_B)) {
            post("/lore/dict/entry", "{\"dict_type\":\"product\",\"code\":\"" + p + "\",\"label_ru\":\"RM-T1 " + p + "\"}");
        }
        post("/lore/component/create", "{\"component_id\":\"" + COMP_A + "\",\"full_name\":\"RM-T1 компонент A\",\"area\":\"core\"}");
        post("/lore/component/create", "{\"component_id\":\"" + COMP_B + "\",\"full_name\":\"RM-T1 компонент B\",\"area\":\"core\"}");
        post("/lore/product/link", "{\"product_code\":\"" + P_A + "\",\"rel\":\"component\",\"target_id\":\"" + COMP_A + "\"}");
        post("/lore/product/link", "{\"product_code\":\"" + P_B + "\",\"rel\":\"component\",\"target_id\":\"" + COMP_B + "\"}");

        for (String[] s : new String[][] {{S_A_PLANNED, COMP_A}, {S_A_FREE, COMP_A}, {S_B_PLANNED, COMP_B}}) {
            post("/lore/sprint/create", "{\"sprint_id\":\"" + s[0] + "\",\"name\":\"RM-T1 " + s[0] + "\"}");
            post("/lore/sprint/component", "{\"sprint_id\":\"" + s[0] + "\",\"component_id\":\"" + s[1] + "\"}");
        }

        for (String m : List.of(M_A, M_A_EMPTY, M_B, M_AB)) {
            post("/lore/milestone", "{\"milestone_id\":\"" + m + "\",\"label\":\"RM-T1 " + m + "\",\"date_display\":\"2026-12-01\"}");
        }
        post("/lore/milestone/product", "{\"milestone_id\":\"" + M_A + "\",\"product_code\":\"" + P_A + "\",\"action\":\"add\"}");
        post("/lore/milestone/product", "{\"milestone_id\":\"" + M_A_EMPTY + "\",\"product_code\":\"" + P_A + "\",\"action\":\"add\"}");
        post("/lore/milestone/product", "{\"milestone_id\":\"" + M_B + "\",\"product_code\":\"" + P_B + "\",\"action\":\"add\"}");
        post("/lore/milestone/product", "{\"milestone_id\":\"" + M_AB + "\",\"product_code\":\"" + P_A + "\",\"action\":\"add\"}");
        post("/lore/milestone/product", "{\"milestone_id\":\"" + M_AB + "\",\"product_code\":\"" + P_B + "\",\"action\":\"add\"}");

        post("/lore/milestone/sprints", "{\"milestone_id\":\"" + M_A + "\",\"sprint_ids\":[\"" + S_A_PLANNED + "\"]}");
        post("/lore/milestone/sprints", "{\"milestone_id\":\"" + M_B + "\",\"sprint_ids\":[\"" + S_B_PLANNED + "\"]}");
    }

    @Test
    @Order(2)
    void roadmapOfProductShowsOwnMilestonesAndNoForeignOnes() {
        List<String> a = ids(rows("roadmap", "code=" + P_A), "milestone_id");
        assertTrue(a.containsAll(List.of(M_A, M_A_EMPTY, M_AB)), "карта A обязана отдать свои вехи: " + a);
        assertFalse(a.contains(M_B), "карта A отдала веху продукта B — фильтр по продукту не работает: " + a);

        List<String> b = ids(rows("roadmap", "code=" + P_B), "milestone_id");
        assertTrue(b.containsAll(List.of(M_B, M_AB)), "карта B обязана отдать свои вехи: " + b);
        assertFalse(b.contains(M_A) || b.contains(M_A_EMPTY), "карта B отдала вехи продукта A: " + b);
    }

    @Test
    @Order(3)
    void emptyMilestoneStaysVisibleWithZeroSprints() {
        Map<String, Object> empty = rows("roadmap", "code=" + P_A).stream()
            .filter(r -> M_A_EMPTY.equals(r.get("milestone_id"))).findFirst().orElse(null);
        assertTrue(empty != null, "веха без спринтов исчезла из карты — а она сигнал, а не мусор");
        assertEquals(0, ((Number) empty.get("sprint_count")).intValue(), "у пустой вехи ноль спринтов");
    }

    @Test
    @Order(4)
    void edgeIsReadAsProductOfMilestoneAndDoesNotLeakIntoProductComposition() {
        Map<String, Object> m = rows("milestones", "").stream()
            .filter(r -> M_A.equals(r.get("milestone_id"))).findFirst().orElseThrow();
        assertEquals(List.of(P_A), m.get("products"), "продукт вехи читается по ребру веха → продукт");

        Map<String, Object> p = rows("products", "").stream()
            .filter(r -> P_A.equals(r.get("code"))).findFirst().orElseThrow();
        // Состав продукта — только компоненты. Будь веха на общем типе ребра
        // IN_PRODUCT, она пришла бы сюда пустым значением.
        assertEquals(List.of(COMP_A), p.get("components"),
            "в составе продукта появилось лишнее — веха легла на ребро состава");
    }

    @Test
    @Order(5)
    void unplannedWorkIsTheProductSprintsWithoutAMilestone() {
        List<String> free = ids(rows("roadmap_unplanned", "code=" + P_A), "sprint_id");
        assertTrue(free.contains(S_A_FREE), "спринт продукта без вехи обязан быть в работе вне плана: " + free);
        assertFalse(free.contains(S_A_PLANNED), "спринт с вехой попал в работу вне плана: " + free);
        assertFalse(free.contains(S_B_PLANNED), "в работу вне плана A попал спринт продукта B: " + free);
    }
}
