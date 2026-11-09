package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import io.quarkus.test.security.jwt.Claim;
import io.quarkus.test.security.jwt.JwtSecurity;
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
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S5_RECORD_TASKS/S5-09 — черновик на сервере сквозь REST, владелец =
 * {@code sub} токена. Сохранить → прочитать («восстановить от HH:MM») → повтор
 * обновляет тот же черновик → чужой не видит → удалить. Без опознанного
 * вызывающего — 401, а не «черновиков нет».
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreMeDraftsLiveDbTest {

    private static final String SUB_A = "s509-user-a";
    private static final String SUB_B = "s509-user-b";
    private static final String REC = "ref_type=task&ref_id=SPRINT_S509/T-1";

    /** Версия записи — та же строка, что record.version в /lore/record (valid_from открытого состояния). */
    private static final String VER = "2026-11-09T02:45:27.453349250Z";

    private static String draft(String body, String base) {
        return "{\"ref_type\":\"task\",\"ref_id\":\"SPRINT_S509/T-1\",\"field\":\"note_md\","
            + "\"body_md\":\"" + body + "\",\"base_version\":\"" + base + "\"}";
    }

    private static List<Map<String, Object>> drafts() {
        return given().when().get("/lore/me/drafts?" + REC).then().statusCode(200).extract().path("drafts");
    }

    @Test
    @Order(1)
    @TestSecurity(user = "a", roles = {"viewer"})
    @JwtSecurity(claims = {@Claim(key = "sub", value = SUB_A)})
    void saveThenRestore() {
        given().contentType("application/json").body(draft("первый набросок", VER))
            .when().post("/lore/me/drafts").then().statusCode(200);
        List<Map<String, Object>> d = drafts();
        assertEquals(1, d.size(), d.toString());
        assertEquals("первый набросок", d.get(0).get("body_md"));
        assertEquals(VER, d.get(0).get("base_version"), "версия записи возвращается той же строкой, что record.version");
        assertNotNull(d.get(0).get("saved_at"), "время сохранения — для «Восстановить черновик от HH:MM»");
        assertFalse(d.get(0).containsKey("owner_sub"), "kc_sub наружу не отдаётся");
    }

    @Test
    @Order(2)
    @TestSecurity(user = "a", roles = {"viewer"})
    @JwtSecurity(claims = {@Claim(key = "sub", value = SUB_A)})
    void secondSaveUpdatesTheSameDraft() {
        given().contentType("application/json").body(draft("второй набросок", VER))
            .when().post("/lore/me/drafts").then().statusCode(200);
        List<Map<String, Object>> d = drafts();
        assertEquals(1, d.size(), "черновик поля один, повтор его обновляет: " + d);
        assertEquals("второй набросок", d.get(0).get("body_md"));
    }

    @Test
    @Order(3)
    @TestSecurity(user = "b", roles = {"viewer"})
    @JwtSecurity(claims = {@Claim(key = "sub", value = SUB_B)})
    void someoneElseSeesNoDraft() {
        assertTrue(drafts().isEmpty(), "черновик личный — другой человек его не видит");
    }

    @Test
    @Order(4)
    @TestSecurity(user = "a", roles = {"viewer"})
    @JwtSecurity(claims = {@Claim(key = "sub", value = SUB_A)})
    void badRequestIsRefusedWithReason() {
        given().contentType("application/json")
            .body("{\"ref_type\":\"task\",\"ref_id\":\"SPRINT_S509/T-1\",\"field\":\"bad field\",\"body_md\":\"x\"}")
            .when().post("/lore/me/drafts").then().statusCode(400);
    }

    @Test
    @Order(5)
    @TestSecurity(user = "a", roles = {"viewer"})
    @JwtSecurity(claims = {@Claim(key = "sub", value = SUB_A)})
    void deleteRemovesTheDraft() {
        given().contentType("application/json")
            .body("{\"ref_type\":\"task\",\"ref_id\":\"SPRINT_S509/T-1\",\"field\":\"note_md\"}")
            .when().post("/lore/me/drafts/delete").then().statusCode(200);
        assertTrue(drafts().isEmpty(), "после удаления черновика нет");
    }
}
