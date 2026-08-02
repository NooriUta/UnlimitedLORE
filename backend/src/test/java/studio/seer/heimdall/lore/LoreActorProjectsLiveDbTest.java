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
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * AL-107: актор принадлежит НЕСКОЛЬКИМ проектам, и запись это сохраняет.
 *
 * <p><b>Что было.</b> Запись сносила все рёбра {@code BELONGS_TO_PROJECT} и
 * создавала одно из скалярного {@code project}. Модель при этом мультипроектная
 * — слайс {@code actors} отдаёт {@code projects} массивом, и по D18 актор
 * проектный именно затем, чтобы одноимённые роли разных продуктов не
 * склеивались. То есть чтение знало про множество, а запись — нет.
 *
 * <p>Наружу потеря выглядела как успех: {@code ok:true}, ни ошибки, ни
 * предупреждения. Путь к ней — самый обычный: открыть карточку, поправить
 * название, сохранить.
 *
 * <p>Поэтому тест проверяет ФАКТ в графе после записи, а не код возврата.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreActorProjectsLiveDbTest {

    @Inject
    LoreIngestService ingest;

    private static final String P1 = "LORE_TEST_ORG/al107-one";
    private static final String P2 = "LORE_TEST_ORG/al107-two";
    private static final String P3 = "LORE_TEST_ORG/al107-three";
    private static final String ACTOR = "ACT-AL107-MULTI";

    /** Слаги проектов актора — то, ради чего весь тест. */
    private List<String> projectsOf(String actorId) {
        var rows = ingest.queryPublic(
            "SELECT out('BELONGS_TO_PROJECT').slug AS slugs FROM KnowActor WHERE actor_id = :id",
            Map.of("id", actorId));
        if (rows.isEmpty() || !(rows.get(0).get("slugs") instanceof List<?> l)) return List.of();
        return l.stream().filter(java.util.Objects::nonNull).map(String::valueOf).sorted().toList();
    }

    private static void saveActor(String body) {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body(body)
        .when().post("/lore/actor").then().statusCode(200).body("ok", equalTo(true));
    }

    @Test
    @Order(1)
    void setUp() {
        for (String slug : List.of(P1, P2, P3)) {
            given().header("X-Seer-Role", "superadmin").contentType("application/json")
                .body("{\"slug\":\"" + slug + "\"}")
            .when().post("/lore/project").then().statusCode(200);
        }
        saveActor("{\"actor_id\":\"" + ACTOR + "\",\"name\":\"AL-107 мультипроект\",\"kind\":\"human-role\","
            + "\"projects\":[\"" + P1 + "\",\"" + P2 + "\"]}");
        assertEquals(List.of(P1, P2), projectsOf(ACTOR), "два проекта должны записаться оба");
    }

    @Test
    @Order(2)
    void editingWithoutTouchingProjectsKeepsThemAll() {
        // Главный сценарий регрессии: открыл карточку, поправил название,
        // сохранил. Ключа projects в запросе нет вовсе — значит рёбра не наше
        // дело, и трогать их нельзя. Прежняя редакция теряла здесь второй
        // проект, если форма подставляла первый из списка.
        saveActor("{\"actor_id\":\"" + ACTOR + "\",\"name\":\"переименован\"}");
        assertEquals(List.of(P1, P2), projectsOf(ACTOR),
            "правка без упоминания проектов не должна менять набор рёбер");
    }

    @Test
    @Order(3)
    void addingThirdKeepsFirstTwo() {
        saveActor("{\"actor_id\":\"" + ACTOR + "\",\"projects\":[\""
            + P1 + "\",\"" + P2 + "\",\"" + P3 + "\"]}");
        assertEquals(List.of(P1, P3, P2).stream().sorted().toList(), projectsOf(ACTOR),
            "добавление третьего не должно снимать первые два");
    }

    @Test
    @Order(4)
    void removingOneKeepsTheRest() {
        saveActor("{\"actor_id\":\"" + ACTOR + "\",\"projects\":[\"" + P1 + "\",\"" + P3 + "\"]}");
        assertEquals(List.of(P1, P3), projectsOf(ACTOR), "снятие одного не должно трогать остальные");
    }

    @Test
    @Order(5)
    void scalarProjectStillWorksAsSingleItemList() {
        // Совместимость: MCP actor_new и прежние вызовы шлют скаляр. Он и
        // должен означать «набор из одного» — то есть остальные снимаются.
        saveActor("{\"actor_id\":\"" + ACTOR + "\",\"project\":\"" + P2 + "\"}");
        assertEquals(List.of(P2), projectsOf(ACTOR), "скалярный project задаёт набор из одного");
    }

    @Test
    @Order(6)
    void emptyListMeansDetachAll() {
        // Пустой список и ОТСУТСТВИЕ ключа — разное: первое осознанное
        // «убрать все», второе «не моё дело». Без этого различения нельзя
        // было бы отвязать актора от проектов вообще.
        saveActor("{\"actor_id\":\"" + ACTOR + "\",\"projects\":[]}");
        assertTrue(projectsOf(ACTOR).isEmpty(), "пустой список — осознанное снятие всех привязок");
    }

    @Test
    @Order(7)
    void unregisteredSlugIsReportedInsteadOfSilentOk() {
        // CREATE EDGE с пустым TO — тихий no-op: несуществующий проект не даёт
        // ошибки, и раньше ответ был просто ok:true. Теперь несделанная работа
        // названа в ответе.
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"actor_id\":\"" + ACTOR + "\",\"projects\":[\"" + P1 + "\",\"LORE_TEST_ORG/нет-такого\"]}")
        .when().post("/lore/actor")
        .then().statusCode(200)
            .body("ok", equalTo(true))
            .body("projects_linked", equalTo(1))
            .body("projects_missing[0]", equalTo("LORE_TEST_ORG/нет-такого"));
        assertEquals(List.of(P1), projectsOf(ACTOR), "существующий проект привязан, несуществующий — нет");
    }
}
