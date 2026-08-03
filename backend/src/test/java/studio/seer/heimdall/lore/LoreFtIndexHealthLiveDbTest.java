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

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * DBR-08 — {@link LoreFtIndexHealth} на живой БД.
 *
 * <p>Проверяется свойство, которое обычным юнитом не проверить: индекс отвечает
 * на слово, взятое из его собственных данных. Дефект, ради которого проверка
 * написана, выглядел как полностью исправная система — индекс на месте, имя из
 * реестра, {@code CREATE INDEX} отчитался числом записей, а поиск по телам
 * задач не находил ничего.
 *
 * <p>Второй тест намеренно негативный. Без него первый ничего не стоит: на
 * маленькой тест-БД индексы не переполняются, и «зелено» означало бы лишь
 * «проверка ничего не смотрит». Урок повторный — так же выкатили за флагом
 * непроверенный скоуп (AL-95).
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreFtIndexHealthLiveDbTest {

    private static final String SPRINT = "SPRINT_FTHEALTH_TEST";
    private static final String WORD = "полнотекстовый";

    @Inject
    LoreFtIndexHealth health;

    @Test
    @Order(1)
    void seed() {
        // Нужны РЕАЛЬНЫЕ тела: проверка берёт пробное слово из самих данных, и
        // на пустом типе ей нечего спрашивать (такой тип она пропускает).
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"Спринт проверки индексов\"}")
        .when().post("/lore/sprint/create").then().statusCode(200);

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"sprint_id\":\"" + SPRINT + "\",\"task_id\":\"FT1\","
                + "\"title\":\"Задача с телом\","
                + "\"note_md\":\"Тело задачи, в котором есть " + WORD + " индекс.\"}")
        .when().post("/lore/task").then().statusCode(200);
    }

    @Test
    @Order(2)
    void everyRegisteredIndexAnswersAWordTakenFromItsOwnData() {
        List<LoreFtIndexHealth.Finding> bad = health.check();
        assertTrue(bad.isEmpty(),
            "непригодные полнотекстовые индексы: " + bad + ". Такой индекс не отсутствует — "
            + "он отвечает и находит меньше, чем в нём лежит, поэтому поиск выглядит рабочим");
    }

    @Test
    @Order(3)
    void checkActuallyFailsWhenTheIndexCannotServeTheQuery() {
        // Тип настоящий и с данными, индекса с таким именем нет. Если проверка
        // и здесь скажет «всё хорошо» — она не смотрит ни на что, и зелёный
        // предыдущего теста ничего не значит.
        var phantom = new LoreSchemaMigrations.FtIndex(
            "ftPhantomIndexThatWasNeverCreated", "KnowTaskHist", List.of("note_md"));

        LoreFtIndexHealth.Finding f = health.checkOne(phantom);

        assertNotNull(f, "на типе с данными проверка обязана дать вердикт, а не пропуск");
        assertFalse(f.ok(), "несуществующий индекс не может считаться пригодным: " + f);
    }
}
