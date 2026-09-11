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
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
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

    /**
     * «Проверять было не на чем» обязано быть ОТДЕЛЬНЫМ ответом, а не «годен».
     *
     * <p>Это и есть дефект, из-за которого вердикт, взятый на ПУСТОМ типе,
     * кэшировался как «пригоден» на десять минут TTL: {@link #checkOne}
     * возвращал {@code null}, {@link LoreFtIndexHealth#check()} собирал только
     * плохие находки, и «не на чем проверить» исчезало без следа.
     *
     * <p><b>Первая редакция этого теста начиналась с {@code assumeTrue}</b>
     * «если на стенде есть пустой тип» — и это была не проверка, а лотерея:
     * на стенде, где все типы реестра непусты, тест ОТМЕНЯЕТСЯ и выглядит
     * пройденным. Гарантировать пустой тип нельзя, а вот гарантировать пустое
     * ПОЛЕ можно: свойство, которого в схеме нет, даёт ноль строк на любой
     * базе. Теперь условие создаёт сам тест, и он исполняется всегда.
     */
    @Test
    @Order(4)
    void nothingToCheckOnIsItsOwnAnswerNotAPass() {
        // Тип настоящий и с данными (их посеял seed), а поле — несуществующее.
        // probeWord получает ноль строк, то есть ровно ситуацию «пустой тип».
        var noData = new LoreSchemaMigrations.FtIndex(
            "ftPhantomFieldNeverPopulated", "KnowTaskHist", List.of("zzq_field_that_does_not_exist"));

        assertNull(health.checkOne(noData),
            "проверять не на чем — вердикта быть не должно. Любой не-null здесь означает, "
            + "что проверка что-то РЕШИЛА, не посмотрев на данные");

        // Соседний Order(3) доказывает обратную сторону: на типе С данными и
        // отсутствующим индексом вердикт есть и он плохой. Вместе две пробы
        // разводят «нечего проверять» и «проверили, всё плохо» — до правки оба
        // случая выглядели одинаково: индекс просто не попадал в выдачу.
    }

    /**
     * {@code checkAll()} обязан быть ШИРЕ {@code check()} ровно на то, по чему
     * вердикта нет, и совпадать с ним по плохим находкам.
     *
     * <p>Без этого равенства кэш строился бы по одному источнику, а список «без
     * вердикта» — по другому, и они разошлись бы молча. Проверка исполняется
     * всегда: она не зависит от того, есть ли сегодня на стенде пустые типы.
     */
    @Test
    @Order(5)
    void checkIsExactlyTheBadSubsetOfCheckAll() {
        var all = health.checkAll();

        List<String> badFromCheck = health.check().stream()
            .map(LoreFtIndexHealth.Finding::index).sorted().toList();
        List<String> badFromAll = all.entrySet().stream()
            .filter(e -> e.getValue() != null && !e.getValue().ok())
            .map(java.util.Map.Entry::getKey).sorted().toList();

        assertEquals(badFromAll, badFromCheck,
            "check() обязан быть ровно плохим подмножеством checkAll() — иначе кэш "
            + "и список «без вердикта» ведутся по разным источникам");
        assertTrue(all.size() >= badFromCheck.size(),
            "checkAll() не может быть УЖЕ check(): в ней живут и индексы без вердикта");
    }
}
