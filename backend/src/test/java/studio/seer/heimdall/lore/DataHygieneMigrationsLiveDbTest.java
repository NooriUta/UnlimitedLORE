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
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * V52 / V53 / V54 — три миграции данных по ответам владельца 04.11.2026
 * (D-2026-LORE-OWNER-ANSWERS-20261104, №8, №9, №15).
 *
 * <p>Для каждого шага: (1) положительный контроль — дефект посеян и виден;
 * (2) шаг делает работу — проверка ЧТЕНИЕМ из БД, а не по отсутствию ошибки
 * (UPDATE, ничего не задевший, отвечает так же успешно); (3) повторный запуск
 * ничего не меняет. До правки тест не компилируется — методов шага в раннере
 * нет; с пустыми методами падает на шагах (2).
 *
 * <p>Шаги зовутся прямо на бине раннера, как в DictAgentProfileRenameLiveDbTest:
 * на свежей тестовой БД стартовый прогон миграций проходит их вхолостую — сеять
 * нечего, — а проверить надо работу на посеянном дефекте.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class DataHygieneMigrationsLiveDbTest {

    private static final String SPRINT = "SPRINT_V52_HYGIENE_TEST";
    /** Дата только на вершине (легаси-отметка создания). */
    private static final String TASK_A = SPRINT + "/HA-1";
    /** Две строки истории: дата берётся у самой ранней. */
    private static final String TASK_B = SPRINT + "/HB-1";
    /** Источника нет вовсе — строка обязана остаться NULL. */
    private static final String TASK_C = SPRINT + "/HC-1";
    private static final String TEST_STATE = LoreSchemaMigrationRunner.TEST_STATE_PREFIX + "v52probe";

    private static final String OLD_MS = LoreSchemaMigrations.MILESTONE_OLD_ID;
    private static final String NEW_MS = LoreSchemaMigrations.MILESTONE_NEW_ID;
    private static final String MS_SPRINT = "SPRINT_V53_MS_PROBE";

    private static String bMinValidFrom;

    @Inject
    LoreSchemaMigrationRunner runner;

    private static List<Map<String, Object>> sql(String command) throws Exception {
        HttpClient http = HttpClient.newHttpClient();
        String body = io.vertx.core.json.JsonObject.of("language", "sql", "command", command).encode();
        HttpRequest req = HttpRequest.newBuilder(
                URI.create(LoreArcadeDbTestResource.BASE_URL + "/api/v1/command/" + LoreArcadeDbTestResource.TEST_DB))
            .header("Content-Type", "application/json; charset=utf-8")
            .header("Authorization", "Basic " + Base64.getEncoder().encodeToString(
                ("root:" + LoreArcadeDbTestResource.ROOT_PASSWORD).getBytes(StandardCharsets.UTF_8)))
            .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8)).build();
        HttpResponse<String> r = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        io.vertx.core.json.JsonObject j = new io.vertx.core.json.JsonObject(r.body());
        List<Map<String, Object>> out = new ArrayList<>();
        io.vertx.core.json.JsonArray arr = j.getJsonArray("result", new io.vertx.core.json.JsonArray());
        for (int i = 0; i < arr.size(); i++) out.add(arr.getJsonObject(i).getMap());
        return out;
    }

    /**
     * RM-P13: сравнение моментов, а не строк. valid_from — DATETIME, и прямой
     * запрос отдаёт его «через пробел» без зоны (UTC wall clock), а записывался
     * он ISO-Z; строки разные, момент один.
     */
    static java.time.Instant at(Object v) {
        String s = String.valueOf(v);
        if (s.endsWith("Z")) return java.time.Instant.parse(s);
        return java.time.LocalDateTime.parse(s.replace(' ', 'T')).toInstant(java.time.ZoneOffset.UTC);
    }

    private static long n(String query) throws Exception {
        return ((Number) sql(query).get(0).get("n")).longValue();
    }

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    private static String openOf(String uid) {
        return "SELECT valid_from, valid_from_source FROM KnowTaskHist WHERE valid_to IS NULL "
            + "AND in('HAS_STATE').task_uid CONTAINS '" + uid + "'";
    }

    private static void nullOpenValidFrom(String uid) throws Exception {
        sql("UPDATE KnowTaskHist SET valid_from = null WHERE valid_to IS NULL "
            + "AND in('HAS_STATE').task_uid CONTAINS '" + uid + "'");
    }

    // ── V52 (RM-P17) ────────────────────────────────────────────────────────

    @Test
    @Order(1)
    void v52_seedDefects() throws Exception {
        post("/lore/sprint/create", "{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"V52 гигиена\"}");
        for (String t : List.of("HA-1", "HB-1", "HC-1"))
            post("/lore/task", "{\"sprint_id\":\"" + SPRINT + "\",\"task_id\":\"" + t + "\",\"title\":\"проба V52\"}");
        // У B — вторая строка истории: первая закрывается и остаётся с датой создания.
        post("/lore/status", "{\"entity_type\":\"task\",\"id\":\"" + TASK_B + "\",\"status\":\"active\"}");
        List<Map<String, Object>> bRows = sql("SELECT valid_from FROM (SELECT expand(out('HAS_STATE')) "
            + "FROM KnowTask WHERE task_uid = '" + TASK_B + "') ORDER BY valid_from ASC");
        assertEquals(2, bRows.size(), "положительный контроль: у B две строки истории");
        bMinValidFrom = String.valueOf(bRows.get(0).get("valid_from"));

        sql("UPDATE KnowTask SET date_created = '2026-06-20' WHERE task_uid = '" + TASK_A + "'");
        for (String uid : List.of(TASK_A, TASK_B, TASK_C)) nullOpenValidFrom(uid);

        // Остаток тестового прогона — закрытая строка, как на проде (QG/REC-SMOKE-2026-06-30).
        sql("INSERT INTO KnowTaskHist SET state_uid = '" + TEST_STATE + "', status_raw = '📋 PLANNED', "
            + "valid_to = '2026-07-02 08:00:00'");
        sql("CREATE EDGE HAS_STATE FROM (SELECT FROM KnowTask WHERE task_uid = '" + TASK_C + "') "
            + "TO (SELECT FROM KnowTaskHist WHERE state_uid = '" + TEST_STATE + "')");

        given().when().get("/lore/slice/history_hygiene").then().statusCode(200)
            .body("rows.ref_id", hasItem(TASK_A))
            .body("rows.ref_id", hasItem(TASK_B))
            .body("rows.ref_id", hasItem(TASK_C));
        assertEquals(1, n("SELECT count(*) AS n FROM KnowTaskHist WHERE state_uid = '" + TEST_STATE + "'"),
            "положительный контроль: тестовая строка посеяна");
    }

    @Test
    @Order(2)
    void v52_fillsCreationDateFromHonestSourceOnly() throws Exception {
        assertTrue(runner.backfillOpenTaskHistValidFrom() >= 2, "заполнено меньше двух строк");

        Map<String, Object> a = sql(openOf(TASK_A)).get(0);
        assertEquals(at("2026-06-20T00:00:00Z"), at(a.get("valid_from")), "A: дата не взята с вершины");
        assertEquals("task.date_created", a.get("valid_from_source"));

        Map<String, Object> b = sql(openOf(TASK_B)).get(0);
        assertEquals(at(bMinValidFrom), at(b.get("valid_from")), "B: дата не равна самой ранней дате истории");
        assertEquals("hist.min_valid_from", b.get("valid_from_source"));

        Map<String, Object> c = sql(openOf(TASK_C)).get(0);
        assertNull(c.get("valid_from"), "C: даты в корпусе нет — подставлять нельзя");

        given().when().get("/lore/slice/history_hygiene").then().statusCode(200)
            .body("rows.ref_id", not(hasItem(TASK_A)))
            .body("rows.ref_id", not(hasItem(TASK_B)))
            .body("rows.ref_id", hasItem(TASK_C));
    }

    @Test
    @Order(3)
    void v52_dropsTestStateRowByRid() throws Exception {
        assertTrue(runner.dropTestStateTaskHist() >= 1);
        assertEquals(0, n("SELECT count(*) AS n FROM KnowTaskHist WHERE state_uid LIKE '"
            + LoreSchemaMigrationRunner.TEST_STATE_PREFIX + "%'"), "тестовая строка осталась");
        assertEquals(1, n("SELECT count(*) AS n FROM (SELECT expand(out('HAS_STATE')) FROM KnowTask "
            + "WHERE task_uid = '" + TASK_C + "')"), "у задачи-родителя должна остаться только своя строка");
    }

    @Test
    @Order(4)
    void v52_secondRunChangesNothing() throws Exception {
        String aBefore = String.valueOf(sql(openOf(TASK_A)).get(0).get("valid_from"));
        String bBefore = String.valueOf(sql(openOf(TASK_B)).get(0).get("valid_from"));
        // Счётчик возврата не проверяем: общая тестовая БД может нести чужие
        // NULL-строки. Свои пробы обязаны остаться ровно как были.
        runner.backfillOpenTaskHistValidFrom();
        assertEquals(0, runner.dropTestStateTaskHist());
        assertEquals(aBefore, String.valueOf(sql(openOf(TASK_A)).get(0).get("valid_from")));
        assertEquals(bBefore, String.valueOf(sql(openOf(TASK_B)).get(0).get("valid_from")));
        assertNull(sql(openOf(TASK_C)).get(0).get("valid_from"), "C: повторный прогон выдумал дату");
    }

    // ── V53 (RM-X1) ─────────────────────────────────────────────────────────

    @Test
    @Order(10)
    void v53_renamesMilestoneAndStringRefs() throws Exception {
        assertEquals(0, n("SELECT count(*) AS n FROM KnowMilestone WHERE milestone_id = '" + NEW_MS + "'"),
            "предусловие: нового id в тестовой БД нет");
        sql("INSERT INTO KnowMilestone SET milestone_id = '" + OLD_MS + "', label = '" + OLD_MS + "'");
        sql("INSERT INTO KnowSprint SET sprint_id = '" + MS_SPRINT + "', name = 'проба V53', "
            + "planned_milestone_id = '" + OLD_MS + "'");
        sql("CREATE EDGE TARGETS_MILESTONE FROM (SELECT FROM KnowSprint WHERE sprint_id = '" + MS_SPRINT + "') "
            + "TO (SELECT FROM KnowMilestone WHERE milestone_id = '" + OLD_MS + "')");
        assertEquals(1, n("SELECT count(*) AS n FROM KnowMilestone WHERE milestone_id = '" + OLD_MS + "'"),
            "положительный контроль: веха посеяна");

        assertTrue(runner.renameMilestoneM2Core(), "шаг сообщил, что не переименовал");

        assertEquals(0, n("SELECT count(*) AS n FROM KnowMilestone WHERE milestone_id = '" + OLD_MS + "'"));
        List<Map<String, Object>> ms = sql("SELECT label FROM KnowMilestone WHERE milestone_id = '" + NEW_MS + "'");
        assertEquals(1, ms.size(), "вехи с новым id нет");
        assertEquals(OLD_MS, ms.get(0).get("label"), "label — подпись, он не меняется");
        assertEquals(NEW_MS, sql("SELECT planned_milestone_id FROM KnowSprint WHERE sprint_id = '" + MS_SPRINT + "'")
            .get(0).get("planned_milestone_id"), "строковая ссылка в спринте не переписана");
        Object via = sql("SELECT out('TARGETS_MILESTONE').milestone_id AS m FROM KnowSprint WHERE sprint_id = '"
            + MS_SPRINT + "'").get(0).get("m");
        assertTrue(String.valueOf(via).contains(NEW_MS), "ребро спринт→веха потеряно: " + via);
    }

    @Test
    @Order(11)
    void v53_secondRunIsNoop() throws Exception {
        assertFalse(runner.renameMilestoneM2Core(), "старого id нет — шаг обязан ничего не делать");
        assertEquals(1, n("SELECT count(*) AS n FROM KnowMilestone WHERE milestone_id = '" + NEW_MS + "'"));
    }

    @Test
    @Order(12)
    void v53_doesNotMergeIntoTakenId() throws Exception {
        sql("INSERT INTO KnowMilestone SET milestone_id = '" + OLD_MS + "', label = 'дубль'");
        assertFalse(runner.renameMilestoneM2Core(), "новый id занят — переименовывать нельзя");
        assertEquals(1, n("SELECT count(*) AS n FROM KnowMilestone WHERE milestone_id = '" + OLD_MS + "'"));
        assertEquals(1, n("SELECT count(*) AS n FROM KnowMilestone WHERE milestone_id = '" + NEW_MS + "'"));
        sql("DELETE FROM KnowMilestone WHERE milestone_id = '" + OLD_MS + "'");
    }

    // ── V54 (T-14) ──────────────────────────────────────────────────────────

    private static boolean typeExists(String t) throws Exception {
        return !sql("SELECT name FROM schema:types WHERE name = '" + t + "'").isEmpty();
    }

    @Test
    @Order(20)
    void v54_usedTypesAreNotDropped() throws Exception {
        sql("CREATE VERTEX TYPE PlanItem IF NOT EXISTS");
        sql("CREATE VERTEX TYPE PlanItemHist IF NOT EXISTS");
        sql("CREATE EDGE TYPE ON_TRACK IF NOT EXISTS");
        sql("CREATE EDGE TYPE CONTRIBUTES_TO IF NOT EXISTS");
        sql("INSERT INTO PlanItem SET item_id = 'v54probe'");
        for (String t : LoreSchemaMigrations.PLANITEM_TYPES)
            assertTrue(typeExists(t), "положительный контроль: тип " + t + " заведён");

        assertTrue(runner.dropPlanItemTypesIfUnused().isEmpty(), "при записи в PlanItem снят хоть один тип");
        for (String t : LoreSchemaMigrations.PLANITEM_TYPES)
            assertTrue(typeExists(t), "тип " + t + " снят, хотя PlanItem не пуст — всё или ничего");
    }

    @Test
    @Order(21)
    void v54_emptyTypesAreDropped() throws Exception {
        sql("DELETE FROM PlanItem WHERE item_id = 'v54probe'");
        assertEquals(0, n("SELECT count(*) AS n FROM PlanItem"));

        List<String> dropped = runner.dropPlanItemTypesIfUnused();

        assertEquals(LoreSchemaMigrations.PLANITEM_TYPES.size(), dropped.size(), "сняты не все: " + dropped);
        for (String t : LoreSchemaMigrations.PLANITEM_TYPES)
            assertFalse(typeExists(t), "тип " + t + " остался в схеме");
    }

    @Test
    @Order(22)
    void v54_secondRunIsNoop() {
        assertTrue(runner.dropPlanItemTypesIfUnused().isEmpty());
    }

    // ── V57 (T-14, хвост): StatusPlanItem + REPRESENTS ──────────────────────

    @Test
    @Order(23)
    void v57_usedTypesAreNotDropped() throws Exception {
        sql("CREATE VERTEX TYPE StatusPlanItem IF NOT EXISTS");
        sql("CREATE EDGE TYPE REPRESENTS IF NOT EXISTS");
        sql("INSERT INTO StatusPlanItem SET status = 'v57probe'");
        for (String t : LoreSchemaMigrations.PLANITEM_LEFTOVER_TYPES)
            assertTrue(typeExists(t), "положительный контроль: тип " + t + " заведён");

        assertTrue(runner.dropPlanItemLeftoversIfUnused().isEmpty(), "при записи в StatusPlanItem снят хоть один тип");
        for (String t : LoreSchemaMigrations.PLANITEM_LEFTOVER_TYPES)
            assertTrue(typeExists(t), "тип " + t + " снят, хотя StatusPlanItem не пуст — всё или ничего");
    }

    @Test
    @Order(24)
    void v57_emptyTypesAreDropped() throws Exception {
        sql("DELETE FROM StatusPlanItem WHERE status = 'v57probe'");
        assertEquals(0, n("SELECT count(*) AS n FROM StatusPlanItem"));

        List<String> dropped = runner.dropPlanItemLeftoversIfUnused();

        assertEquals(LoreSchemaMigrations.PLANITEM_LEFTOVER_TYPES, dropped, "сняты не все: " + dropped);
        for (String t : LoreSchemaMigrations.PLANITEM_LEFTOVER_TYPES)
            assertFalse(typeExists(t), "тип " + t + " остался в схеме");
    }

    @Test
    @Order(25)
    void v57_secondRunIsNoop() {
        assertTrue(runner.dropPlanItemLeftoversIfUnused().isEmpty());
    }

    @AfterAll
    static void cleanup() throws Exception {
        // Не оставлять NULL-строку пробы C общей тестовой БД: соседние проверки
        // среза history_hygiene держатся за свои задачи, но пустота — за всех.
        sql("UPDATE KnowTaskHist SET valid_from = '2026-10-20T00:00:00Z' WHERE valid_to IS NULL "
            + "AND valid_from IS NULL AND in('HAS_STATE').task_uid CONTAINS '" + TASK_C + "'");
        sql("DELETE FROM KnowTaskHist WHERE state_uid = '" + TEST_STATE + "'");
        sql("DELETE FROM KnowSprint WHERE sprint_id = '" + MS_SPRINT + "'");
        sql("DELETE FROM KnowMilestone WHERE milestone_id IN ['" + OLD_MS + "', '" + NEW_MS + "']");
        assertNotNull(LoreArcadeDbTestResource.BASE_URL);
    }

    // ── V55 (RM-P17, вариант «б» владельца 05.11.2026) ─────────────────────

    private static final String DALI_SPRINT = "SPRINT_DALI_PARSE_MEM_PARALLEL_JUN26";
    private static final String DALI_P1_A = DALI_SPRINT + "/P1-A";

    @Test
    @Order(100)
    void v55_fillsDaliP1FromPr204MergedAt() throws Exception {
        post("/lore/sprint/create", "{\"sprint_id\":\"" + DALI_SPRINT + "\",\"name\":\"V55 проба\"}");
        post("/lore/task", "{\"sprint_id\":\"" + DALI_SPRINT + "\",\"task_id\":\"P1-A\",\"title\":\"проба V55\"}");
        nullOpenValidFrom(DALI_P1_A);
        assertNull(sql(openOf(DALI_P1_A)).get(0).get("valid_from"), "положительный контроль: дата снята");

        assertTrue(runner.backfillDaliP1FromPr204() >= 1, "V55 не заполнил ни одной строки");
        Map<String, Object> a = sql(openOf(DALI_P1_A)).get(0);
        assertEquals(at(LoreSchemaMigrations.PR204_MERGED_AT), at(a.get("valid_from")));
        assertEquals("pr#204.merged_at", a.get("valid_from_source"));
    }

    @Test
    @Order(101)
    void v55_secondRunAndOtherTasksUntouched() throws Exception {
        assertEquals(0, runner.backfillDaliP1FromPr204(), "повторный прогон снова что-то заполнил");
        // Чужая задача без даты (C из V52) по-прежнему NULL: V55 узкий по замыслу.
        assertNull(sql(openOf(TASK_C)).get(0).get("valid_from"), "V55 тронул задачу вне списка");
    }
}
