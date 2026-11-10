package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

/**
 * D-2026-UXR-LISTS-DEFAULT-SORT-FRESHNESS, продолжение (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-04).
 * Владелица 10.11, вопрос №49: «по последней дате изменения — это свежесть».
 *
 * <p>У срезов разделов v2 колонка {@code changed_at} — время последнего изменения
 * записи: {@code valid_from} ОТКРЫТОЙ версии SCD2, иначе дата заведения. Было:
 * у ADR, решений и фич свежесть = дата заведения, у задач и спек времени не было
 * вовсе — порядок «свежее сверху» там не работал.
 *
 * <p>Каждая проверка — пара: у новой записи {@code changed_at} равен моменту
 * заведения (положительный контроль: колонка есть и не выдумана), после правки
 * — строго позже. Без первой половины «растёт» доказывало бы только, что второе
 * значение не меньше null.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class FreshnessChangedAtLiveDbTest {

    @Inject
    LoreIngestService ingest;

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "superadmin").contentType("application/json");
    }

    private static void post(String path, String json) {
        admin().body(json).when().post(path).then().statusCode(200);
    }

    private static void status(String type, String id, String status) {
        post("/lore/status", "{\"entity_type\":\"" + type + "\",\"id\":\"" + id + "\",\"status\":\"" + status + "\"}");
    }

    /** Строка среза по ключу; срез обязан её отдать и обязан нести changed_at. */
    private static Map<String, Object> row(String slice, String key, String id, Map<String, String> params) {
        var req = given();
        params.forEach(req::queryParam);
        List<Map<String, Object>> rows = req.when().get("/lore/slice/" + slice)
            .then().statusCode(200).extract().jsonPath().getList("rows");
        Map<String, Object> r = rows.stream().filter(x -> id.equals(String.valueOf(x.get(key))))
            .findFirst().orElse(null);
        if (r == null) fail(slice + ": строки " + id + " нет в выдаче (" + rows.size() + " строк)");
        assertTrue(r.containsKey("changed_at"), slice + ": колонки changed_at нет: " + r);
        assertNotNull(r.get("changed_at"), slice + ": changed_at пуст у " + id + ": " + r);
        return r;
    }

    private static Instant changedAt(String slice, String key, String id, Map<String, String> params) {
        return at(row(slice, key, id, params).get("changed_at"));
    }

    /** Время в любом из видов корпуса: ISO-Z, «через пробел», только дата, эпоха. */
    static Instant at(Object v) {
        assertNotNull(v, "время пусто");
        if (v instanceof Number n) return Instant.ofEpochMilli(n.longValue());
        String s = String.valueOf(v).trim();
        if (s.length() == 10) return LocalDate.parse(s).atStartOfDay(ZoneOffset.UTC).toInstant();
        s = s.replace(' ', 'T');
        try {
            return OffsetDateTime.parse(s).toInstant();
        } catch (Exception noOffset) {
            return Instant.parse(s.endsWith("Z") ? s : s + "Z");
        }
    }

    private Instant openFrom(String histType, String key, String id) {
        List<Map<String, Object>> rows = ingest.queryPublic(
            "SELECT valid_from FROM " + histType + " WHERE in('HAS_STATE')." + key + " CONTAINS :id AND valid_to IS NULL",
            Map.of("id", id));
        assertEquals(1, rows.size(), histType + " " + id + ": открытая версия одна: " + rows);
        return at(rows.get(0).get("valid_from"));
    }

    private Object field(String sql, String id, String f) {
        List<Map<String, Object>> rows = ingest.queryPublic(sql, Map.of("id", id));
        assertEquals(1, rows.size(), sql + " → " + rows);
        return rows.get(0).get(f);
    }

    /** Отметки valid_from — с точностью до миллисекунд; секунда гарантирует «строго позже». */
    private static void tick() {
        try { Thread.sleep(1100); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }

    private static void assertGrew(Instant before, Instant after, String what) {
        assertTrue(after.isAfter(before), what + ": правка не сдвинула changed_at: было " + before + ", стало " + after);
    }

    @Test
    void taskAndSprint_changedAtIsOpenVersion_growsOnStatusChange() {
        String sid = "SPRINT_FRESH_CHANGED_AT";
        String uid = sid + "/T1";
        post("/lore/sprint/create", "{\"sprint_id\":\"" + sid + "\",\"name\":\"проба свежести\"}");
        post("/lore/task", "{\"sprint_id\":\"" + sid + "\",\"task_id\":\"T1\",\"title\":\"проба свежести\"}");
        Map<String, String> bySprint = Map.of("sprint", sid);

        Instant t0 = changedAt("open_tasks", "task_uid", uid, bySprint);
        assertEquals(openFrom("KnowTaskHist", "task_uid", uid), t0, "новая задача: changed_at = момент заведения");
        Instant s0 = changedAt("sprints", "sprint_id", sid, Map.of());
        assertEquals(openFrom("KnowSprintHist", "sprint_id", sid), s0, "новый спринт: changed_at = момент заведения");

        tick();
        status("task", uid, "active");
        status("sprint", sid, "active");
        Instant t1 = changedAt("open_tasks", "task_uid", uid, bySprint);
        assertGrew(t0, t1, "задача");
        assertEquals(openFrom("KnowTaskHist", "task_uid", uid), t1, "задача: changed_at = открытая версия");
        assertGrew(s0, changedAt("sprints", "sprint_id", sid, Map.of()), "спринт");

        // closed_tasks — та же проекция, что open_tasks (подгрузка закрытых в том же разделе).
        tick();
        status("task", uid, "cancelled");
        assertGrew(t1, changedAt("closed_tasks", "task_uid", uid, bySprint), "закрытая задача");
    }

    @Test
    void adrAndSpec_changedAtIsOpenVersion_growsOnStatusChange() {
        String adr = "ADR-FRESH-CHANGED-AT";
        post("/lore/adr", "{\"adr_id\":\"" + adr + "\",\"name\":\"проба свежести\"}");
        Instant a0 = changedAt("adrs", "adr_id", adr, Map.of());
        assertEquals(openFrom("KnowADRHist", "adr_id", adr), a0, "новый ADR: changed_at = момент заведения");

        String spec = "SPEC-FRESH-CHANGED-AT";
        post("/lore/spec", "{\"spec_id\":\"" + spec + "\",\"title\":\"проба свежести\",\"content_md\":\"тело\"}");
        Instant p0 = changedAt("specs", "spec_id", spec, Map.of());
        assertEquals(openFrom("KnowSpecHist", "spec_id", spec), p0, "новая спека: changed_at = момент заведения");

        tick();
        status("adr", adr, "accepted");
        // /lore/status спеки не принимает — статус спеки пишет её путь записи (версией KnowSpecHist).
        post("/lore/spec", "{\"spec_id\":\"" + spec + "\",\"status\":\"accepted\"}");
        assertGrew(a0, changedAt("adrs", "adr_id", adr, Map.of()), "ADR");
        assertGrew(p0, changedAt("specs", "spec_id", spec, Map.of()), "спека");
    }

    @Test
    void decision_newEqualsCreation_growsOnStatusChange() {
        String id = "D-2026-FRESH-CHANGED-AT";
        post("/lore/decision", "{\"decision_id\":\"" + id + "\",\"title\":\"проба свежести\"}");
        Instant d0 = changedAt("decisions", "decision_id", id, Map.of());
        assertEquals(at(field("SELECT created_at FROM KnowDecision WHERE decision_id=:id", id, "created_at")), d0,
            "новое решение без истории: changed_at = момент заведения");

        tick();
        // /lore/status решения не принимает — правка идёт путём записи решения
        // (статус версией KnowDecisionHist, отметка правки updated_at на вершине).
        post("/lore/decision", "{\"decision_id\":\"" + id + "\",\"title\":\"проба свежести\",\"status\":\"accepted\"}");
        assertGrew(d0, changedAt("decisions", "decision_id", id, Map.of()), "решение (правка)");
    }

    @Test
    void release_changedAtIsOpenVersion() {
        String gp = "test/fresh-changed-at";
        post("/lore/project", "{\"slug\":\"" + gp + "\"}");
        post("/lore/release", "{\"release_id\":\"v0.0.1-fresh\",\"git_project\":\"" + gp + "\",\"git_tag\":\"v0.0.1-fresh\"}");
        String uid = gp + "#v0.0.1-fresh";
        Instant r0 = changedAt("releases", "release_uid", uid, Map.of());
        assertEquals(at(field("SELECT valid_from FROM KnowReleaseHist WHERE in('HAS_STATE').release_uid CONTAINS :id AND valid_to IS NULL",
            uid, "valid_from")), r0, "новый релиз: changed_at = момент заведения");
    }

    // ── Правки «на месте» (версию SCD2 не открывают) — S4-04, продолжение ──────
    // Было: changed_at = valid_from открытой версии, и правка заметки/названия задачи,
    // тела спеки без checkpoint, полей релиза время не двигала — запись «старела»,
    // хотя её только что правили. Стало: такие пути ставят updated_at на вершине,
    // changed_at — максимум из открытой версии и updated_at.

    @Test
    void taskNoteAndTitle_inPlaceEdit_movesChangedAt() {
        String sid = "SPRINT_FRESH_INPLACE";
        String uid = sid + "/T1";
        post("/lore/sprint/create", "{\"sprint_id\":\"" + sid + "\",\"name\":\"проба правки на месте\"}");
        post("/lore/task", "{\"sprint_id\":\"" + sid + "\",\"task_id\":\"T1\",\"title\":\"проба правки на месте\"}");
        Map<String, String> bySprint = Map.of("sprint", sid);
        Instant t0 = changedAt("open_tasks", "task_uid", uid, bySprint);
        Instant open0 = openFrom("KnowTaskHist", "task_uid", uid);
        assertEquals(open0, t0, "положительный контроль: новая задача — changed_at = момент заведения");

        tick();
        post("/lore/task/edit", "{\"task_uid\":\"" + uid + "\",\"title\":\"проба правки на месте\",\"note_md\":\"заметка\"}");
        assertEquals(open0, openFrom("KnowTaskHist", "task_uid", uid), "правка заметки версию не открывает");
        Instant t1 = changedAt("open_tasks", "task_uid", uid, bySprint);
        assertGrew(t0, t1, "задача (заметка)");

        tick();
        post("/lore/task/edit", "{\"task_uid\":\"" + uid + "\",\"title\":\"новое название\"}");
        assertGrew(t1, changedAt("open_tasks", "task_uid", uid, bySprint), "задача (название)");
    }

    @Test
    void specBody_withoutCheckpoint_movesChangedAt() {
        String spec = "SPEC-FRESH-INPLACE";
        post("/lore/spec", "{\"spec_id\":\"" + spec + "\",\"title\":\"проба правки на месте\",\"content_md\":\"тело\"}");
        Instant p0 = changedAt("specs", "spec_id", spec, Map.of());
        Instant open0 = openFrom("KnowSpecHist", "spec_id", spec);
        assertEquals(open0, p0, "положительный контроль: новая спека — changed_at = момент заведения");

        tick();
        post("/lore/spec", "{\"spec_id\":\"" + spec + "\",\"content_md\":\"новое тело\"}");
        assertEquals(open0, openFrom("KnowSpecHist", "spec_id", spec), "тело без checkpoint версию не открывает");
        assertGrew(p0, changedAt("specs", "spec_id", spec, Map.of()), "спека (тело на месте)");
    }

    @Test
    void releaseFields_edit_movesChangedAt() {
        String gp = "test/fresh-inplace";
        post("/lore/project", "{\"slug\":\"" + gp + "\"}");
        post("/lore/release", "{\"release_id\":\"v0.0.2-fresh\",\"git_project\":\"" + gp + "\",\"git_tag\":\"v0.0.2-fresh\"}");
        String uid = gp + "#v0.0.2-fresh";
        Instant r0 = changedAt("releases", "release_uid", uid, Map.of());

        tick();
        post("/lore/release/update", "{\"release_id\":\"v0.0.2-fresh\",\"git_project\":\"" + gp
            + "\",\"description_md\":\"описание после правки\"}");
        assertGrew(r0, changedAt("releases", "release_uid", uid, Map.of()), "релиз (правка полей)");
    }

    @Test
    void decision_statusAfterFieldEdit_isTheChange() {
        String id = "D-2026-FRESH-INPLACE";
        post("/lore/decision", "{\"decision_id\":\"" + id + "\",\"title\":\"проба правки на месте\"}");
        tick();
        post("/lore/decision", "{\"decision_id\":\"" + id + "\",\"title\":\"правка полей\"}");
        Instant d1 = changedAt("decisions", "decision_id", id, Map.of());

        tick();
        post("/lore/decision", "{\"decision_id\":\"" + id + "\",\"title\":\"правка полей\",\"status\":\"accepted\"}");
        Instant d2 = changedAt("decisions", "decision_id", id, Map.of());
        assertGrew(d1, d2, "решение (смена статуса)");
        // Последнее изменение — версия статуса: она открыта ПОСЛЕ отметки правки полей.
        assertEquals(openFrom("KnowDecisionHist", "decision_id", id), d2,
            "решение: changed_at = максимум (открытая версия статуса позже updated_at)");
    }

    @Test
    void questionAndUseCase_withoutHistory_fallBackToTheirDates() {
        // У вопроса и сценария SCD2 нет: последнее известное изменение — их собственные даты.
        String q = "Q-FRESH-CHANGED-AT";
        post("/lore/question", "{\"question_id\":\"" + q + "\",\"title\":\"проба свежести\",\"status\":\"open\"}");
        Object opened = field("SELECT opened_date FROM KnowQuestion WHERE question_id=:id", q, "opened_date");
        assertEquals(at(opened), changedAt("questions", "question_id", q, Map.of()), "новый вопрос: changed_at = дата заведения");

        String d = "D-2026-FRESH-ANSWERS-Q";
        post("/lore/decision", "{\"decision_id\":\"" + d + "\",\"title\":\"ответ на пробу\"}");
        post("/lore/question/answers", "{\"decision_id\":\"" + d + "\",\"question_id\":\"" + q + "\"}");
        Object closed = field("SELECT closed_date FROM KnowQuestion WHERE question_id=:id", q, "closed_date");
        assertNotNull(closed, "положительный контроль: ответ закрыл вопрос");
        assertEquals(at(closed), changedAt("questions", "question_id", q, Map.of()), "закрытый вопрос: changed_at = дата закрытия");

        String uc = "UC-FRESH-CHANGED-AT";
        post("/lore/uc", "{\"uc_id\":\"" + uc + "\",\"title\":\"проба свежести\"}");
        Object created = field("SELECT date_created FROM KnowUseCase WHERE uc_id=:id", uc, "date_created");
        assertEquals(at(created), changedAt("use_cases", "uc_id", uc, Map.of()), "новый сценарий: changed_at = дата заведения");
    }
}
