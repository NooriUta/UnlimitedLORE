package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;

/**
 * AN-01 (ADR-LORE-030 §1): ядро VP-аналитики. Слайс feature_vp_analytics отдаёт
 * на корень линейки все множества трёх осей fit: заявлено (клеймы корня) vs
 * доставлено (рёбра сценариев), выгоды с метрикой отдельным множеством —
 * без metric_md доставка не измерима и fit не засчитывается (ADR-032 §2).
 * Акторы — ФАКТИЧЕСКИЕ, через HAS_ACTOR сценариев. Замыкание считает потребитель
 * разностью множеств (raw-факты; GROUP BY-ловушка ArcadeDB).
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreFeatureVpAnalyticsLiveDbTest {

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    @Test
    void fitAxesAreAssembledFromClaimAndDeliveryEdges() {
        // Корень линейки с клеймами по трём осям.
        post("/lore/feature", "{\"feature_id\":\"FEAT-FIT\",\"title\":\"Фича с проверяемой ценностью\"}");
        post("/lore/pain", "{\"pain_id\":\"PAIN-FIT\",\"title\":\"Боль оси fit\",\"severity\":\"high\"}");
        post("/lore/gain", "{\"gain_id\":\"GAIN-FIT-MET\",\"title\":\"Измеримая выгода\","
            + "\"metric_md\":\"замкнутых связок > 0\"}");
        post("/lore/gain", "{\"gain_id\":\"GAIN-FIT-VAGUE\",\"title\":\"Выгода без метрики\"}");
        post("/lore/job", "{\"job_id\":\"JOB-FIT\",\"title\":\"Работа клиента\",\"kind\":\"functional\"}");
        post("/lore/project-actor", "{\"actor_id\":\"ACT-FIT\",\"name\":\"Фактический исполнитель\",\"kind\":\"human-role\"}");
        post("/lore/milestone", "{\"milestone_id\":\"M-FIT\",\"label\":\"Веха fit\",\"week\":95}");

        post("/lore/feature/link", "{\"feature_id\":\"FEAT-FIT\",\"rel\":\"pain\",\"target_id\":\"PAIN-FIT\"}");
        post("/lore/feature/link", "{\"feature_id\":\"FEAT-FIT\",\"rel\":\"gain\",\"target_id\":\"GAIN-FIT-MET\"}");
        post("/lore/feature/link", "{\"feature_id\":\"FEAT-FIT\",\"rel\":\"gain\",\"target_id\":\"GAIN-FIT-VAGUE\"}");
        post("/lore/feature/link", "{\"feature_id\":\"FEAT-FIT\",\"rel\":\"job\",\"target_id\":\"JOB-FIT\"}");
        post("/lore/feature/link", "{\"feature_id\":\"FEAT-FIT\",\"rel\":\"milestone\",\"target_id\":\"M-FIT\"}");

        // Сценарий доставляет: снимает боль, создаёт ОБЕ выгоды, выполняет работу.
        post("/lore/uc", "{\"uc_id\":\"UC-FIT-S1\",\"title\":\"Сценарий доставки\","
            + "\"parent_uc_id\":\"FEAT-FIT\",\"goal_level\":\"sea-level\"}");
        post("/lore/uc/link", "{\"uc_id\":\"UC-FIT-S1\",\"rel\":\"relieves\",\"target_id\":\"PAIN-FIT\"}");
        post("/lore/uc/link", "{\"uc_id\":\"UC-FIT-S1\",\"rel\":\"delivers\",\"target_id\":\"GAIN-FIT-MET\"}");
        post("/lore/uc/link", "{\"uc_id\":\"UC-FIT-S1\",\"rel\":\"delivers\",\"target_id\":\"GAIN-FIT-VAGUE\"}");
        post("/lore/uc/link", "{\"uc_id\":\"UC-FIT-S1\",\"rel\":\"performs\",\"target_id\":\"JOB-FIT\"}");
        post("/lore/uc/link", "{\"uc_id\":\"UC-FIT-S1\",\"rel\":\"actor\",\"target_id\":\"ACT-FIT\"}");

        given().when().get("/lore/slice/feature_vp_analytics")
        .then().statusCode(200)
            .rootPath("rows.find { it.uc_id == 'FEAT-FIT' }")
            .body("milestone_id", equalTo("M-FIT"))
            // Заявлено — с корня.
            .body("claimed_pain_ids", hasItem("PAIN-FIT"))
            .body("claimed_gain_ids", hasItem("GAIN-FIT-VAGUE"))
            .body("claimed_job_ids", hasItem("JOB-FIT"))
            // Доставлено — со сценариев.
            .body("relieved_pain_ids", hasItem("PAIN-FIT"))
            .body("performed_job_ids", hasItem("JOB-FIT"))
            .body("delivered_gain_ids", hasItem("GAIN-FIT-VAGUE"))
            // Измеримая доставка: выгода без metric_md НЕ замыкает fit.
            .body("delivered_measured_gain_ids", hasItem("GAIN-FIT-MET"))
            .body("delivered_measured_gain_ids", not(hasItem("GAIN-FIT-VAGUE")))
            // «Ценность доехала»: shipped-сценариев нет — пусто, не ошибка.
            .body("shipped_job_ids", not(hasItem("JOB-FIT")))
            // Фактические акторы — через HAS_ACTOR сценария.
            .body("actor_ids", hasItem("ACT-FIT"));
    }
}
