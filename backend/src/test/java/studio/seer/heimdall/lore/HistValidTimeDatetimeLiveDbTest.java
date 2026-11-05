package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_ROADMAP_PER_PROJECT/RM-P13 — шаг V56: время *Hist в нативный DATETIME.
 *
 * <p>Свежая тестовая БД уже приходит с DATETIME (инициализатор), поэтому
 * состояние прода ДО шага сеется руками: у KnowRunbookHist оба поля времени
 * переобъявляются STRING (у valid_to — ещё и с индексом, как было в старом
 * инициализаторе), строки пишутся текстом трёх форм. У KnowPhaseHist среди
 * строк — нераспознаваемое значение: шаг обязан его не трогать, тип не менять
 * и не упасть.
 *
 * <p>Проверки — ЧТЕНИЕМ из БД (тип свойства из schema:types, значения прямым
 * запросом), а не по отсутствию ошибки; выдача слайса — ISO-Z. Шаг зовётся на
 * бине раннера, как в DataHygieneMigrationsLiveDbTest.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class HistValidTimeDatetimeLiveDbTest {

    private static final String ISO_A = "2026-08-31T12:34:56.789Z";
    private static final String SPACE_B = "2026-06-11 22:26:41";
    private static final String NANO_C = "2026-06-30T06:24:46.590910794Z";
    private static final String TO_A = "2026-09-01T00:00:00Z";
    private static final String BAD = "вчера";
    private static final String SPRINT = "SPRINT_V56_DATETIME_TEST";
    private static final String TASK = SPRINT + "/DT-1";

    @Inject
    LoreSchemaMigrationRunner runner;

    private static List<Map<String, Object>> sql(String command) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(
                URI.create(LoreArcadeDbTestResource.BASE_URL + "/api/v1/command/" + LoreArcadeDbTestResource.TEST_DB))
            .header("Content-Type", "application/json; charset=utf-8")
            .header("Authorization", "Basic " + Base64.getEncoder().encodeToString(
                ("root:" + LoreArcadeDbTestResource.ROOT_PASSWORD).getBytes(StandardCharsets.UTF_8)))
            .POST(HttpRequest.BodyPublishers.ofString(
                io.vertx.core.json.JsonObject.of("language", "sql", "command", command).encode(),
                StandardCharsets.UTF_8)).build();
        HttpResponse<String> r = HttpClient.newHttpClient().send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        System.out.println("[RM-P13 V56] " + command + " → " + r.statusCode() + " " + r.body());
        assertTrue(r.statusCode() == 200, "команда отклонена: " + command + " → " + r.body());
        io.vertx.core.json.JsonObject j = new io.vertx.core.json.JsonObject(r.body());
        List<Map<String, Object>> out = new ArrayList<>();
        io.vertx.core.json.JsonArray arr = j.getJsonArray("result", new io.vertx.core.json.JsonArray());
        for (int i = 0; i < arr.size(); i++) out.add(arr.getJsonObject(i).getMap());
        return out;
    }

    /** Тип свойства прямо из схемы — независимо от помощников раннера. */
    private static String declared(String type, String field) throws Exception {
        for (Map<String, Object> t : sql("SELECT properties FROM schema:types WHERE name = '" + type + "'")) {
            if (t.get("properties") instanceof Iterable<?> props) {
                for (Object p : props) {
                    Map<?, ?> m = p instanceof io.vertx.core.json.JsonObject jo ? jo.getMap() : (Map<?, ?>) p;
                    if (field.equals(m.get("name"))) return String.valueOf(m.get("type"));
                }
            }
        }
        return null;
    }

    private static boolean indexOn(String type, String field) throws Exception {
        for (Map<String, Object> r : sql("SELECT FROM schema:indexes")) {
            if (!type.equals(r.get("typeName")) || !(r.get("properties") instanceof Iterable<?> props)) continue;
            List<String> names = new ArrayList<>();
            for (Object p : props) names.add(String.valueOf(p));
            if (names.equals(List.of(field))) return true;
        }
        return false;
    }

    private static Object value(String type, String stateUid, String field) throws Exception {
        return sql("SELECT " + field + " AS v FROM " + type + " WHERE state_uid = '" + stateUid + "'").get(0).get("v");
    }

    private static void redeclare(String type, String field, String to) throws Exception {
        sql("DROP PROPERTY " + type + "." + field + " FORCE");
        sql("CREATE PROPERTY " + type + "." + field + " " + to);
    }

    @Test
    @Order(1)
    void seedPreV56State() throws Exception {
        // положительный контроль: свежая БД уже DATETIME — значит, сеять надо руками
        assertEquals("DATETIME", declared("KnowRunbookHist", "valid_from"), "инициализатор RM-P13 не применён");
        assertEquals("DATETIME", declared("KnowRunbookHist", "valid_to"));

        redeclare("KnowRunbookHist", "valid_from", "STRING");
        redeclare("KnowRunbookHist", "valid_to", "STRING");
        sql("CREATE INDEX IF NOT EXISTS ON KnowRunbookHist (valid_to) NOTUNIQUE");
        redeclare("KnowPhaseHist", "valid_from", "STRING");

        sql("INSERT INTO KnowRunbookHist SET state_uid = 'v56-a', valid_from = '" + ISO_A + "', valid_to = '" + TO_A + "'");
        sql("INSERT INTO KnowRunbookHist SET state_uid = 'v56-b', valid_from = '" + SPACE_B + "'");
        sql("INSERT INTO KnowRunbookHist SET state_uid = 'v56-c', valid_from = '" + NANO_C + "'");
        sql("INSERT INTO KnowPhaseHist SET state_uid = 'v56-ok', valid_from = '" + ISO_A + "'");
        sql("INSERT INTO KnowPhaseHist SET state_uid = 'v56-bad', valid_from = '" + BAD + "'");

        assertEquals("STRING", declared("KnowRunbookHist", "valid_from"), "положительный контроль: объявлен текстом");
        assertEquals("STRING", declared("KnowRunbookHist", "valid_to"));
        assertTrue(indexOn("KnowRunbookHist", "valid_to"), "положительный контроль: индекс на valid_to есть");
        assertEquals(ISO_A, value("KnowRunbookHist", "v56-a", "valid_from"), "положительный контроль: значение лежит текстом");
        assertEquals(SPACE_B, value("KnowRunbookHist", "v56-b", "valid_from"));
    }

    @Test
    @Order(2)
    void v56ConvertsTextToDatetimeAndKeepsTheMoment() throws Exception {
        List<LoreSchemaMigrationRunner.HistTimeReport> reports = runner.histTimeToDatetime();

        assertEquals("DATETIME", declared("KnowRunbookHist", "valid_from"));
        assertEquals("DATETIME", declared("KnowRunbookHist", "valid_to"));
        assertTrue(indexOn("KnowRunbookHist", "valid_to"), "индекс на valid_to снят и не пересоздан");

        // значение стало нативным (печатается формой DATETIME) — и момент тот же
        Object a = value("KnowRunbookHist", "v56-a", "valid_from");
        assertTrue(LoreSchemaMigrationRunner.DATETIME_RENDERED.matcher(String.valueOf(a)).matches(),
            "значение осталось текстом: " + a);
        assertEquals(Instant.parse(ISO_A), DataHygieneMigrationsLiveDbTest.at(a));
        assertEquals(Instant.parse("2026-06-11T22:26:41Z"),
            DataHygieneMigrationsLiveDbTest.at(value("KnowRunbookHist", "v56-b", "valid_from")),
            "«через пробел» без зоны — UTC (правило V41)");
        assertEquals(Instant.parse("2026-06-30T06:24:46.590Z"),
            DataHygieneMigrationsLiveDbTest.at(value("KnowRunbookHist", "v56-c", "valid_from")),
            "наносекунды усечены до миллисекунд DATETIME");
        assertEquals(Instant.parse(TO_A),
            DataHygieneMigrationsLiveDbTest.at(value("KnowRunbookHist", "v56-a", "valid_to")));

        LoreSchemaMigrationRunner.HistTimeReport rb = report(reports, "KnowRunbookHist", "valid_from");
        assertEquals("STRING", rb.declaredBefore());
        assertEquals("DATETIME", rb.declaredAfter());
        assertEquals(rb.nonNullBefore(), rb.nonNullAfter(), "число непустых значений изменилось");
        assertTrue(rb.rewritten() >= 3, "пересохранено меньше посеянного: " + rb);
        assertTrue(rb.unparsed().isEmpty(), "ложные нераспознанные: " + rb.unparsed());
    }

    @Test
    @Order(3)
    void unparsedValueBlocksOnlyItsPropertyAndIsLeftAlone() throws Exception {
        assertEquals("STRING", declared("KnowPhaseHist", "valid_from"),
            "при нераспознанном значении объявление менять нельзя — движок отклонил бы его целиком");
        assertEquals(BAD, value("KnowPhaseHist", "v56-bad", "valid_from"), "нераспознанное значение тронуто");
        assertEquals(ISO_A, value("KnowPhaseHist", "v56-ok", "valid_from"),
            "соседняя строка того же свойства переписана, хотя тип не сменён");
        assertEquals("DATETIME", declared("KnowPhaseHist", "valid_to"), "соседнее свойство того же типа задето");
    }

    @Test
    @Order(4)
    void secondRunIsNoop() {
        List<LoreSchemaMigrationRunner.HistTimeReport> reports = runner.histTimeToDatetime();
        LoreSchemaMigrationRunner.HistTimeReport rb = report(reports, "KnowRunbookHist", "valid_from");
        assertEquals("DATETIME", rb.declaredBefore());
        assertEquals(0, rb.rewritten(), "повтор переписал нативные значения");
        assertTrue(rb.alreadyNative() >= 3);
        LoreSchemaMigrationRunner.HistTimeReport ph = report(reports, "KnowPhaseHist", "valid_from");
        assertEquals(1, ph.unparsed().size(), "нераспознанное должно остаться в отчёте: " + ph.unparsed());
        assertTrue(ph.unparsed().get(0).endsWith("=" + BAD), "в отчёте rid=значение: " + ph.unparsed());
    }

    @Test
    @Order(5)
    void sliceEmitsIsoZForDatetime() throws Exception {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"V56 проба\"}")
            .when().post("/lore/sprint/create").then().statusCode(200);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"sprint_id\":\"" + SPRINT + "\",\"task_id\":\"DT-1\",\"title\":\"проба V56\"}")
            .when().post("/lore/task").then().statusCode(200);

        Object raw = sql("SELECT valid_from AS v FROM KnowTaskHist WHERE in('HAS_STATE').task_uid CONTAINS '"
            + TASK + "'").get(0).get("v");
        assertTrue(LoreSchemaMigrationRunner.DATETIME_RENDERED.matcher(String.valueOf(raw)).matches(),
            "положительный контроль: база печатает DATETIME без зоны: " + raw);

        List<Map<String, Object>> rows = given().when().get("/lore/slice/task_created_dates")
            .then().statusCode(200).extract().jsonPath().getList("rows");
        String vf = rows.stream().filter(r -> TASK.equals(r.get("task_uid")))
            .map(r -> String.valueOf(r.get("valid_from"))).findFirst().orElseThrow();
        assertTrue(vf.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z"), "выдача слайса не ISO-Z: " + vf);
        assertEquals(DataHygieneMigrationsLiveDbTest.at(raw), Instant.parse(vf), "выдача сменила момент");
        assertFalse(vf.contains(" "));
    }

    private static LoreSchemaMigrationRunner.HistTimeReport report(
            List<LoreSchemaMigrationRunner.HistTimeReport> reports, String type, String field) {
        return reports.stream().filter(r -> r.type().equals(type) && r.field().equals(field))
            .findFirst().orElseThrow(() -> new AssertionError("нет отчёта по " + type + "." + field));
    }

    @AfterAll
    static void cleanup() throws Exception {
        if (LoreArcadeDbTestResource.BASE_URL == null) return;
        sql("DELETE FROM KnowRunbookHist WHERE state_uid IN ['v56-a', 'v56-b', 'v56-c']");
        sql("DELETE FROM KnowPhaseHist WHERE state_uid IN ['v56-ok', 'v56-bad']");
        redeclare("KnowPhaseHist", "valid_from", "DATETIME");
    }
}
