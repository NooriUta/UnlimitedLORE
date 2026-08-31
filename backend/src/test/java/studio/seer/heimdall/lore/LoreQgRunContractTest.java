package studio.seer.heimdall.lore;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.containsString;

/**
 * SPRINT_QG_REBUILD/QG-12 + QG-03 + QG-15 — контракт записи прогона гейта
 * (SPEC-QG-ARCHITECTURE §4.9, §5).
 *
 * Миграция 29 добавила поля в схему. Схема без проверок на входе ничего не
 * меняет: 56 строк метрик без даты появились при полностью «правильной» схеме.
 * Поэтому обязательность живёт ЗДЕСЬ, на пути записи, где её можно объяснить
 * отказом с внятным текстом.
 *
 * Живая БД не нужна: все проверки стоят ДО первой команды в базу — намеренно,
 * чтобы прогон не ложился наполовину.
 *
 * ПОЛОЖИТЕЛЬНЫЙ КОНТРОЛЬ обязателен (инвариант И-6). Пять тестов, ожидающих 400,
 * прошли бы и на эндпоинте, который отвергает вообще всё — например если сломать
 * разбор тела. {@link #validRunIsNotRejectedByValidation()} доказывает, что
 * корректная запись сквозь эти же проверки проходит.
 */
@QuarkusTest
class LoreQgRunContractTest {

    private static final String ADMIN = "admin";

    private io.restassured.specification.RequestSpecification post(String body) {
        return given().header("X-Seer-Role", ADMIN).contentType("application/json").body(body);
    }

    /**
     * QG-03. Метрика без даты не встаёт в ряд, не стареет и не поднимает детектор
     * молчания: 56 строк из 191 (29%) уже такие, и сказать по ним «держится N дней»
     * не от чего. Старые остаются видимым долгом, новые не заводятся.
     */
    @Test
    void runDateIsRequired() {
        post("{\"routine_name\":\"qg-test\",\"status\":\"OK\"}")
        .when().post("/lore/qg/run")
        .then().statusCode(400)
            .body("error", equalTo("BAD_PARAMS"))
            .body("detail", containsString("run_date"));
    }

    /**
     * §4.8. Канал — величина из двух значений. Без него «прогонов не было, потому
     * что не было коммитов» неотличимо от «гейт умер», а это разные вердикты.
     * Свободная строка вернула бы неотличимость через другую дверь.
     */
    @Test
    void unknownChannelIsRejected() {
        post("{\"routine_name\":\"qg-test\",\"run_date\":\"2026-08-29\",\"status\":\"OK\","
            + "\"channel\":\"cron\"}")
        .when().post("/lore/qg/run")
        .then().statusCode(400)
            .body("error", equalTo("BAD_PARAMS"))
            .body("detail", containsString("channel"));
    }

    /**
     * §5. Молчаливый SKIP и есть разбираемый дефект: 35 метрик стояли в этом
     * состоянии, и по отчёту оно читалось как «в порядке».
     */
    @Test
    void skipWithoutReasonIsRejected() {
        post("{\"routine_name\":\"qg-test\",\"run_date\":\"2026-08-29\",\"status\":\"PARTIAL\","
            + "\"metrics\":[{\"key\":\"coverage_pct\",\"value\":-1,\"status\":\"SKIP\"}]}")
        .when().post("/lore/qg/run")
        .then().statusCode(400)
            .body("error", equalTo("BAD_PARAMS"))
            .body("detail", containsString("not_measured_reason"));
    }

    /** То же для нового явного состояния — иначе NOT_MEASURED стал бы новым тихим SKIP. */
    @Test
    void notMeasuredWithoutReasonIsRejected() {
        post("{\"routine_name\":\"qg-test\",\"run_date\":\"2026-08-29\",\"status\":\"PARTIAL\","
            + "\"metrics\":[{\"key\":\"slo_p95_ms\",\"value\":-1,\"status\":\"NOT_MEASURED\"}]}")
        .when().post("/lore/qg/run")
        .then().statusCode(400)
            .body("error", equalTo("BAD_PARAMS"))
            .body("detail", containsString("not_measured_reason"));
    }

    /**
     * Причина обязана быть ИЗ СЛОВАРЯ, а не просто непустой. Свободный текст не
     * группируется и не считается — `lore_addr_drift` прожил пять дней незамеченным
     * именно потому, что причина не была счётной величиной.
     */
    @Test
    void freeTextReasonIsRejected() {
        post("{\"routine_name\":\"qg-test\",\"run_date\":\"2026-08-29\",\"status\":\"PARTIAL\","
            + "\"metrics\":[{\"key\":\"slo_p95_ms\",\"value\":-1,\"status\":\"NOT_MEASURED\","
            + "\"not_measured_reason\":\"стенд лежит\"}]}")
        .when().post("/lore/qg/run")
        .then().statusCode(400)
            .body("error", equalTo("BAD_PARAMS"))
            .body("detail", containsString("not_measured_reason"));
    }

    /**
     * ПОЛОЖИТЕЛЬНЫЙ КОНТРОЛЬ (И-6): корректная запись со всеми полями контракта
     * проверки ПРОХОДИТ. Без него пять тестов выше подтверждали бы лишь то, что
     * эндпоинт умеет отвечать 400 — включая случай, когда он отвечает так на всё.
     *
     * Дальше запись уходит в базу, которой в этом тесте нет, поэтому конкретный
     * успешный код не фиксируем. Утверждение проверяется ровно то, которое делается:
     * ОТКАЗ НЕ ОТ ВАЛИДАЦИИ.
     *
     * Проверять «код не 400» было бы почти бессодержательно: этому условию
     * удовлетворяет и 404 от выключенного модуля, то есть контроль прошёл бы на
     * эндпоинте, который вообще не работает. Поэтому сверяется поле `error`: его
     * не должно быть либо оно не BAD_PARAMS. Так контроль остаётся верным и при
     * живой БД (200), и без неё (502 LORE_UPSTREAM), но ловит и выключенный
     * модуль, и подменённый маршрут.
     */
    @Test
    void validRunIsNotRejectedByValidation() {
        post("{\"routine_name\":\"qg-test\",\"run_date\":\"2026-08-29\",\"status\":\"OK\","
            + "\"channel\":\"actions\",\"source_url\":\"https://git.example/runs/1\","
            + "\"commit_sha\":\"abc1234\",\"pr_number\":554,"
            + "\"metrics\":[{\"key\":\"build_result\",\"value\":1,\"status\":\"PASS\"},"
            + "{\"key\":\"slo_p95_ms\",\"value\":-1,\"status\":\"NOT_MEASURED\","
            + "\"not_measured_reason\":\"stand_absent\"}]}")
        .when().post("/lore/qg/run")
        .then()
            .statusCode(not(400))
            .body("error", not(equalTo("BAD_PARAMS")))
            .body("error", not(equalTo("LORE_DISABLED")));
    }

    /**
     * Канал `app_job` тоже законен — иначе предыдущий контроль доказывал бы лишь
     * то, что словарь пропускает одно-единственное значение.
     */
    @Test
    void appJobChannelIsAccepted() {
        post("{\"routine_name\":\"qg-test\",\"run_date\":\"2026-08-29\",\"status\":\"OK\","
            + "\"channel\":\"app_job\",\"model\":\"claude-opus-5\"}")
        .when().post("/lore/qg/run")
        .then()
            .statusCode(not(400))
            .body("error", not(equalTo("BAD_PARAMS")))
            .body("error", not(equalTo("LORE_DISABLED")));
    }
}
