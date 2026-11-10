package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.quarkus.test.common.QuarkusTestResource;
import jakarta.inject.Inject;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.path.json.JsonPath;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MODEL-RECORD — живая сверка снимков {@code GET /lore/record}
 * для четырёх прежних типов (спринт, задача, ADR, спека).
 *
 * <p>Эталон считается замороженной сборкой {@link LoreRecordSnapshotTest.Legacy} по тем же
 * строкам срезов, что читает фасад ({@code /lore/slice} с тем же скоупом): {@code values},
 * {@code links} и строки частей ответа обязаны совпасть с ним — ключи, порядок, значения.
 * Живая БД — только в CI.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreRecordSnapshotLiveDbTest {

    private static final String SFX = Long.toString(System.currentTimeMillis() % 1_000_000_000L);
    private static final String SID = "SPRINT_SNAP_" + SFX;
    private static final String TUID = SID + "/T-1";
    private static final String ADR = "ADR-SNAP-" + SFX;
    private static final String SPEC = "SPEC-SNAP-" + SFX;

    private io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    private void post(String path, String body) {
        admin().body(body).post(path).then().statusCode(200);
    }

    @Inject LoreIngestService ingest;
    @Inject AidaLoreResource sliceResource;
    @Inject ObjectMapper mapper;

    private JsonPath record(String type, String id) {
        return admin().get("/lore/record/" + type + "/" + id).then().statusCode(200).extract().jsonPath();
    }

    /** Строки среза ровно так, как их читает фасад: тот же compose, тот же скоуп вызывающего. */
    private List<Map<String, Object>> rows(String slice, String param, String value) {
        LoreSlices.Composed c = LoreSlices.compose(slice, Map.of(param, value), sliceResource.allowedProjectsOrNull("admin"));
        return ingest.queryPublic(c.sql(), c.params());
    }

    private Map<String, Object> mainRow(String type, String id) {
        LoreRecordResource.Source src = LoreRecordResource.sourceOf(type);
        List<Map<String, Object>> r = rows(src.slice(), src.param(), id);
        assertFalse(r.isEmpty(), type + " " + id + ": главный срез пуст");
        return r.get(0);
    }

    /** Сравнение JSON-текстом: те же ключи в том же порядке и те же значения, что ушли бы в ответ. */
    private void same(Object expected, JsonNode actual, String where) {
        try {
            assertEquals(mapper.writeValueAsString(expected), mapper.writeValueAsString(actual), where);
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new AssertionError(where + ": " + e.getMessage(), e);
        }
    }

    /** values, links (из строки + отдельные срезы задачи) и строки частей (кроме фаз) — как у снимка. */
    private void assertPassportMatchesSnapshot(String type, String id) throws Exception {
        String body = admin().get("/lore/record/" + type + "/" + id).then().statusCode(200).extract().asString();
        JsonNode r = mapper.readTree(body);
        Map<String, Object> row = mainRow(type, id);
        same(LoreRecordSnapshotTest.Legacy.values(type, row), r.get("values"), type + " values");

        List<Map<String, Object>> links = new ArrayList<>(LoreRecordSnapshotTest.Legacy.rowLinks(type, row));
        if ("task".equals(type)) {
            for (Map<String, Object> a : rows("adrs_of_task", "id", id))
                links.add(LoreRecordSnapshotTest.Legacy.sliceLink("task", "adrs", a));
            for (Map<String, Object> q : rows("gating_questions_of_task", "id", id))
                links.add(LoreRecordSnapshotTest.Legacy.sliceLink("task", "gates", q));
        }
        same(links, r.get("links"), type + " links");

        for (LoreRecordRegistry.Part p : LoreRecordRegistry.get(type).parts()) {
            if ("phase".equals(p.type())) continue;      // «x/y» фазы — вычисление по задачам, не снимок строки
            List<Map<String, Object>> expected = new ArrayList<>();
            for (Map<String, Object> c : rows(p.slice(), LoreRecordResource.paramOf(p.slice()), id))
                expected.add(LoreRecordSnapshotTest.Legacy.partItem(p.type(), c));
            JsonNode got = null;
            for (JsonNode x : r.get("parts")) if (p.key().equals(x.path("key").asText())) got = x.get("items");
            assertNotNull(got, type + ": нет части " + p.key());
            same(expected, got, type + " part " + p.key());
        }
    }

    @Test
    void fourPassportsMatchSnapshotOnLiveDb() throws Exception {
        post("/lore/sprint/create", "{\"sprint_id\":\"" + SID + "\",\"name\":\"Снимок\",\"context_md\":\"ctx\",\"outcome_md\":\"итог\"}");
        post("/lore/task", "{\"sprint_id\":\"" + SID + "\",\"task_id\":\"T-1\",\"title\":\"задача снимка\",\"task_type\":\"dev\","
            + "\"work_class\":\"enb\",\"note_md\":\"заметка\",\"effort_days\":1.5}");
        post("/lore/task", "{\"sprint_id\":\"" + SID + "\",\"task_id\":\"T-2\",\"title\":\"вторая\",\"task_type\":\"test\"}");
        post("/lore/adr", "{\"adr_id\":\"" + ADR + "\",\"name\":\"ADR снимка\",\"status\":\"proposed\",\"context_md\":\" к \","
            + "\"decision_md\":\"р\",\"consequences_md\":\"с\"}");
        post("/lore/task/adr", "{\"task_uid\":\"" + TUID + "\",\"adr_id\":\"" + ADR + "\"}");
        post("/lore/spec", "{\"spec_id\":\"" + SPEC + "\",\"title\":\"спека снимка\",\"content_md\":\"тело\",\"version\":\"0.1.0\"}");

        assertPassportMatchesSnapshot("sprint", SID);
        assertPassportMatchesSnapshot("task", TUID);
        assertPassportMatchesSnapshot("adr", ADR);
        assertPassportMatchesSnapshot("spec", SPEC);

        // Положительный контроль: снимок не пуст — связь задачи с ADR и обе задачи спринта видны.
        assertTrue(record("task", TUID).getList("links.id").contains(ADR));
        assertTrue(record("adr", ADR).getList("links.id").contains(TUID));
    }
}
