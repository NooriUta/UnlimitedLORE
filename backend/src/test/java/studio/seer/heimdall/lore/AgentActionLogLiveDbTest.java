package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * D-2026-LORE-AGENT-MACHINE-EVERYWHERE п.4 — V86 на изолированной БД: прежние точки lore.action
 * копируются в AgentActionLog с отметкой «неизвестно», связка одного момента — целиком,
 * повтор ничего не дублирует, источник не меняется. Проверка — чтением из БД.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class AgentActionLogLiveDbTest {

    private static final String TAG = "V86-PROBE-" + System.nanoTime();

    @Inject
    LoreSchemaMigrationRunner runner;

    private static List<Map<String, Object>> sql(String query) throws Exception {
        return sql(query, Map.of());
    }

    private static List<Map<String, Object>> sql(String query, Map<String, Object> params) throws Exception {
        String body = io.vertx.core.json.JsonObject.of("language", "sql", "command", query,
            "params", new io.vertx.core.json.JsonObject(params)).encode();
        HttpRequest req = HttpRequest.newBuilder(
                URI.create(LoreArcadeDbTestResource.BASE_URL + "/api/v1/command/" + LoreArcadeDbTestResource.TEST_DB))
            .header("Content-Type", "application/json")
            .header("Authorization", "Basic " + Base64.getEncoder().encodeToString(
                ("root:" + LoreArcadeDbTestResource.ROOT_PASSWORD).getBytes(StandardCharsets.UTF_8)))
            .POST(HttpRequest.BodyPublishers.ofString(body)).build();
        HttpResponse<String> r = LiveDbHttp.client().send(req, HttpResponse.BodyHandlers.ofString());
        assertTrue(r.statusCode() < 300, query + " → " + r.statusCode() + " " + r.body());
        io.vertx.core.json.JsonArray arr = new io.vertx.core.json.JsonObject(r.body())
            .getJsonArray("result", new io.vertx.core.json.JsonArray());
        List<Map<String, Object>> out = new java.util.ArrayList<>();
        for (int i = 0; i < arr.size(); i++) out.add(arr.getJsonObject(i).getMap());
        return out;
    }

    private static long n(String query) throws Exception {
        return ((Number) sql(query).get(0).get("n")).longValue();
    }

    @Test
    void legacyPointsAreCopiedOnceMarkedUnknown() throws Exception {
        // Момент — прошлое, но позже любых точек, которые мог оставить бутстрап.
        long t = 1_000_000_000_000L + (System.nanoTime() % 1_000_000);
        for (String[] p : new String[][] {{"a", "" + t}, {"b", "" + t}, {"c", "" + (t + 1)}})
            sql("INSERT INTO MetricSnapshot SET ts=" + p[1] + ", object_type='task', object_id='" + TAG + "-" + p[0]
                + "', metric='lore.action', source='full', segment='agent', value=200.0");
        String mine = "object_id LIKE '" + TAG + "-%'";
        long before = n("SELECT count(*) AS n FROM MetricSnapshot WHERE " + mine);

        runner.copyLegacyActions();
        assertEquals(3, n("SELECT count(*) AS n FROM AgentActionLog WHERE " + mine));
        assertEquals(3, n("SELECT count(*) AS n FROM AgentActionLog WHERE " + mine
            + " AND client = '(unknown)' AND machine = '(unknown)'"), "без догадки — «неизвестно»");
        assertEquals(1, n("SELECT count(*) AS n FROM AgentActionLog WHERE object_id = '" + TAG + "-c' AND ts = " + (t + 1)),
            "момент перенесён точно");

        runner.copyLegacyActions();
        assertEquals(3, n("SELECT count(*) AS n FROM AgentActionLog WHERE " + mine), "повтор не дублирует");
        assertEquals(before, n("SELECT count(*) AS n FROM MetricSnapshot WHERE " + mine), "источник не тронут");
    }

    /** AO-02: ребро следа — тип из V88, повтор не плодит рёбер, нет вершины — отказ (ресурс пишет «пропущено»). */
    @Test
    void sourceTrailEdgeIsIdempotentAndNeedsBothEnds() throws Exception {
        assertEquals(1, sql("SELECT name FROM schema:types WHERE name = 'SOURCED_FROM'").size(), "тип ребра создан V88");
        sql("INSERT INTO KnowADR SET adr_id = '" + TAG + "-ADR'");
        sql("INSERT INTO KnowSpec SET spec_id = '" + TAG + "-SPEC'");
        String edge = AgentSourceTrail.edgeSql(LoreModelTypes.GRAPH.get("adr"), LoreModelTypes.GRAPH.get("spec"));
        Map<String, Object> p = Map.of("tid", TAG + "-ADR", "sid", TAG + "-SPEC", "at", "2026-11-14T00:00:00Z", "via", "spec_by_id");
        assertEquals(1, sql(edge, p).size(), "ребро создано — ответ непуст");
        assertEquals(1, sql(edge, p).size(), "повтор отдаёт то же ребро — непуст (ресурс считает записанным)");
        assertEquals(1, n("SELECT count(*) AS n FROM SOURCED_FROM WHERE @out.adr_id = '" + TAG + "-ADR'"), "повтор не плодит рёбер");
        assertEquals(1, n("SELECT out('SOURCED_FROM').size() AS n FROM KnowADR WHERE adr_id = '" + TAG + "-ADR'"),
            "источник виден обходом графа");
        assertEquals("spec_by_id", sql("SELECT via FROM SOURCED_FROM WHERE @out.adr_id = '" + TAG + "-ADR'").get(0).get("via"));
        assertEquals(0, sql(edge, Map.of("tid", TAG + "-NONE", "sid", TAG + "-SPEC", "at", "x", "via", "")).size(),
            "нет вершины цели — ArcadeDB молча не создаёт: пустой ответ, ресурс пишет «пропущено»");
    }
}
