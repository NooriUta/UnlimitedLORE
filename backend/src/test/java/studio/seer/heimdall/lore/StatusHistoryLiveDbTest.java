package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import io.quarkus.test.security.jwt.Claim;
import io.quarkus.test.security.jwt.JwtSecurity;
import org.junit.jupiter.api.BeforeAll;
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
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-13 — у любого элемента смена статуса = новая
 * версия истории по одной схеме (StatusHistoryService.transition).
 *
 * <p>До S2-13: статус ADR менялся голым UPDATE вершины (в KnowADRHist — одни
 * тела), статус спеки правился на открытой строке на месте, у решений истории
 * не было вовсе. Каждый тест здесь падает на той редакции.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class StatusHistoryLiveDbTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    static final String SUB = "s213-owner-sub";

    @BeforeAll
    static void waitForResource() {
        assertNotNull(LoreArcadeDbTestResource.BASE_URL, "test resource must have started the container first");
    }

    private List<Map<String, Object>> query(String sql, Map<String, Object> params) {
        return call("query", "sql", sql, params);
    }

    /** Запись в обход REST — только для подготовки «легаси»-данных бэкфилла. */
    private List<Map<String, Object>> command(String language, String sql, Map<String, Object> params) {
        return call("command", language, sql, params);
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> call(String endpoint, String language, String sql, Map<String, Object> params) {
        try {
            String auth = "Basic " + Base64.getEncoder().encodeToString(
                ("root:" + LoreArcadeDbTestResource.ROOT_PASSWORD).getBytes(StandardCharsets.UTF_8));
            Map<String, Object> body = Map.of("language", language, "command", sql, "params", params);
            HttpRequest req = HttpRequest.newBuilder(URI.create(
                    LoreArcadeDbTestResource.BASE_URL + "/api/v1/" + endpoint + "/" + LoreArcadeDbTestResource.TEST_DB))
                .header("Authorization", auth).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(MAPPER.writeValueAsString(body))).build();
            HttpResponse<String> resp = LiveDbHttp.client().send(req, HttpResponse.BodyHandlers.ofString());
            assertEquals(200, resp.statusCode(), "verification query failed: " + resp.body());
            Object result = MAPPER.readValue(resp.body(), Map.class).get("result");
            return result instanceof List ? (List<Map<String, Object>>) result : List.of();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private void post(String path, String json) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(json)
            .when().post(path).then().statusCode(200);
    }

    private int postStatus(String path, String json) {
        return given().header("X-Seer-Role", "admin").contentType("application/json").body(json)
            .when().post(path).then().extract().statusCode();
    }

    private List<Map<String, Object>> hist(String histType, String key, String id) {
        return query("SELECT * FROM " + histType + " WHERE in('HAS_STATE')." + key
            + " CONTAINS :id ORDER BY valid_from", Map.of("id", id));
    }

    private static Map<String, Object> open(List<Map<String, Object>> rows) {
        List<Map<String, Object>> o = rows.stream().filter(r -> r.get("valid_to") == null).toList();
        assertEquals(1, o.size(), "ровно одна открытая версия: " + rows);
        return o.get(0);
    }

    private static void versionSchema(Map<String, Object> v, String status, String category, String what) {
        assertEquals(status, v.get("status_raw"), what + ": статус версии " + v);
        assertEquals(category, v.get("status_category"), what + ": категория " + v);
        assertEquals("human", v.get("changed_by_kind"), what + ": автор " + v);
        assertEquals(SUB, v.get("changed_by"), what + ": автор " + v);
        assertNotNull(v.get("valid_from"), what);
        assertNotNull(v.get("state_uid"), what);
    }

    // ── ADR: статус — версией истории, тела переносятся ──

    @Test
    @TestSecurity(user = "s213", roles = {"admin"})
    @JwtSecurity(claims = {@Claim(key = "sub", value = SUB)})
    void adrStatusChangeOpensAVersionAndCarriesBodies() {
        String id = "ADR-S213-FLOW";
        post("/lore/adr", "{\"adr_id\":\"" + id + "\",\"name\":\"s213\",\"context_md\":\"контекст\"}");
        List<Map<String, Object>> v1 = hist("KnowADRHist", "adr_id", id);
        assertEquals(1, v1.size(), "создание — одна версия, и в ней статус: " + v1);
        versionSchema(v1.get(0), "PROPOSED", "in_progress", "ADR при создании");
        assertEquals("контекст", v1.get(0).get("context_md"));

        post("/lore/status", "{\"entity_type\":\"adr\",\"id\":\"" + id + "\",\"status\":\"accepted\"}");
        List<Map<String, Object>> v2 = hist("KnowADRHist", "adr_id", id);
        assertEquals(2, v2.size(), "смена статуса — новая версия: " + v2);
        Map<String, Object> cur = open(v2);
        versionSchema(cur, "ACCEPTED", "in_force", "ADR после accepted");
        assertEquals("контекст", cur.get("context_md"), "тело перенесено в новую версию");
        assertEquals("ACCEPTED", query("SELECT status FROM KnowADR WHERE adr_id=:id", Map.of("id", id)).get(0).get("status"),
            "денормализованный статус на вершине");

        // Статус через adr_set — тот же сервис.
        post("/lore/adr", "{\"adr_id\":\"" + id + "\",\"name\":\"s213\",\"status\":\"SUPERSEDED\"}");
        assertEquals(3, hist("KnowADRHist", "adr_id", id).size());
        // Положительный контроль: тот же статус повторно версию не открывает, правка тела — тоже.
        post("/lore/adr", "{\"adr_id\":\"" + id + "\",\"name\":\"s213\",\"status\":\"SUPERSEDED\",\"decision_md\":\"d\"}");
        List<Map<String, Object>> v4 = hist("KnowADRHist", "adr_id", id);
        assertEquals(3, v4.size(), v4.toString());
        assertEquals("SUPERSEDED", open(v4).get("status_raw"));
    }

    @Test
    @TestSecurity(user = "s213", roles = {"admin"})
    @JwtSecurity(claims = {@Claim(key = "sub", value = SUB)})
    void adrCheckpointKeepsStatusInTheNewBodyVersion() {
        String id = "ADR-S213-CHECKPOINT";
        post("/lore/adr", "{\"adr_id\":\"" + id + "\",\"name\":\"s213\",\"context_md\":\"v1\",\"status\":\"accepted\"}");
        post("/lore/adr", "{\"adr_id\":\"" + id + "\",\"name\":\"s213\",\"context_md\":\"v2\",\"checkpoint\":true}");
        Map<String, Object> cur = open(hist("KnowADRHist", "adr_id", id));
        assertEquals("v2", cur.get("context_md"));
        assertEquals("accepted", String.valueOf(cur.get("status_raw")).toLowerCase(),
            "правка тела не стирает статус из истории: " + cur);
    }

    // ── S2-15: устаревший план «открытой версии нет» не открывает вторую ──

    @Test
    @TestSecurity(user = "s213", roles = {"admin"})
    @JwtSecurity(claims = {@Claim(key = "sub", value = SUB)})
    void stalePlanWithoutOpenVersionDoesNotOpenASecondOne() {
        String id = "ADR-S215-STALE";
        post("/lore/adr", "{\"adr_id\":\"" + id + "\",\"name\":\"s215\"}");
        assertEquals(1, hist("KnowADRHist", "adr_id", id).size());
        // План построен так, будто открытой версии не видно (окно соседнего писателя
        // между закрытием и вставкой), а она на самом деле есть.
        StatusHistoryService.Plan plan = StatusHistoryService.plan(StatusHistoryService.KINDS.get("adr"), id,
            null, "ACCEPTED", null, ChangeAuthor.UNKNOWN, "2026-11-08T23:00:00Z", "S215-NSID");
        List<Map<String, Object>> res = command("sqlscript", plan.script(), plan.params());
        assertTrue(Scd2Guard.isConflict(res), "скрипт отказал маркером конфликта: " + res);
        List<Map<String, Object>> rows = hist("KnowADRHist", "adr_id", id);
        assertEquals(1, rows.size(), "вторая версия не открыта: " + rows);
        open(rows);
    }

    // ── Гонка: две смены с одним «было» — одна версия и один 409 ──

    @Test
    void concurrentAdrTransitionsWithSameExpectedGiveOneVersionAndOneConflict() throws Exception {
        String id = "ADR-S213-RACE";
        post("/lore/adr", "{\"adr_id\":\"" + id + "\",\"name\":\"race\",\"status\":\"accepted\"}");
        CountDownLatch go = new CountDownLatch(1);
        List<CompletableFuture<Integer>> calls = new ArrayList<>();
        for (String to : List.of("superseded", "deferred")) {
            calls.add(CompletableFuture.supplyAsync(() -> {
                try { go.await(); } catch (InterruptedException e) { throw new RuntimeException(e); }
                return postStatus("/lore/status", "{\"entity_type\":\"adr\",\"id\":\"" + id
                    + "\",\"status\":\"" + to + "\",\"expected\":\"accepted\"}");
            }));
        }
        go.countDown();
        List<Integer> codes = calls.stream().map(CompletableFuture::join).sorted().toList();
        assertEquals(List.of(200, 409), codes, "одна смена проходит, вторая — 409");
        List<Map<String, Object>> rows = hist("KnowADRHist", "adr_id", id);
        open(rows);
        assertEquals(2, rows.size(), rows.toString());
    }

    // ── Спека: статус — версией, не правкой на месте ──

    @Test
    @TestSecurity(user = "s213", roles = {"admin"})
    @JwtSecurity(claims = {@Claim(key = "sub", value = SUB)})
    void specStatusChangeKeepsThePreviousStatusInHistory() {
        String id = "SPEC-S213-FLOW";
        post("/lore/spec", "{\"spec_id\":\"" + id + "\",\"title\":\"s213\",\"content_md\":\"тело\",\"status\":\"proposed\"}");
        post("/lore/spec", "{\"spec_id\":\"" + id + "\",\"status\":\"accepted\"}");
        List<Map<String, Object>> rows = hist("KnowSpecHist", "spec_id", id);
        assertEquals(2, rows.size(), "прежний статус остаётся в закрытой версии: " + rows);
        assertEquals("proposed", rows.stream().filter(r -> r.get("valid_to") != null).findFirst().orElseThrow().get("status"));
        Map<String, Object> cur = open(rows);
        versionSchema(cur, "accepted", "in_force", "спека");
        assertEquals("accepted", cur.get("status"), "прежнее поле статуса спеки — в ногу");
        assertEquals("тело", cur.get("content_md"), "тело перенесено");
    }

    // ── Решение: история появилась ──

    @Test
    @TestSecurity(user = "s213", roles = {"admin"})
    @JwtSecurity(claims = {@Claim(key = "sub", value = SUB)})
    void decisionStatusHasHistory() {
        String id = "D-2026-S213-FLOW";
        post("/lore/decision", "{\"decision_id\":\"" + id + "\",\"title\":\"s213\",\"status\":\"proposed\"}");
        List<Map<String, Object>> v1 = hist("KnowDecisionHist", "decision_id", id);
        assertEquals(1, v1.size(), "у решения есть первая версия статуса: " + v1);
        versionSchema(v1.get(0), "proposed", "in_progress", "решение при создании");
        post("/lore/decision/status", "{\"decision_id\":\"" + id + "\",\"status\":\"accepted\"}");
        List<Map<String, Object>> v2 = hist("KnowDecisionHist", "decision_id", id);
        assertEquals(2, v2.size(), v2.toString());
        versionSchema(open(v2), "accepted", "in_force", "решение после accepted");
        assertEquals("accepted", query("SELECT status_raw FROM KnowDecision WHERE decision_id=:id", Map.of("id", id))
            .get(0).get("status_raw"));
    }

    // ── Задача/спринт/фаза: тот же сервис, единая схема ──

    @Test
    @TestSecurity(user = "s213", roles = {"admin"})
    @JwtSecurity(claims = {@Claim(key = "sub", value = SUB)})
    void planTypesGetTheUnifiedVersionSchemaAndStateOwnedFieldsStayBehind() {
        String sid = "SPRINT_S213_PLAN";
        post("/lore/sprint/create", "{\"sprint_id\":\"" + sid + "\"}");
        post("/lore/status", "{\"entity_type\":\"sprint\",\"id\":\"" + sid + "\",\"status\":\"blocked\",\"reason\":\"ждём\"}");
        post("/lore/status", "{\"entity_type\":\"sprint\",\"id\":\"" + sid + "\",\"status\":\"active\"}");
        Map<String, Object> s = open(hist("KnowSprintHist", "sprint_id", sid));
        versionSchema(s, "🔄 IN PROGRESS", "in_progress", "спринт");
        assertNull(s.get("block_reason"), "причина блокировки уходит вместе с состоянием: " + s);

        post("/lore/task", "{\"sprint_id\":\"" + sid + "\",\"task_id\":\"T1\",\"title\":\"s213\",\"note_md\":\"заметка\"}");
        post("/lore/status", "{\"entity_type\":\"task\",\"id\":\"" + sid + "/T1\",\"status\":\"active\"}");
        Map<String, Object> t = open(hist("KnowTaskHist", "task_uid", sid + "/T1"));
        versionSchema(t, "🔄 IN PROGRESS", "in_progress", "задача");
        assertEquals("заметка", t.get("note_md"));

        post("/lore/phase", "{\"sprint_id\":\"" + sid + "\",\"phase_key\":\"A\"}");
        post("/lore/status", "{\"entity_type\":\"phase\",\"id\":\"" + sid + "/PHASE_A\",\"status\":\"done\"}");
        versionSchema(open(hist("KnowPhaseHist", "phase_uid", sid + "/PHASE_A")), "✅ DONE", "finished", "фаза");
    }

    // ── Бэкфилл V68 на живой базе: статус в истории у тех, у кого его не было ──

    @Test
    void backfillStampsDocsWithoutStatusHistoryHonestly() {
        // ADR «до S2-13»: статус только на вершине, в истории — тело без статуса.
        command("sql", "INSERT INTO KnowADR SET adr_id='ADR-S213-LEGACY', name='legacy', status='ACCEPTED'", Map.of());
        command("sql", "INSERT INTO KnowADRHist SET state_uid='s213-legacy', valid_from='2026-01-01 00:00:00', context_md='old'", Map.of());
        command("sql", "CREATE EDGE HAS_STATE FROM (SELECT FROM KnowADR WHERE adr_id='ADR-S213-LEGACY') "
            + "TO (SELECT FROM KnowADRHist WHERE state_uid='s213-legacy')", Map.of());
        command("sql", "INSERT INTO KnowDecision SET decision_id='D-S213-LEGACY', title='legacy', status_raw='accepted'", Map.of());

        StatusHistoryService.Db db = new StatusHistoryService.Db() {
            @Override public List<Map<String, Object>> query(String sql, Map<String, Object> p) {
                return command("sql", sql, p);
            }
            @Override public Object script(String sql, Map<String, Object> p) {
                return command("sqlscript", sql, p);
            }
        };
        StatusHistoryService.backfill(db, "2026-11-08T00:00:00Z");

        List<Map<String, Object>> adr = hist("KnowADRHist", "adr_id", "ADR-S213-LEGACY");
        assertEquals(1, adr.size(), "новой версии бэкфилл не открывает: " + adr);
        assertEquals("ACCEPTED", adr.get(0).get("status_raw"));
        assertEquals(Boolean.TRUE, adr.get(0).get("status_backfilled"));
        assertEquals("2026-11-08T00:00:00Z", adr.get(0).get("status_known_from"));
        assertTrue(String.valueOf(adr.get(0).get("valid_from")).startsWith("2026-01-01"), "дата версии не сдвинута");

        List<Map<String, Object>> dec = hist("KnowDecisionHist", "decision_id", "D-S213-LEGACY");
        assertEquals(1, dec.size(), "решение без истории получило одну версию: " + dec);
        assertEquals("accepted", dec.get(0).get("status_raw"));
        assertEquals(Boolean.TRUE, dec.get(0).get("status_backfilled"));

        // Идемпотентность — положительный контроль повтора.
        StatusHistoryService.backfill(db, "2026-11-09T00:00:00Z");
        assertEquals(1, hist("KnowDecisionHist", "decision_id", "D-S213-LEGACY").size());
        assertEquals("2026-11-08T00:00:00Z", hist("KnowADRHist", "adr_id", "ADR-S213-LEGACY").get(0).get("status_known_from"));
    }
}
