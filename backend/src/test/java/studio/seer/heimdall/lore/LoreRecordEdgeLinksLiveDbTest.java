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
 * SPRINT_LORE_MODEL_AS_CONFIG/MC-04 · SPRINT_UXR_POLISH_UAT_1113/PU-02 на живой ArcadeDB: вкладки без
 * своего среза читаются по ребру из модели. Паспорт записи без сбоев не несёт ни одной строки
 * {@code state: error} в {@code meta.data_state} (то есть не говорит «Часть сведений не загрузилась»),
 * а «упоминает» видно с обеих сторон с видом конца. Живая БД — только в CI.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreRecordEdgeLinksLiveDbTest {

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    private static JsonPath record(String type, String id) {
        return given().header("X-Seer-Role", "admin").get("/lore/record/" + type + "/" + id)
            .then().statusCode(200).extract().jsonPath();
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> errors(JsonPath r) {
        List<Map<String, Object>> st = r.getList("meta.data_state");
        assertNotNull(st, "meta.data_state есть");
        return st.stream().filter(e -> "error".equals(e.get("state"))).toList();
    }

    private static Map<String, Object> link(JsonPath r, String rel, String dir, String id) {
        List<Map<String, Object>> links = r.getList("links");
        return links.stream().filter(l -> rel.equals(l.get("rel")) && dir.equals(l.get("dir")) && id.equals(l.get("id")))
            .findFirst().orElse(null);
    }

    @Test
    void referencesTabsAreReadByEdgeAndPassportHasNoUnreadSources() {
        post("/lore/sprint/create", "{\"sprint_id\":\"SPRINT_EDGE_LINKS\",\"name\":\"edge-links\"}");
        post("/lore/task", "{\"sprint_id\":\"SPRINT_EDGE_LINKS\",\"task_id\":\"T1\",\"title\":\"упомянутая задача\"}");
        post("/lore/adr", "{\"adr_id\":\"ADR-EDGE-LINKS\",\"name\":\"упоминающее решение\",\"status\":\"ACCEPTED\"}");
        post("/lore/link/mention", "{\"from_type\":\"adr\",\"from_id\":\"ADR-EDGE-LINKS\",\"to_type\":\"task\","
            + "\"to_id\":\"SPRINT_EDGE_LINKS/T1\",\"edge_type\":\"REFERENCES\"}");

        JsonPath task = record("task", "SPRINT_EDGE_LINKS/T1");
        assertEquals(List.of(), errors(task), "паспорт задачи без сбоев — ни одного «не смогли проверить» (PU-02)");
        Map<String, Object> in = link(task, "REFERENCES", "in", "ADR-EDGE-LINKS");
        assertNotNull(in, "на задачу ссылается ADR: " + task.getList("links"));
        assertEquals("adr", in.get("type"));
        assertEquals("упоминающее решение", in.get("title"));
        assertEquals("accepted", in.get("status"));

        JsonPath adr = record("adr", "ADR-EDGE-LINKS");
        assertEquals(List.of(), errors(adr), "паспорт ADR без сбоев");
        Map<String, Object> out = link(adr, "REFERENCES", "out", "SPRINT_EDGE_LINKS/T1");
        assertNotNull(out, "ADR ссылается на задачу: " + adr.getList("links"));
        assertEquals("task", out.get("type"));
        assertEquals("adr", out.get("fromKind"));
        assertEquals("task", out.get("toKind"));

        // Положительный контроль чтения: источник вкладки назван и прочитан, а не пропущен молча.
        List<Map<String, Object>> st = task.getList("meta.data_state");
        assertTrue(st.stream().anyMatch(e -> "edge:REFERENCES:in".equals(e.get("source")) && "ok".equals(e.get("state"))),
            "вкладка «На него ссылаются» прочитана по ребру: " + st);
    }

    @Test
    void sprintPassportWithoutEdgesReadsEveryTabAsCheckedEmpty() {
        post("/lore/sprint/create", "{\"sprint_id\":\"SPRINT_EDGE_EMPTY\",\"name\":\"edge-empty\"}");
        JsonPath s = record("sprint", "SPRINT_EDGE_EMPTY");
        assertEquals(List.of(), errors(s), "пустые вкладки — проверенный ноль, а не сбой");
        List<Map<String, Object>> st = s.getList("meta.data_state");
        for (String src : List.of("edge:REFERENCES:out", "edge:REFERENCES:in", "edge:PRODUCED_BY:in"))
            assertTrue(st.stream().anyMatch(e -> src.equals(e.get("source")) && "ok".equals(e.get("state"))), src + ": " + st);
    }
}
