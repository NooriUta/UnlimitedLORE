package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;

/**
 * Срез расхождения поле/ребро обязан ВЫПОЛНЯТЬСЯ на настоящем движке
 * (SPRINT_LORE_ONE_TRUTH/NM-04).
 *
 * Тест заведён после того, как первая редакция среза уехала на стенд и отдала
 * 400: {@code expand(unionall(...))} с {@code LET} требует внешнего
 * {@code SELECT ... FROM (...)}, а без него запрос не разбирается. Компиляция
 * этого не ловит — SQL здесь строка, и ошибка в ней видна только движку.
 *
 * Отсюда же форма проверки: недостаточно «не 500». Пустая выдача выглядела бы
 * успехом ровно так же, поэтому проверяется ЧИСЛО строк — по две на каждый тип
 * из таблицы канонических рёбер. Схлопнись объединение до одной ветки, тест
 * упадёт, а не промолчит.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class ComponentDriftSliceLiveDbTest {

    /** 7 типов × 2 метрики. Держится синхронно с COMPONENT_FIELD_TYPES. */
    private static final int EXPECTED_ROWS = 14;

    @Test
    void driftSliceRunsAndReportsEveryTypeInBothDirections() {
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/component_field_edge_drift")
        .then().statusCode(200)
            .body("rows", hasSize(EXPECTED_ROWS))
            // Обе метрики обязаны присутствовать: одна из них — контроль того,
            // что миграция добавляла, а не переписывала. Потеряв её, гейт
            // перестанет отличать слияние от подмены.
            .body("rows.metric", hasItem("field_no_edge"))
            .body("rows.metric", hasItem("edge_no_field"))
            // Спека считается по своему ребру. Если здесь окажется BELONGS_TO,
            // значит таблица канонических рёбер разъехалась с кодом — и гейт
            // будет вечно показывать у спек ненулевой остаток.
            .body("rows.find { it.type == 'KnowSpec' }.edge", equalTo("DOCUMENTED_IN"))
            .body("rows.find { it.type == 'KnowADR' }.edge", equalTo("BELONGS_TO"))
            // Счётчики — числа, а не null: null означал бы, что подзапрос
            // выполнился, но агрегат не доехал (известная ловушка этого движка
            // при выборке неагрегированных полей из подзапроса).
            .body("rows.n", everyItem(greaterThan(-1)));
    }
}
