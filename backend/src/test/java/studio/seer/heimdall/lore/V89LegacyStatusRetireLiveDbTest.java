package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;
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
import static org.hamcrest.Matchers.hasItem;
import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_PRODUCT_BACKLOG/SELF-PROVISION-STANDALONE, V89: перенос статусов из легаси-рёбер
 * HAS_STATUS и типа трека из OF_TYPE — раньше удаления, затем снятие Status* / TrackType.
 *
 * <p>Посев повторяет формы прода 14.11: закрытые строки задач и спринтов без status_raw, текущие
 * фаза и веха без него, строка со своим status_raw (не трогается), «unknown» (не переносится),
 * история-сирота решения, трек с OF_TYPE. Каждый результат читается обратно из базы.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class V89LegacyStatusRetireLiveDbTest {

    @Inject
    LoreSchemaMigrationRunner runner;

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

    private static Object one(String query, String field) throws Exception {
        List<Map<String, Object>> rows = sql(query);
        assertEquals(1, rows.size(), "ровно одна строка: " + query);
        return rows.get(0).get(field);
    }

    private static void status(String type, String id) throws Exception {
        sql("UPDATE " + type + " SET status_id='" + id + "' UPSERT WHERE status_id='" + id + "'");
    }

    private static void hasStatus(String histType, String stateUid, String statusType, String code) throws Exception {
        sql("CREATE EDGE HAS_STATUS FROM (SELECT FROM " + histType + " WHERE state_uid='" + stateUid + "') "
            + "TO (SELECT FROM " + statusType + " WHERE status_id='" + code + "')");
    }

    @Test
    void v89MovesStatusesThenDropsLegacyTypesAndRepeatIsNoop() throws Exception {
        // ── легаси-форма прода (чистая установка её больше не создаёт) ──
        for (String t : List.of("StatusTask", "StatusSprint", "StatusPhase", "StatusMilestone", "StatusDecision", "TrackType"))
            sql("CREATE VERTEX TYPE " + t + " IF NOT EXISTS");
        sql("CREATE EDGE TYPE HAS_STATUS IF NOT EXISTS");
        sql("CREATE EDGE TYPE OF_TYPE IF NOT EXISTS");
        status("StatusTask", "todo");
        status("StatusSprint", "closed");
        status("StatusSprint", "in_progress");
        status("StatusSprint", "unknown");
        status("StatusPhase", "planned");
        status("StatusMilestone", "upcoming");
        status("StatusDecision", "fixed");
        sql("UPDATE TrackType SET type_id='engine', label='Engine' UPSERT WHERE type_id='engine'");

        sql("CREATE VERTEX KnowTaskHist SET state_uid='v89-task'");
        hasStatus("KnowTaskHist", "v89-task", "StatusTask", "todo");
        sql("CREATE VERTEX KnowSprintHist SET state_uid='v89-sprint-closed'");
        hasStatus("KnowSprintHist", "v89-sprint-closed", "StatusSprint", "closed");
        sql("CREATE VERTEX KnowSprintHist SET state_uid='v89-sprint-own', status_raw='🟡 IN PROGRESS — своё'");
        hasStatus("KnowSprintHist", "v89-sprint-own", "StatusSprint", "in_progress");
        sql("CREATE VERTEX KnowSprintHist SET state_uid='v89-sprint-unknown'");
        hasStatus("KnowSprintHist", "v89-sprint-unknown", "StatusSprint", "unknown");
        sql("CREATE VERTEX KnowPhaseHist SET state_uid='v89-phase'");
        hasStatus("KnowPhaseHist", "v89-phase", "StatusPhase", "planned");

        sql("CREATE VERTEX KnowMilestone SET milestone_id='M-V89-PROBE', label='проба V89'");
        sql("CREATE VERTEX KnowMilestoneHist SET state_uid='v89-ms', goal_md='цель'");
        sql("CREATE EDGE HAS_STATE FROM (SELECT FROM KnowMilestone WHERE milestone_id='M-V89-PROBE') "
            + "TO (SELECT FROM KnowMilestoneHist WHERE state_uid='v89-ms')");
        hasStatus("KnowMilestoneHist", "v89-ms", "StatusMilestone", "upcoming");

        sql("CREATE VERTEX KnowDecisionHist SET state_uid='v89-orphan'");
        hasStatus("KnowDecisionHist", "v89-orphan", "StatusDecision", "fixed");

        sql("CREATE VERTEX PlanTrack SET track_id='V89-PROBE', label='проба'");
        sql("CREATE EDGE OF_TYPE FROM (SELECT FROM PlanTrack WHERE track_id='V89-PROBE') "
            + "TO (SELECT FROM TrackType WHERE type_id='engine')");
        assertTrue(((Number) one("SELECT count(*) AS n FROM HAS_STATUS", "n")).longValue() >= 7,
            "положительный контроль: рёбра посеяны");

        // ── шаг ──
        LoreSchemaMigrationRunner.LegacyStatusRetireOutcome out = runner.retireLegacyStatusTypes();

        // (б) перенос раньше удаления; своё status_raw не трогается; unknown не выдумывается
        assertEquals("⬜ TODO", one("SELECT status_raw FROM KnowTaskHist WHERE state_uid='v89-task'", "status_raw"));
        assertEquals("✅ CLOSED", one("SELECT status_raw FROM KnowSprintHist WHERE state_uid='v89-sprint-closed'", "status_raw"));
        assertEquals("🟡 IN PROGRESS — своё",
            one("SELECT status_raw FROM KnowSprintHist WHERE state_uid='v89-sprint-own'", "status_raw"));
        assertNull(one("SELECT status_raw FROM KnowSprintHist WHERE state_uid='v89-sprint-unknown'", "status_raw"));
        // (а) фаза — канон плана, веха — код milestone_status
        assertEquals("📋 PLANNED", one("SELECT status_raw FROM KnowPhaseHist WHERE state_uid='v89-phase'", "status_raw"));
        assertEquals("upcoming", one("SELECT status_raw FROM KnowMilestoneHist WHERE state_uid='v89-ms'", "status_raw"));
        // сирота снята, у не-сирот строки на месте
        assertEquals(0, sql("SELECT FROM KnowDecisionHist WHERE state_uid='v89-orphan'").size());
        // (в) тип трека — area
        assertEquals("engine", one("SELECT area FROM PlanTrack WHERE track_id='V89-PROBE'", "area"));

        for (String t : LoreSchemaMigrations.RETIRED_LEGACY_STATUS_TYPES)
            assertEquals(0, sql("SELECT name FROM schema:types WHERE name = '" + t + "'").size(), t + " снят из схемы");
        assertTrue(out.transferred() >= 5, "перенесено: " + out);
        assertTrue(out.noValue() >= 1 && out.orphanHistsDeleted() >= 1 && out.tracksMoved() >= 1, out.toString());

        // словари — в универсальном справочнике
        for (String row : List.of("milestone_status/upcoming", "phase_status/planned", "area/research", "area/business")) {
            String[] p = row.split("/");
            assertEquals(1, sql("SELECT FROM KnowDictEntry WHERE dict_type='" + p[0] + "' AND code='" + p[1] + "'").size(), row);
        }

        // чтение: паспорт вехи и срез треков
        given().header("X-Seer-Role", "admin").get("/lore/slice/milestone_by_id?id=M-V89-PROBE")
            .then().statusCode(200).body("rows.status", hasItem("upcoming"));
        given().header("X-Seer-Role", "admin").get("/lore/slice/plan_tracks")
            .then().statusCode(200).body("rows.findAll { it.track_id == 'V89-PROBE' }.type", hasItem("engine"));

        // ── повтор на чистой базе — no-op ──
        LoreSchemaMigrationRunner.LegacyStatusRetireOutcome again = runner.retireLegacyStatusTypes();
        assertEquals(new LoreSchemaMigrationRunner.LegacyStatusRetireOutcome(0, 0, 0, 0, 0, 0, 0, List.of()), again);
        assertEquals("⬜ TODO", one("SELECT status_raw FROM KnowTaskHist WHERE state_uid='v89-task'", "status_raw"));
    }
}
