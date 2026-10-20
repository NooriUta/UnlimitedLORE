package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SE-05, хвост: решение под ДВУМЯ ADR обязано быть видно в паспорте КАЖДОГО.
 *
 * <p>Множественная принадлежность — замысел, а не порча (слова владелицы
 * 31.08.2026: «их не надо снимать — событие при группировке пусть показывает
 * в каждом проекте, в этом фишка; у нас бывают и спринты, и ADR совместные»).
 * Срез {@code decisions_of_adr} фильтровал {@code out('DECIDED_IN').adr_id[0] = :id}
 * — то есть решение находилось только под тем родителем, который случайно
 * окажется первым, а под вторым пропадало.
 *
 * <p>Проверка именно на ДВУХ родителях: на одном {@code [0] =} и
 * {@code CONTAINS} неразличимы, и тест был бы пустым.
 *
 * <p>Плюс контроль: решение под ОДНИМ ADR не должно протечь в паспорт чужого —
 * иначе «нашлось под обоими» неотличимо от «фильтр сломан и отдаёт всё».
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class DecisionUnderTwoAdrsLiveDbTest {

    private static final String ADR_A = "ADR-SE05-A";
    private static final String ADR_B = "ADR-SE05-B";
    private static final String ADR_C = "ADR-SE05-C";
    /** Решение под A и под B одновременно. */
    private static final String D_SHARED = "D-SE05-SHARED";
    /** Решение только под C — контроль против «отдаёт всё». */
    private static final String D_ONLY_C = "D-SE05-ONLY-C";

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "superadmin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    private static List<String> decisionsOf(String adrId) {
        return given().contentType("application/json")
            .when().get("/lore/slice/decisions_of_adr?id=" + adrId)
            .then().statusCode(200)
            .extract().jsonPath().getList("rows.decision_id", String.class);
    }

    @Test
    @Order(1)
    void setUp() {
        for (String adr : List.of(ADR_A, ADR_B, ADR_C)) {
            post("/lore/adr", "{\"adr_id\":\"" + adr + "\",\"name\":\"SE-05 " + adr + "\"}");
        }
        // Второй вызов с другим adr_id создаёт ВТОРОЕ ребро DECIDED_IN, а не
        // переносит решение (SE-04: так устроен decision_new). Это и есть
        // законная двойная принадлежность.
        String body = "\"title\":\"Общее решение двух ADR\",\"body_md\":\"Принадлежит обоим.\"";
        post("/lore/decision", "{\"decision_id\":\"" + D_SHARED + "\"," + body + ",\"adr_id\":\"" + ADR_A + "\"}");
        post("/lore/decision", "{\"decision_id\":\"" + D_SHARED + "\"," + body + ",\"adr_id\":\"" + ADR_B + "\"}");
        post("/lore/decision", "{\"decision_id\":\"" + D_ONLY_C + "\",\"title\":\"Только под C\","
            + "\"body_md\":\"Один родитель.\",\"adr_id\":\"" + ADR_C + "\"}");
    }

    @Test
    @Order(2)
    void sharedDecisionIsListedUnderBothParents() {
        List<String> underA = decisionsOf(ADR_A);
        List<String> underB = decisionsOf(ADR_B);
        assertTrue(underA.contains(D_SHARED) && underB.contains(D_SHARED),
            "решение с двумя родителями обязано быть в паспорте КАЖДОГО ADR; "
            + "под A=" + underA + ", под B=" + underB
            + " — видно только под одним значит, что срез берёт родителя [0]");
        // И ровно один раз: CONTAINS по списку родителей не должен размножать строку.
        assertEquals(1, underA.stream().filter(D_SHARED::equals).count(),
            "общее решение пришло в паспорт A больше одного раза");
    }

    @Test
    @Order(3)
    void singleParentDecisionDoesNotLeakIntoOtherPassports() {
        assertTrue(decisionsOf(ADR_C).contains(D_ONLY_C), "своё решение в паспорте C обязано быть");
        assertTrue(!decisionsOf(ADR_A).contains(D_ONLY_C) && !decisionsOf(ADR_B).contains(D_ONLY_C),
            "решение только под C просочилось в паспорт чужого ADR — фильтр отдаёт лишнее");
    }
}
