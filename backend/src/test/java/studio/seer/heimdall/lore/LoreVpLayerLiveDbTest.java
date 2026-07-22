package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;

/**
 * PL-25/PL-26 (ADR-LORE-032 §2 D5, ADR-LORE-027 D1): Value Proposition как ГРАФ.
 *
 * Инварианты, ради которых боли и выгоды стали вершинами:
 *  - фича ЗАЯВЛЯЕТ (ADDRESSES/PROMISES), UC СНИМАЕТ/СОЗДАЁТ (RELIEVES/DELIVERS) —
 *    расхождение заявленного и сделанного видно рёбрами, а не вычиткой прозы;
 *  - боль переиспользуется НЕСКОЛЬКИМИ фичами (кросс-фичевая канва, «горячая боль»);
 *  - выгода без metric_md не замкнута — сервер предупреждает сразу;
 *  - шкала целей Коберна одна на слой, вес оформления выводится из уровня (D1).
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreVpLayerLiveDbTest {

    private static void post(String path, String body) {
        given().header("X-Seer-Role", "admin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    @Test
    @Order(1)
    void vpCanvasIsAssembledFromEdges() {
        post("/lore/feature", "{\"feature_id\":\"FEAT-VP\",\"title\":\"Фича с ценностью\"}");
        post("/lore/actor", "{\"actor_id\":\"ACT-VP-AGENT\",\"name\":\"Агент\",\"kind\":\"agent\"}");
        post("/lore/pain", "{\"pain_id\":\"PAIN-VP-TOKEN\",\"title\":\"Сырые токены у агента\",\"severity\":\"high\"}");
        post("/lore/gain", "{\"gain_id\":\"GAIN-VP-LINKED\",\"title\":\"Связный граф релизов\","
            + "\"metric_md\":\"prs_linked > 0 у каждого релиза\"}");
        post("/lore/uc", "{\"uc_id\":\"UC-VP-MERGE\",\"title\":\"Merge по зелёному\",\"parent_uc_id\":\"FEAT-VP\","
            + "\"goal_level\":\"sea-level\"}");

        // Левая половина канвы: чья боль/выгода.
        post("/lore/uc/link", "{\"uc_id\":\"UC-VP-MERGE\",\"rel\":\"actor\",\"target_id\":\"ACT-VP-AGENT\"}");
        // Фича ЗАЯВЛЯЕТ: адресует боль, обещает выгоду.
        post("/lore/feature/link", "{\"feature_id\":\"FEAT-VP\",\"rel\":\"pain\",\"target_id\":\"PAIN-VP-TOKEN\"}");
        post("/lore/feature/link", "{\"feature_id\":\"FEAT-VP\",\"rel\":\"gain\",\"target_id\":\"GAIN-VP-LINKED\"}");
        // Правая половина: UC РЕАЛЬНО снимает боль и создаёт выгоду.
        post("/lore/uc/link", "{\"uc_id\":\"UC-VP-MERGE\",\"rel\":\"relieves\",\"target_id\":\"PAIN-VP-TOKEN\"}");
        post("/lore/uc/link", "{\"uc_id\":\"UC-VP-MERGE\",\"rel\":\"delivers\",\"target_id\":\"GAIN-VP-LINKED\"}");

        // Фича отдаёт свой VP-профиль (заявленное).
        given().when().get("/lore/slice/features")
        .then().statusCode(200)
            .body("rows.find { it.uc_id == 'FEAT-VP' }.pain_ids", hasItem("PAIN-VP-TOKEN"))
            .body("rows.find { it.uc_id == 'FEAT-VP' }.gain_ids", hasItem("GAIN-VP-LINKED"));

        // UC отдаёт сделанное — это и есть замыкание fit.
        given().when().get("/lore/slice/use_cases_of_feature?id=FEAT-VP")
        .then().statusCode(200)
            .body("rows[0].relieves_pain_ids", hasItem("PAIN-VP-TOKEN"))
            .body("rows[0].delivers_gain_ids", hasItem("GAIN-VP-LINKED"));
    }

    @Test
    @Order(2)
    void painIsReusableAcrossFeaturesAndKnowsWhoRelievesIt() {
        // Вторая фича адресует ТУ ЖЕ боль — ради этого боль и стала вершиной
        // (кросс-фичевая канва: «самая горячая боль» и дубль усилий видны).
        post("/lore/feature", "{\"feature_id\":\"FEAT-VP-2\",\"title\":\"Соседняя фича\",\"status\":\"proposed\"}");
        post("/lore/feature/link", "{\"feature_id\":\"FEAT-VP-2\",\"rel\":\"pain\",\"target_id\":\"PAIN-VP-TOKEN\"}");

        given().when().get("/lore/slice/pains")
        .then().statusCode(200)
            .body("rows.find { it.pain_id == 'PAIN-VP-TOKEN' }.addressed_by", equalTo(2))
            .body("rows.find { it.pain_id == 'PAIN-VP-TOKEN' }.claimed_by_ucs", hasItem("FEAT-VP-2"))
            // Заявили двое, снимает — один: расхождение видно цифрой.
            .body("rows.find { it.pain_id == 'PAIN-VP-TOKEN' }.relieved_by", equalTo(1))
            .body("rows.find { it.pain_id == 'PAIN-VP-TOKEN' }.relieved_by_ucs", hasItem("UC-VP-MERGE"));
    }

    @Test
    @Order(3)
    void gainWithoutMetricIsFlaggedNotRejected() {
        // Выгоду формулируют раньше, чем метрику — писать можно, но сервер сразу
        // говорит, что в fit она не попадёт (ADR-032 §2).
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"gain_id\":\"GAIN-VP-VAGUE\",\"title\":\"Меньше рутины\"}")
        .when().post("/lore/gain")
        .then().statusCode(200)
            .body("ok", equalTo(true))
            .body("hint", containsString("metric_md"));

        given().when().get("/lore/slice/gains")
        .then().statusCode(200)
            .body("rows.find { it.gain_id == 'GAIN-VP-VAGUE' }.metric_md", nullValue())
            .body("rows.find { it.gain_id == 'GAIN-VP-LINKED' }.delivered_by", equalTo(1));
    }

    @Test
    @Order(4)
    void cockburnScaleIsCanonAndRigorDefaultsFromGoalLevel() {
        // Канон словаря: свободных уровней нет.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"uc_id\":\"UC-VP-BAD\",\"goal_level\":\"stratosphere\"}")
        .when().post("/lore/uc")
        .then().statusCode(400).body("detail", containsString("goal_level"));

        // 🐟 subfunction → ⚡ casual (лёгкий вес по умолчанию, D1).
        post("/lore/uc", "{\"uc_id\":\"UC-VP-SUB\",\"title\":\"Подфункция\",\"parent_uc_id\":\"FEAT-VP\","
            + "\"goal_level\":\"subfunction\"}");
        // 🌊 sea-level → 📋 fully dressed; но явный rigor автора сильнее дефолта.
        post("/lore/uc", "{\"uc_id\":\"UC-VP-CASUAL\",\"title\":\"Лёгкий по решению автора\","
            + "\"parent_uc_id\":\"FEAT-VP\",\"goal_level\":\"sea-level\",\"rigor\":\"casual\"}");

        given().when().get("/lore/slice/use_cases_of_feature?id=FEAT-VP")
        .then().statusCode(200)
            .body("rows.find { it.uc_id == 'UC-VP-SUB' }.rigor", equalTo("casual"))
            .body("rows.find { it.uc_id == 'UC-VP-MERGE' }.rigor", equalTo("fully-dressed"))
            .body("rows.find { it.uc_id == 'UC-VP-CASUAL' }.rigor", equalTo("casual"))
            .body("rows.find { it.uc_id == 'UC-VP-CASUAL' }.goal_level", equalTo("sea-level"));

        // Словари-каноны засеяны миграцией V8 — их правят люди, не код.
        given().when().get("/lore/slice/dictionary?dict_type=uc_goal_level")
        .then().statusCode(200).body("rows", hasSize(4));
        given().when().get("/lore/slice/dictionary?dict_type=uc_rigor")
        .then().statusCode(200).body("rows", hasSize(2));
    }

    @Test
    @Order(5)
    void featureLivesOnTheUpperRungsOfTheSameScale() {
        // ADR-032 §1: «Фича = UC уровня облака» — значит шкала одна, но высоты
        // разные: фича на cloud/kite, сценарий на sea-level/subfunction.
        post("/lore/feature", "{\"feature_id\":\"FEAT-VP\",\"goal_level\":\"cloud\"}");
        given().when().get("/lore/slice/features")
        .then().statusCode(200)
            .body("rows.find { it.uc_id == 'FEAT-VP' }.goal_level", equalTo("cloud"));

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"feature_id\":\"FEAT-VP\",\"goal_level\":\"sea-level\"}")
        .when().post("/lore/feature")
        .then().statusCode(400).body("detail", containsString("cloud|kite"));
    }

    @Test
    @Order(6)
    void featureTargetsMilestoneAndSilentNoOpIsSurfaced() {
        // Стратегическая цель фичи (ADR-032 §1, KAOS: веха = goal).
        post("/lore/milestone", "{\"milestone_id\":\"M-VP\",\"name\":\"Автономная поставка\"}");
        post("/lore/feature/link", "{\"feature_id\":\"FEAT-VP\",\"rel\":\"milestone\",\"target_id\":\"M-VP\"}");
        given().when().get("/lore/slice/features")
        .then().statusCode(200)
            .body("rows.find { it.uc_id == 'FEAT-VP' }.milestone_id", equalTo("M-VP"));

        // Правило корпуса: CREATE EDGE в пустой TO — тихий no-op. Мост обязан
        // сказать linked:false, а не отрапортовать успех (урок prs_linked:0).
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"feature_id\":\"FEAT-VP\",\"rel\":\"pain\",\"target_id\":\"PAIN-NO-SUCH\"}")
        .when().post("/lore/feature/link")
        .then().statusCode(200)
            .body("ok", equalTo(true))
            .body("linked", equalTo(false))
            .body("hint", not(equalTo("")));
    }

    @Test
    @Order(7)
    void emptyScenarioGetsTemplateAndQualityInResponse() {
        // ADR-027 §5: пустой scenario_md → каркас ВЫБРАННОГО веса; D3: quality в ответе.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"uc_id\":\"UC-VP-TPL\",\"title\":\"Свежий UC\",\"parent_uc_id\":\"FEAT-VP\",\"goal_level\":\"sea-level\"}")
        .when().post("/lore/uc")
        .then().statusCode(200)
            .body("template_inserted", equalTo("fully-dressed"))
            .body("quality.rigor", equalTo("fully-dressed"))
            // Триггер из шаблона есть, primary-актора и приёмки ещё нет — недобор честный.
            .body("quality.max", greaterThan(0))
            .body("quality.findings.find { it.code == 'trigger' }.ok", equalTo(true))
            .body("quality.findings.find { it.code == 'primary_actor' }.ok", equalTo(false));
    }

    @Test
    @Order(8)
    void firstActorIsPrimaryThenQualityPasses() {
        // D19: первый актор — primary по умолчанию; линтер видит рёбра, не текст.
        post("/lore/actor", "{\"actor_id\":\"ACT-VP-2\",\"name\":\"Второй\",\"kind\":\"system\"}");
        post("/lore/uc/link", "{\"uc_id\":\"UC-VP-TPL\",\"rel\":\"actor\",\"target_id\":\"ACT-VP-AGENT\"}");
        post("/lore/uc/link", "{\"uc_id\":\"UC-VP-TPL\",\"rel\":\"actor\",\"target_id\":\"ACT-VP-2\"}");

        // uc/quality — режим (б): re-lint без записи.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"uc_id\":\"UC-VP-TPL\"}")
        .when().post("/lore/uc/quality")
        .then().statusCode(200)
            .body("findings.find { it.code == 'primary_actor' }.ok", equalTo(true));

        // Ровно один primary (первый), второй — supporting.
        given().when().get("/lore/slice/use_cases_of_feature?id=FEAT-VP")
        .then().statusCode(200)
            .body("rows.find { it.uc_id == 'UC-VP-TPL' }.actor_ids", hasItem("ACT-VP-AGENT"))
            .body("rows.find { it.uc_id == 'UC-VP-TPL' }.actor_ids", hasItem("ACT-VP-2"));
    }

    @Test
    @Order(9)
    void jobIsTheThirdPillarAndClosesTheThirdFitAxis() {
        // Остервальдер (V10): работа — третий столп профиля. Боль МЕШАЕТ ей (BLOCKS),
        // выгода = УСПЕХ в ней (SUCCESS_OF), фича ЗАЯВЛЯЕТ помощь (HELPS_WITH),
        // UC её ВЫПОЛНЯЕТ (PERFORMS). Глобальная вершина — контекст на рёбрах.
        post("/lore/job", "{\"job_id\":\"JOB-RELEASE\",\"title\":\"Выпустить релиз, не покидая сессии\","
            + "\"kind\":\"functional\",\"importance\":\"high\"}");
        // Чья это работа (сегмент профиля).
        post("/lore/vp/link", "{\"source_id\":\"JOB-RELEASE\",\"rel\":\"performed_by\",\"target_id\":\"ACT-VP-AGENT\"}");
        // Боль мешает работе, выгода — успех в работе (замыкают три списка в канву).
        post("/lore/vp/link", "{\"source_id\":\"PAIN-VP-TOKEN\",\"rel\":\"blocks\",\"target_id\":\"JOB-RELEASE\"}");
        post("/lore/vp/link", "{\"source_id\":\"GAIN-VP-LINKED\",\"rel\":\"success_of\",\"target_id\":\"JOB-RELEASE\"}");
        // Фича ЗАЯВЛЯЕТ помощь, UC РЕАЛЬНО выполняет — третья ось fit.
        post("/lore/feature/link", "{\"feature_id\":\"FEAT-VP\",\"rel\":\"job\",\"target_id\":\"JOB-RELEASE\"}");
        post("/lore/uc/link", "{\"uc_id\":\"UC-VP-MERGE\",\"rel\":\"performs\",\"target_id\":\"JOB-RELEASE\"}");

        // Слайс jobs собирает профиль работы из рёбер.
        given().when().get("/lore/slice/jobs")
        .then().statusCode(200)
            .body("rows.find { it.job_id == 'JOB-RELEASE' }.actor_ids", hasItem("ACT-VP-AGENT"))
            .body("rows.find { it.job_id == 'JOB-RELEASE' }.blocking_pain_ids", hasItem("PAIN-VP-TOKEN"))
            .body("rows.find { it.job_id == 'JOB-RELEASE' }.gain_ids", hasItem("GAIN-VP-LINKED"))
            // ЗАЯВЛЕНО фичей, ВЫПОЛНЕНО одним UC — третья ось замкнута цифрой.
            .body("rows.find { it.job_id == 'JOB-RELEASE' }.performed_by", equalTo(1))
            .body("rows.find { it.job_id == 'JOB-RELEASE' }.performed_by_ucs", hasItem("UC-VP-MERGE"));

        // Обратные рёбра видны со сторон боли и фичи (симметрия ADDRESSES/HELPS_WITH).
        given().when().get("/lore/slice/pains")
        .then().statusCode(200)
            .body("rows.find { it.pain_id == 'PAIN-VP-TOKEN' }.blocks_job_ids", hasItem("JOB-RELEASE"));
        given().when().get("/lore/slice/features")
        .then().statusCode(200)
            .body("rows.find { it.uc_id == 'FEAT-VP' }.job_ids", hasItem("JOB-RELEASE"));
    }

    @Test
    @Order(10)
    void gainRankIsCanonAndInvalidIsRejected() {
        // Ранг выгоды (Остервальдер) — канон словаря gain_rank; upsert хранит его,
        // невалидный ранг отклоняется 400 (как goal_level/work_class).
        post("/lore/gain", "{\"gain_id\":\"GAIN-VP-LINKED\",\"rank\":\"essential\"}");
        given().when().get("/lore/slice/gains")
        .then().statusCode(200)
            .body("rows.find { it.gain_id == 'GAIN-VP-LINKED' }.rank", equalTo("essential"))
            .body("rows.find { it.gain_id == 'GAIN-VP-LINKED' }.success_of_job_ids", hasItem("JOB-RELEASE"));

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"gain_id\":\"GAIN-VP-LINKED\",\"rank\":\"nonsense\"}")
        .when().post("/lore/gain").then().statusCode(400);
    }
}
