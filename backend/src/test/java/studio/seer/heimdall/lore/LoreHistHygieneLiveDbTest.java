package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;

/**
 * RM-P17: срез {@code history_hygiene} обязан ловить ОТКРЫТУЮ строку истории
 * без {@code valid_from} — и переставать её показывать, когда дата появилась.
 *
 * <p>Зачем вообще. Семь задач на проде (SPRINT_DALI_PARSE_MEM_PARALLEL_JUN26/P1-A…G)
 * держат текущее состояние без {@code valid_from}, и потому выпадают из
 * {@code task_starts} и {@code task_created_dates} МОЛЧА: lead/cycle time
 * считается без них, а пустая выдача читается как «таких задач не было».
 *
 * <p><b>Три шага одной мысли, и ни один не выбрасывается:</b>
 * <ol>
 *   <li>здоровая задача в срезе НЕ числится — без этого «нашли дефект»
 *       неотличимо от «срез показывает всех подряд»;</li>
 *   <li>убираем дату у открытой строки — задача появляется, с {@code ref_id}
 *       и {@code hist_type}, то есть находка адресует, а не только сигналит;</li>
 *   <li>возвращаем дату — находка уходит.</li>
 * </ol>
 * Шаги 1 и 3 — положительный контроль к шагу 2: именно его отсутствие делает
 * проверки срезов самоподтверждающимися (постоянно непустой срез проходил бы
 * шаг 2 не замечая, что сломан).
 *
 * <p>Дефект нельзя завести через API: любой пишущий путь ставит
 * {@code valid_from} сам — поэтому строка портится прямым UPDATE, ровно как
 * она и появилась на проде (остаток старых путей записи). Правка адресована
 * задаче этого теста и ничего, кроме неё, не касается.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreHistHygieneLiveDbTest {

    @Inject
    LoreIngestService ingest;

    private static final String SPRINT = "SPRINT_HIST_HYG_TEST";
    private static final String TASK = SPRINT + "/HH-1";

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    /** Открытую строку задачи — ровно одну, свою — правим прямым UPDATE. */
    private void setValidFrom(String value) {
        // Фильтр по обходу — CONTAINS, а не [0] =: многосвязное иначе видно под
        // одним случайным значением (ArcadeDB edge syntax).
        ingest.queryPublic(
            "UPDATE KnowTaskHist SET valid_from = " + (value == null ? "null" : ":ts")
            + " WHERE valid_to IS NULL AND in('HAS_STATE').task_uid CONTAINS :uid",
            value == null ? Map.of("uid", TASK) : Map.of("ts", value, "uid", TASK));
    }

    @Test
    @Order(1)
    void healthyTaskIsNotInTheReport() {
        post("/lore/sprint/create", "{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"Гигиена истории\"}");
        post("/lore/task", "{\"sprint_id\":\"" + SPRINT + "\",\"task_id\":\"HH-1\","
            + "\"title\":\"Задача с датой состояния\"}");

        given().when().get("/lore/slice/history_hygiene")
        .then().statusCode(200)
            .body("rows.ref_id", not(hasItem(TASK)));
    }

    @Test
    @Order(2)
    void openStateWithoutValidFromIsCaught() {
        setValidFrom(null);

        given().when().get("/lore/slice/history_hygiene")
        .then().statusCode(200)
            .body("rows.findAll { it.finding == 'open_state_without_valid_from' }.ref_id",
                hasItem(TASK))
            .body("rows.find { it.ref_id == '" + TASK + "' }.hist_type", equalTo("KnowTaskHist"))
            .body("rows.find { it.ref_id == '" + TASK + "' }.entity_type", equalTo("task"));
    }

    @Test
    @Order(3)
    void datedStateLeavesTheReport() {
        setValidFrom("2026-10-20T00:00:00Z");

        given().when().get("/lore/slice/history_hygiene")
        .then().statusCode(200)
            .body("rows.ref_id", not(hasItem(TASK)));
    }

    // ── S2-11: задача без единой версии (запись мимо SCD2) ──

    @Inject
    LoreSchemaMigrationRunner runner;

    private static final String BARE = SPRINT + "/HH-BARE";

    @Test
    @Order(4)
    void taskWithoutAnyHistoryIsCaughtAndV71HealsIt() {
        // Как на проде (PRE-03, DLG-08): вершина есть, HAS_STATE нет, статус сырой.
        ingest.queryPublic("INSERT INTO KnowTask SET task_uid = :uid, task_id = 'HH-BARE', "
            + "title = 'мимо SCD2', status_raw = 'PARTIAL'", Map.of("uid", BARE));

        given().when().get("/lore/slice/history_hygiene")
        .then().statusCode(200)
            .body("rows.findAll { it.finding == 'entity_without_history' }.ref_id", hasItem(BARE));

        assertTrue(runner.backfillTaskHistory() >= 1, "V71 открыл версию задаче без истории");
        assertEquals(0, runner.backfillTaskHistory(), "повтор — ноль, вторая версия не открывается");

        List<Map<String, Object>> rows = ingest.queryPublic(
            "SELECT valid_from, valid_to, status_backfilled, status_raw FROM KnowTaskHist "
            + "WHERE in('HAS_STATE').task_uid CONTAINS :uid", Map.of("uid", BARE));
        assertEquals(1, rows.size(), rows.toString());
        assertEquals(true, rows.get(0).get("status_backfilled"), "честная пометка «время восстановлено»");
        assertEquals("PARTIAL", rows.get(0).get("status_raw"));

        given().when().get("/lore/slice/history_hygiene")
        .then().statusCode(200)
            .body("rows.ref_id", not(hasItem(BARE)));
    }

    private static final String SHARED_A = SPRINT + "/HH-SHARED-A";
    private static final String SHARED_B = SPRINT + "/HH-SHARED-B";
    private static final String WRONG = SPRINT + "/HH-WRONG";

    /**
     * S2-11, прод 09.11: у PRE-03 статус виден через out('HAS_STATE'), а история по задаче пуста —
     * версия, на которую ведёт ребро, не находится как «своя» (in('HAS_STATE').task_uid[0]).
     * Два способа так сломаться: версия ОБЩАЯ с другой задачей (у PRE-03 и DLG-08 одна заметка)
     * или версия ЧУЖОГО класса. entity_without_history этого не видит — ребро-то есть.
     */
    @Test
    @Order(5)
    void sharedOrForeignStateIsCaught() {
        ingest.queryPublic("INSERT INTO KnowTask SET task_uid = :uid, task_id = 'HH-SHARED-A', title = 'A'", Map.of("uid", SHARED_A));
        ingest.queryPublic("INSERT INTO KnowTask SET task_uid = :uid, task_id = 'HH-SHARED-B', title = 'B'", Map.of("uid", SHARED_B));
        ingest.queryPublic("INSERT INTO KnowTask SET task_uid = :uid, task_id = 'HH-WRONG', title = 'W'", Map.of("uid", WRONG));
        ingest.queryPublic("CREATE VERTEX KnowTaskHist SET state_uid = 'hh-shared-1', status_raw = 'DONE', "
            + "valid_from = '2026-11-09T10:00:00.000Z'", Map.of());
        ingest.queryPublic("CREATE EDGE HAS_STATE FROM (SELECT FROM KnowTask WHERE task_uid = :a) "
            + "TO (SELECT FROM KnowTaskHist WHERE state_uid = 'hh-shared-1')", Map.of("a", SHARED_A));
        ingest.queryPublic("CREATE EDGE HAS_STATE FROM (SELECT FROM KnowTask WHERE task_uid = :b) "
            + "TO (SELECT FROM KnowTaskHist WHERE state_uid = 'hh-shared-1')", Map.of("b", SHARED_B));
        ingest.queryPublic("CREATE VERTEX KnowSprintHist SET state_uid = 'hh-wrong-1', status_raw = 'DONE', "
            + "valid_from = '2026-11-09T10:00:00.000Z'", Map.of());
        ingest.queryPublic("CREATE EDGE HAS_STATE FROM (SELECT FROM KnowTask WHERE task_uid = :w) "
            + "TO (SELECT FROM KnowSprintHist WHERE state_uid = 'hh-wrong-1')", Map.of("w", WRONG));

        given().when().get("/lore/slice/history_hygiene")
        .then().statusCode(200)
            .body("rows.findAll { it.finding == 'state_shared_by_entities' }.state_uid", hasItem("hh-shared-1"))
            .body("rows.findAll { it.finding == 'state_wrong_class' }.ref_id", hasItem(WRONG));
    }

    /**
     * S2-11, прод 09.11 (v1.17.8): сторож нашёл 15 общих версий — 13 у релизов, 2 у задач
     * (SPRINT_SITE_SEO_PRERENDER/META-05 делит версию с PRE-03). V77 разводит их: первый владелец
     * сохраняет версию, остальные получают СВОЮ копию с теми же полями и датами (ничего не
     * выдумано), ребро переводится на копию. Повтор — ноль: общих больше нет.
     */
    @Test
    @Order(6)
    void sharedStateIsSplitByV77AndHistoryOfBothOwnersIsVisible() {
        assertTrue(runner.splitSharedStates() >= 1, "V77 развёл общую версию");
        assertEquals(0, runner.splitSharedStates(), "повтор — ноль, общих версий больше нет");

        for (String uid : List.of(SHARED_A, SHARED_B)) {
            List<Map<String, Object>> rows = ingest.queryPublic(
                "SELECT state_uid, status_raw, valid_from FROM KnowTaskHist "
                + "WHERE in('HAS_STATE').task_uid CONTAINS :uid", Map.of("uid", uid));
            assertEquals(1, rows.size(), uid + ": ровно одна своя версия, " + rows);
            assertEquals("DONE", rows.get(0).get("status_raw"), uid + ": статус скопирован");
            assertTrue(String.valueOf(rows.get(0).get("valid_from")).startsWith("2026-11-09"),
                uid + ": дата скопирована, не выдумана: " + rows.get(0));
        }
        List<Map<String, Object>> owners = ingest.queryPublic(
            "SELECT in('HAS_STATE').size() AS n FROM KnowTaskHist WHERE state_uid = 'hh-shared-1'", Map.of());
        assertEquals(1, ((Number) owners.get(0).get("n")).intValue(), "у исходной версии остался один владелец");

        given().when().get("/lore/slice/history_hygiene")
        .then().statusCode(200)
            .body("rows.findAll { it.finding == 'state_shared_by_entities' }.ref_id", not(hasItem(SHARED_A)))
            .body("rows.findAll { it.finding == 'state_shared_by_entities' }.ref_id", not(hasItem(SHARED_B)));
    }

    // ── B9: общая версия НЕ приписывается «первому владельцу» ([0]-конвенция) ──

    private static final String B9_A = SPRINT + "/HH-B9-A";
    private static final String B9_B = SPRINT + "/HH-B9-B";
    private static final String B9_VF = "2026-11-09T12:00:00.000Z";

    /**
     * B9: версия с двумя владельцами видна В ОБЕИХ историях. До правки срезы искали
     * {@code in('HAS_STATE').task_uid[0] = :id} — у второго владельца история пуста
     * молча, а /lore/history отдавал строки с чужим ref_id. V77 (заказ 6) развёл
     * только СУЩЕСТВОВАВШИЕ общие версии; конвенция [0] сломала бы новую снова —
     * кейс строит свою общую версию уже после V77 и проверяет чтение, не миграцию.
     */
    @Test
    @Order(7)
    void sharedVersionIsVisibleInHistoryOfBothOwners() {
        ingest.queryPublic("INSERT INTO KnowTask SET task_uid = :uid, task_id = 'HH-B9-A', title = 'B9 A'", Map.of("uid", B9_A));
        ingest.queryPublic("INSERT INTO KnowTask SET task_uid = :uid, task_id = 'HH-B9-B', title = 'B9 B'", Map.of("uid", B9_B));
        ingest.queryPublic("CREATE VERTEX KnowTaskHist SET state_uid = 'hh-b9-1', status_raw = 'DONE', valid_from = :vf",
            Map.of("vf", B9_VF));
        for (String uid : List.of(B9_A, B9_B)) {
            ingest.queryPublic("CREATE EDGE HAS_STATE FROM (SELECT FROM KnowTask WHERE task_uid = :u) "
                + "TO (SELECT FROM KnowTaskHist WHERE state_uid = 'hh-b9-1')", Map.of("u", uid));
        }

        // срез истории задачи: версия видна каждому владельцу, не только [0]
        for (String uid : List.of(B9_A, B9_B)) {
            given().when().get("/lore/slice/history_task?id=" + uid)
            .then().statusCode(200)
                .body("rows.size()", equalTo(1))
                .body("rows[0].status_raw", equalTo("DONE"));
        }

        // общий /lore/history: ref_id — запрошенная запись, а не первый владелец версии
        for (String uid : List.of(B9_A, B9_B)) {
            given().when().get("/lore/history?type=task&id=" + uid)
            .then().statusCode(200)
                .body("rows.size()", equalTo(1))
                .body("rows[0].ref_id", equalTo(uid));
        }

        // пакетный срез не выдаёт общую версию за одного владельца: маркер shared честный.
        // Какой из владельцев попадёт в task_uid — порядок хранилища, поэтому только
        // «строка есть ровно под одним из них и помечена shared».
        String b9rows = "rows.findAll { it.task_uid == '" + B9_A + "' || it.task_uid == '" + B9_B + "' }";
        given().when().get("/lore/slice/task_starts")
        .then().statusCode(200)
            .body(b9rows + ".size()", greaterThanOrEqualTo(1))
            .body(b9rows + ".shared", everyItem(equalTo(true)));
    }
}
