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
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * DBR-07: {@code content_hash} у открытой Hist-строки реально проставляется.
 *
 * <p><b>Зачем тест на такую мелочь.</b> Штамповка хеша — блокирующая, а стояла
 * она в колбэке {@code map()} реактивной цепочки, то есть исполнялась на event
 * loop, где блокироваться нельзя. Падала она с
 * {@code IllegalStateException: The current thread cannot be blocked}, ловилась
 * общим {@code catch} внутри {@link LoreHashStamper} и уходила в предупреждение.
 *
 * <p>Наружу это выглядело как полный успех: задача создана, ответ {@code ok},
 * а {@code content_hash} пуст. На нём стоит обнаружение дрейфа в
 * {@code reconcile} — то есть расхождение файла и графа переставало
 * обнаруживаться, и reconcile отчитывался «всё сходится».
 *
 * <p>Проверять код возврата тут бесполезно по построению: он и был успешным.
 * Проверяется ФАКТ в графе.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreHashStampLiveDbTest {

    @Inject
    LoreIngestService ingest;

    private static final String SPRINT = "SPRINT_DBR07_HASH";
    private static final String TASK = SPRINT + "/H1";

    @Test
    @Order(1)
    void createSprintAndTaskWithBody() {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"DBR-07 hash\"}")
        .when().post("/lore/sprint/create").then().statusCode(200);

        // note_md обязателен: хеш считается по телу, и без тела штамповать нечего.
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"sprint_id\":\"" + SPRINT + "\",\"task_id\":\"H1\",\"title\":\"Задача с телом\","
                + "\"note_md\":\"тело, по которому считается content_hash\"}")
        .when().post("/lore/task").then().statusCode(200);
    }

    @Test
    @Order(2)
    void openHistRowCarriesContentHash() {
        var rows = ingest.queryPublic(
            "SELECT content_hash, note_md FROM (SELECT expand(out('HAS_STATE')) FROM KnowTask "
            + "WHERE task_uid = :id) WHERE valid_to IS NULL LIMIT 1", Map.of("id", TASK));
        assertEquals(1, rows.size(), "у задачи нет открытой Hist-строки — сломана фикстура, а не хеш");

        Object hash = rows.get(0).get("content_hash");
        assertNotNull(hash, "content_hash пуст: штамповка не отработала — скорее всего, "
            + "её снова позвали из реактивного колбэка (см. LoreHashStamper)");
        assertFalse(String.valueOf(hash).isBlank(), "content_hash пустая строка");

        // Хеш обязан совпадать с тем, что даёт функция от тела: иначе он есть,
        // но считается не по тому — а это хуже отсутствия, потому что дрейф
        // будет «обнаруживаться» там, где его нет, и наоборот.
        String body = String.valueOf(rows.get(0).get("note_md"));
        assertEquals(LoreContentHash.of(new String[]{body}), String.valueOf(hash),
            "content_hash не совпадает с хешем тела — считается не по тому набору полей");
    }
}
