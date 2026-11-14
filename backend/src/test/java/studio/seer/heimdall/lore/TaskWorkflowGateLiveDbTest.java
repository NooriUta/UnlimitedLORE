package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.response.Response;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_WORK_ANY_KIND/WK-05, ADR-LORE-014-D5 — гейт на живой базе: отказ ДО записи (статус не
 * меняется), доказательство ложится в строку истории и переносится с review до done; blocked без
 * причины и waiting без адресата — 400. Только CI (живая ArcadeDB).
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class TaskWorkflowGateLiveDbTest {

    static final String SPRINT = "SPRINT_WK05_GATE";

    @Inject
    LoreIngestService ingest;

    private static Response status(String uid, String extra) {
        return given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"entity_type\":\"task\",\"id\":\"" + uid + "\"," + extra + "}")
            .when().post("/lore/status");
    }

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    private Map<String, Object> openRow(String uid) {
        List<Map<String, Object>> rows = ingest.queryPublic(
            "SELECT status_raw, evidence_type, evidence_ref, waiting_for, status_reason FROM KnowTaskHist "
                + "WHERE in('HAS_STATE').task_uid CONTAINS :u AND valid_to IS NULL", Map.of("u", uid));
        assertEquals(1, rows.size(), "одна открытая строка истории: " + rows);
        return rows.get(0);
    }

    @Test
    void gateRefusesBeforeWriteAndEvidenceTravelsToDone() {
        post("/lore/sprint/create", "{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"Гейт WK-05\"}");
        post("/lore/task", "{\"sprint_id\":\"" + SPRINT + "\",\"task_id\":\"G-1\",\"title\":\"Задача гейта\",\"task_type\":\"ops\"}");
        String uid = SPRINT + "/G-1";
        assertEquals(200, status(uid, "\"status\":\"active\"").statusCode());


        Response blocked = status(uid, "\"status\":\"blocked\"");
        assertEquals(400, blocked.statusCode());
        assertEquals("REASON_REQUIRED", blocked.jsonPath().getString("error"));
        Response waiting = status(uid, "\"status\":\"waiting\"");
        assertEquals("WAITING_FOR_REQUIRED", waiting.jsonPath().getString("error"));

        // доказательство прикладывается при переходе в review…
        assertEquals(200, status(uid, "\"status\":\"review\",\"stage\":\"stand_check\","
            + "\"evidence_type\":\"probe\",\"evidence_ref\":\"10 из 10 прогонов без OOM\"").statusCode());
        assertEquals("probe", openRow(uid).get("evidence_type"));

        // PU-29 (правило владелицы 14.11.2026): done человека — само подтверждение; строка done несёт
        // доказательство «человек · когда», записанное сервером.
        Response done = status(uid, "\"status\":\"done\"");
        assertEquals(200, done.statusCode(), done.asString());
        Map<String, Object> row = openRow(uid);
        assertEquals("✅ DONE", row.get("status_raw"));
        assertEquals("human", row.get("evidence_type"));
        assertTrue(String.valueOf(row.get("evidence_ref")).contains(" · "), String.valueOf(row.get("evidence_ref")));
    }

    @Test
    void humanDoneWithoutEvidencePasses() {
        post("/lore/sprint/create", "{\"sprint_id\":\"" + SPRINT + "_2\",\"name\":\"Гейт WK-05, без доказательства\"}");
        post("/lore/task", "{\"sprint_id\":\"" + SPRINT + "_2\",\"task_id\":\"G-2\",\"title\":\"Без доказательства\"}");
        String uid = SPRINT + "_2/G-2";
        assertEquals(200, status(uid, "\"status\":\"ready_for_deploy\"").statusCode(), "старый токен — стадия review");
        // Ровно случай с прода 14.11.2026: человек жмёт DONE на «к выкатке» — проходит без доказательства.
        Response r = status(uid, "\"status\":\"done\"");
        assertEquals(200, r.statusCode(), r.asString());
        assertEquals("✅ DONE", openRow(uid).get("status_raw"));
        assertEquals("human", openRow(uid).get("evidence_type"));
    }
}
