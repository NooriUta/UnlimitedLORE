package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.path.json.JsonPath;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MD-04 — паспорта роли продукта, боли, выгоды, работы и ранбука на
 * живой базе: шапка и тело из строки *_by_id, связи профиля клиента — по рёбрам модели с обеих
 * сторон, и ни одного «не смогли проверить» в meta.data_state.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LiveTypesPassportLiveDbTest {

    private static final String ACTOR = "md04-role";
    private static final String PAIN = "md04-pain";
    private static final String GAIN = "md04-gain";
    private static final String JOB = "md04-job";
    private static final String RUNBOOK = "md04-runbook";

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    private static JsonPath record(String type, String id) {
        return given().header("X-Seer-Role", "admin").get("/lore/record/" + type + "/" + id)
            .then().statusCode(200).extract().jsonPath();
    }

    private static List<Map<String, Object>> errors(JsonPath r) {
        List<Map<String, Object>> st = r.getList("meta.data_state");
        assertNotNull(st, "meta.data_state есть");
        return st.stream().filter(e -> "error".equals(e.get("state"))).toList();
    }

    private static List<String> ends(JsonPath r, String rel, String dir) {
        List<Map<String, Object>> links = r.getList("links");
        return links.stream().filter(l -> rel.equals(l.get("rel")) && dir.equals(l.get("dir")))
            .map(l -> String.valueOf(l.get("id"))).toList();
    }

    @Test
    void customerProfileOpensWithLinksOnBothEnds() {
        post("/lore/project-actor", "{\"actor_id\":\"" + ACTOR + "\",\"name\":\"Роль MD-04\",\"kind\":\"human-role\",\"body_md\":\"кто это\"}");
        post("/lore/pain", "{\"pain_id\":\"" + PAIN + "\",\"title\":\"Боль MD-04\",\"severity\":\"high\",\"body_md\":\"больно\"}");
        post("/lore/gain", "{\"gain_id\":\"" + GAIN + "\",\"title\":\"Выгода MD-04\",\"rank\":\"expected\",\"metric_md\":\"−20 %\"}");
        post("/lore/job", "{\"job_id\":\"" + JOB + "\",\"title\":\"Работа MD-04\",\"kind\":\"functional\",\"importance\":\"high\"}");
        post("/lore/vp/link", "{\"source_id\":\"" + PAIN + "\",\"rel\":\"felt_by\",\"target_id\":\"" + ACTOR + "\"}");
        post("/lore/vp/link", "{\"source_id\":\"" + PAIN + "\",\"rel\":\"blocks\",\"target_id\":\"" + JOB + "\"}");
        post("/lore/vp/link", "{\"source_id\":\"" + GAIN + "\",\"rel\":\"success_of\",\"target_id\":\"" + JOB + "\"}");

        JsonPath pain = record("pain", PAIN);
        assertEquals(List.of(), errors(pain), "паспорт боли без сбоев");
        assertEquals("Боль MD-04", pain.getString("values.title"));
        assertEquals("high", pain.getString("values.severity"));
        assertEquals("больно", pain.getString("values.body_md"));
        assertEquals(List.of(ACTOR), ends(pain, "FELT_BY", "out"), "чья боль: " + pain.getList("links"));
        assertEquals(List.of(JOB), ends(pain, "BLOCKS", "out"));

        JsonPath job = record("job", JOB);
        assertEquals(List.of(), errors(job));
        assertEquals(List.of(PAIN), ends(job, "BLOCKS", "in"), "мешающая боль видна со стороны работы");
        assertEquals(List.of(GAIN), ends(job, "SUCCESS_OF", "in"));

        JsonPath gain = record("gain", GAIN);
        assertEquals(List.of(), errors(gain));
        assertEquals("−20 %", gain.getString("values.metric_md"));
        assertEquals(List.of(JOB), ends(gain, "SUCCESS_OF", "out"));

        JsonPath actor = record("actor", ACTOR);
        assertEquals(List.of(), errors(actor));
        assertEquals("Роль MD-04", actor.getString("values.title"));
        assertEquals(List.of(PAIN), ends(actor, "FELT_BY", "in"), "боль роли видна с её стороны");

        // Положительный контроль: вкладка прочитана по ребру, а не пропущена.
        List<Map<String, Object>> st = actor.getList("meta.data_state");
        assertTrue(st.stream().anyMatch(e -> "edge:FELT_BY:in".equals(String.valueOf(e.get("source"))) && "ok".equals(e.get("state"))),
            "вкладка «Боли» роли прочитана по ребру: " + st);
    }

    @Test
    void runbookOpensWithBody() {
        post("/lore/runbook", "{\"runbook_id\":\"" + RUNBOOK + "\",\"name\":\"Ранбук MD-04\",\"area\":\"infra\",\"content_md\":\"шаг 1\"}");
        JsonPath r = record("runbook", RUNBOOK);
        assertEquals(List.of(), errors(r), "паспорт ранбука без сбоев: пустые ADR — проверенный ноль");
        assertEquals("Ранбук MD-04", r.getString("values.title"));
        assertEquals("infra", r.getString("values.area"));
        assertEquals("шаг 1", r.getString("values.content_md"));
        assertEquals(List.of(), ends(r, "REFERENCES_ADR", "out"));
    }

    @Test
    void unknownIdIsNotFound() {
        for (String t : List.of("actor", "pain", "gain", "job", "runbook"))
            given().header("X-Seer-Role", "admin").get("/lore/record/" + t + "/md04-no-such")
                .then().statusCode(404);
    }
}
