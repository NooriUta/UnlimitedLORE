package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
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
}
