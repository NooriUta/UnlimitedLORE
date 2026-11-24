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
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-08 — громкий fallback end-to-end на живой базе:
 * {@code GET /lore/model} называет источник модели (тело + заголовок, включая 304),
 * а отказ чтения оставляет след в ряде {@code MetricSnapshot}, а не только строку в логе.
 * Восстановление в finally — класс не должен оставлять стор в file-состоянии.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreModelFallbackLiveDbTest {

    static final String PROBE_UID = "kreg08-fallback-probe";

    @Inject
    LoreModelStore store;

    static LoreArcadeDbTestResource.HttpDb db() {
        return new LoreArcadeDbTestResource.HttpDb(new LoreArcadeDbTestResource.Conn(
            LoreArcadeDbTestResource.BASE_URL, LoreArcadeDbTestResource.TEST_DB, LoreArcadeDbTestResource.ROOT_PASSWORD));
    }

    @Test
    @Order(1)
    void modelEndpointDeclaresSourceInBodyAndHeader() {
        String tag = given().get("/lore/model").then().statusCode(200)
            .header("X-Lore-Model-Source", "lore")
            .body("config.source", equalTo("lore"))
            .body("config.warning", nullValue())
            .extract().header("ETag");
        given().header("If-None-Match", tag).get("/lore/model").then().statusCode(304)
            .header("X-Lore-Model-Source", "lore");
    }

    @Test
    @Order(2)
    void failedReadFallsBackLoudlyEndToEnd() {
        // Инвариант стора: ровно одна открытая версия. Вторая — load() отказывает → fallback.
        // OPEN_SQL находит версии по ребру HAS_STATE — пробу привязываем, как это делает write().
        db().command("INSERT INTO KnowModelConfigHist SET state_uid='" + PROBE_UID + "', "
            + "valid_from='2026-11-24T00:00:00Z', valid_to=NULL, content='{}', content_hash='probe', reason='KREG-08 probe'");
        db().command("CREATE EDGE HAS_STATE FROM (SELECT FROM KnowModelConfig WHERE config_id='lore-model') "
            + "TO (SELECT FROM KnowModelConfigHist WHERE state_uid='" + PROBE_UID + "')");
        store.load();
        try {
            given().get("/lore/model").then().statusCode(200)
                .header("X-Lore-Model-Source", "file")
                .body("config.source", equalTo("file"))
                .body("config.warning", notNullValue());
            List<Map<String, Object>> points = db().query("SELECT object_id, metric, value FROM MetricSnapshot "
                + "WHERE object_id='lore-model' AND metric='lore.model.source'");
            assertEquals(1, points.size(), "ровно одна сигнальная точка за один отказ: " + points);
            assertEquals(0.0, ((Number) points.get(0).get("value")).doubleValue(), "0 — работа по файлу");
        } finally {
            db().command("DELETE FROM KnowModelConfigHist WHERE state_uid='" + PROBE_UID + "'");
            store.load();
        }
        given().get("/lore/model").then().statusCode(200)
            .header("X-Lore-Model-Source", "lore")
            .body("config.source", equalTo("lore"));
        assertTrue("lore".equals(store.source()), "стор возвращён в lore-состояние — другим тестам класса чисто");
    }
}
