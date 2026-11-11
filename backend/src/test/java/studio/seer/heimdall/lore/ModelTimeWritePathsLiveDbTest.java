package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

/**
 * SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MODEL-TYPES — пути записи у типов со SCD2 (аудит
 * времени модели, владелица 10.11).
 *
 * <ul>
 *   <li>Правка релиза ({@code release/update}) версию не открывала: KnowReleaseHist
 *       получал строку только при заведении, и правка описания историю не оставляла.</li>
 *   <li>Новая цель вехи переписывала открытую строку KnowMilestoneHist на месте —
 *       прежняя цель терялась.</li>
 *   <li>Правка полей спринта ({@code sprint/update}), тела ADR без checkpoint и полей
 *       вехи ни версии, ни отметки правки не ставили — {@code changed_at} стоял, хотя
 *       запись только что правили (класс #1124, эти три пути он не покрыл).</li>
 * </ul>
 * Каждая проверка с положительным контролем: до правки значение есть и равно ожидаемому.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class ModelTimeWritePathsLiveDbTest {

    @Inject
    LoreIngestService ingest;

    private static void post(String path, String json) {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body(json).when().post(path).then().log().ifValidationFails().statusCode(200);
    }

    private static Instant changedAt(String slice, String key, String id) {
        List<Map<String, Object>> rows = given().when().get("/lore/slice/" + slice)
            .then().statusCode(200).extract().jsonPath().getList("rows");
        Map<String, Object> r = rows.stream().filter(x -> id.equals(String.valueOf(x.get(key)))).findFirst().orElse(null);
        if (r == null) fail(slice + ": строки " + id + " нет");
        assertTrue(r.containsKey("changed_at"), slice + ": колонки changed_at нет: " + r);
        return FreshnessChangedAtLiveDbTest.at(r.get("changed_at"));
    }

    private List<Map<String, Object>> versions(String hist, String key, String id) {
        return ingest.queryPublic("SELECT valid_from, valid_to, description_md, goal_md, decisions_md FROM " + hist
            + " WHERE in('HAS_STATE')." + key + " CONTAINS :id ORDER BY valid_from", Map.of("id", id));
    }

    private static long open(List<Map<String, Object>> v) {
        return v.stream().filter(r -> r.get("valid_to") == null).count();
    }

    private static void tick() {
        try { Thread.sleep(1100); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }

    private static void assertGrew(Instant before, Instant after, String what) {
        assertTrue(after.isAfter(before), what + ": правка не сдвинула changed_at: было " + before + ", стало " + after);
    }

    @Test
    void releaseUpdate_opensANewVersion() {
        String gp = "test/model-time-release";
        post("/lore/project", "{\"slug\":\"" + gp + "\"}");
        post("/lore/release", "{\"release_id\":\"v0.0.1-mt\",\"git_project\":\"" + gp + "\",\"description_md\":\"было\"}");
        String uid = gp + "#v0.0.1-mt";
        List<Map<String, Object>> v0 = versions("KnowReleaseHist", "release_uid", uid);
        assertEquals(1, v0.size(), "положительный контроль: у нового релиза одна версия: " + v0);
        Instant r0 = changedAt("releases", "release_uid", uid);

        tick();
        post("/lore/release/update", "{\"release_id\":\"v0.0.1-mt\",\"git_project\":\"" + gp + "\",\"description_md\":\"стало\"}");
        List<Map<String, Object>> v1 = versions("KnowReleaseHist", "release_uid", uid);
        assertEquals(2, v1.size(), "правка релиза открывает версию: " + v1);
        assertEquals(1, open(v1), "открытая версия одна: " + v1);
        assertEquals("стало", v1.get(1).get("description_md"), "новая версия несёт описание правки");
        Instant r1 = changedAt("releases", "release_uid", uid);
        assertGrew(r0, r1, "релиз");
        assertEquals(FreshnessChangedAtLiveDbTest.at(v1.get(1).get("valid_from")), r1, "changed_at = открытая версия");
    }

    @Test
    void milestoneGoalChange_opensANewVersion_fieldEditMovesChangedAt() {
        String mid = "M-MODEL-TIME-PROBE";
        post("/lore/milestone", "{\"milestone_id\":\"" + mid + "\",\"label\":\"проба\",\"goal_md\":\"цель-1\"}");
        List<Map<String, Object>> v0 = versions("KnowMilestoneHist", "milestone_id", mid);
        assertEquals(1, v0.size(), "положительный контроль: первая цель — одна версия: " + v0);
        Instant m0 = changedAt("milestones", "milestone_id", mid);

        tick();
        post("/lore/milestone", "{\"milestone_id\":\"" + mid + "\",\"goal_md\":\"цель-2\"}");
        List<Map<String, Object>> v1 = versions("KnowMilestoneHist", "milestone_id", mid);
        assertEquals(2, v1.size(), "новая цель открывает версию, прежняя остаётся закрытой: " + v1);
        assertEquals(1, open(v1));
        assertEquals("цель-1", v1.get(0).get("goal_md"), "прежняя цель не потеряна");
        assertEquals("цель-2", v1.get(1).get("goal_md"));
        Instant m1 = changedAt("milestones", "milestone_id", mid);
        assertGrew(m0, m1, "веха (цель)");

        tick();
        post("/lore/milestone", "{\"milestone_id\":\"" + mid + "\",\"goal_md\":\"цель-2\"}");
        assertEquals(2, versions("KnowMilestoneHist", "milestone_id", mid).size(), "та же цель версию не плодит");

        tick();
        post("/lore/milestone", "{\"milestone_id\":\"" + mid + "\",\"label\":\"проба (переименована)\"}");
        assertGrew(m1, changedAt("milestones", "milestone_id", mid), "веха (поля вершины)");
    }

    @Test
    void sprintUpdate_movesChangedAt() {
        String sid = "SPRINT_MODEL_TIME_PROBE";
        post("/lore/sprint/create", "{\"sprint_id\":\"" + sid + "\",\"name\":\"проба\"}");
        Instant s0 = changedAt("sprints", "sprint_id", sid);
        tick();
        post("/lore/sprint/update", "{\"sprint_id\":\"" + sid + "\",\"name\":\"проба (переименована)\"}");
        assertGrew(s0, changedAt("sprints", "sprint_id", sid), "спринт (название)");
    }

    @Test
    void adrBodyWithoutCheckpoint_movesChangedAt() {
        String adr = "ADR-MODEL-TIME-PROBE";
        post("/lore/adr", "{\"adr_id\":\"" + adr + "\",\"name\":\"проба\",\"context_md\":\"было\"}");
        Instant a0 = changedAt("adrs", "adr_id", adr);
        tick();
        post("/lore/adr", "{\"adr_id\":\"" + adr + "\",\"name\":\"проба\",\"context_md\":\"стало\"}");
        assertGrew(a0, changedAt("adrs", "adr_id", adr), "ADR (тело на месте)");
    }
}
