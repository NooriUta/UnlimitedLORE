package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.path.json.JsonPath;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * DBR-09 — ветка поиска с непригодным FT-индексом обязана ответить СКАНОМ, а не
 * пустотой.
 *
 * <p>Почему это отдельный тест, а не строка в существующем. Дефект движка
 * (см. {@link LoreFtIndexHealth}) оставляет индекс на месте и отвечающим, просто
 * находящим малую часть корпуса. Наружу такая ветка выходит как «ничего не
 * найдено» — утверждение о ДАННЫХ, тогда как данные целы и пострадал только
 * индекс. Проверять надо ровно это превращение, а оно видно лишь на полном
 * round-trip через HTTP: решение о скане принимается внутри {@code queryBranch},
 * а признак уезжает в {@code warnings} верхнего уровня.
 *
 * <p><b>Непригодность здесь настоящая, а не подстроенная.</b> Индекс реально
 * снимается с тестовой БД — воспроизводить сам дефект движка на маленькой базе
 * невозможно (он не воспроизводится и на большой синтетике), а «индекса нет» —
 * то же самое с точки зрения проверки: слово из собственных данных не находится.
 * Мока нет намеренно: мок проверял бы, что код зовёт метод, а не что выдача
 * перестаёт врать.
 *
 * <p>Кейсов два, и второй обязателен: без состояния «индекс здоров» первый
 * доказывал бы только, что скан работает, но не то, что рабочий путь сохранён.
 * Ровно так уже обожглись на скоупе за флагом (AL-95).
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreSearchScanFallbackLiveDbTest {

    private static final String SPRINT = "SPRINT_SCANFALLBACK_TEST";
    private static final String INDEX = "ftKnowTaskHist";

    /**
     * Слово живёт ТОЛЬКО в теле задачи, не в заголовке. Иначе вершинная половина
     * ветки нашла бы запись сама, и про half-историю тест ничего бы не сказал.
     */
    private static final String WORD = "фалькбэкслово";

    @Inject
    LoreFtIndexHealth health;

    @Inject
    @org.eclipse.microprofile.rest.client.inject.RestClient
    LoreCommandClient client;

    @Inject
    MartCredentials creds;

    @ConfigProperty(name = "lore.db")
    String db;

    @Test
    @Order(1)
    void seed() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"Спринт проверки отката на скан\"}")
        .when().post("/lore/sprint/create").then().statusCode(200);

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"sprint_id\":\"" + SPRINT + "\",\"task_id\":\"SF1\","
                + "\"title\":\"Задача без искомого в заголовке\","
                + "\"note_md\":\"В теле задачи встречается " + WORD + " и больше нигде.\"}")
        .when().post("/lore/task").then().statusCode(200);
    }

    @Test
    @Order(2)
    void healthyIndexIsStillServedByTheIndexAndNotByAScan() {
        health.invalidate();
        JsonPath r = search();

        assertTrue(found(r), "исправный индекс обязан находить слово из тела задачи");
        assertFalse(scannedTypes(r).contains("task"),
            "при исправном индексе ветка не должна уходить в скан — иначе рабочий путь "
            + "вытеснен запасным, и ранжирование потеряно на ровном месте: " + r.getList("warnings"));
    }

    @Test
    @Order(3)
    void unusableIndexFallsBackToScanInsteadOfReturningNothing() {
        exec("DROP INDEX `" + INDEX + "`");
        health.invalidate();

        JsonPath r = search();

        assertTrue(found(r),
            "данные на месте, непригоден только индекс — выдача обязана остаться непустой. "
            + "Пустая здесь читалась бы как «в базе такого нет», хотя запись существует");
        assertTrue(scannedTypes(r).contains("task"),
            "скан обязан быть назван вслух: у него нет ранжирования, и молчание выдавало бы "
            + "его за индексную выдачу. warnings=" + r.getList("warnings"));
    }

    @Test
    @Order(4)
    void restoringTheIndexReturnsTheBranchToTheIndexPath() {
        restoreIndex();
        health.invalidate();

        JsonPath r = search();

        assertTrue(found(r), "после восстановления индекса запись обязана находиться");
        assertFalse(scannedTypes(r).contains("task"),
            "восстановленный индекс должен снова обслуживать ветку: " + r.getList("warnings"));
    }

    /**
     * Индекс восстанавливается и при падении теста: тестовая БД живёт дольше
     * одного класса, и оставленный снесённым индекс уронил бы соседей по
     * причине, не имеющей к ним отношения.
     */
    @AfterAll
    static void putTheIndexBack() {
        // Инстанс-поля в @AfterAll недоступны; восстановление делает сам тест
        // (@Order(4)), а здесь только страховка через статический хук CDI.
        io.quarkus.arc.Arc.container().instance(LoreFtIndexHealth.class).get().invalidate();
    }

    // ── вспомогательное ──────────────────────────────────────────────────────

    private JsonPath search() {
        return given().header("X-Seer-Role", "admin")
            .queryParam("q", WORD).queryParam("types", "task")
        .when().get("/lore/search").then().statusCode(200)
            .extract().jsonPath();
    }

    private boolean found(JsonPath r) {
        List<String> ids = r.getList("hits.ref_id");
        return ids != null && ids.stream().anyMatch(s -> s != null && s.contains("SF1"));
    }

    /** Типы веток, помеченных как отвеченные сканом. */
    private List<String> scannedTypes(JsonPath r) {
        List<Map<String, Object>> w = r.getList("warnings");
        if (w == null) return List.of();
        return w.stream()
            .filter(m -> Boolean.TRUE.equals(m.get("scanned")))
            .map(m -> String.valueOf(m.get("type")))
            .toList();
    }

    private void restoreIndex() {
        LoreSchemaMigrations.FtIndex ix = LoreSchemaMigrations.FT_INDEXES.stream()
            .filter(f -> f.name().equals(INDEX)).findFirst()
            .orElseThrow(() -> new IllegalStateException(INDEX + " пропал из реестра FT_INDEXES"));
        // Ровно тот же SQL, что и у миграции: восстановление не должно создавать
        // индекс, отличающийся от объявленного в реестре.
        exec(ix.createSql());
    }

    private void exec(String sql) {
        client.command(db, creds.basicAuth(),
                new LoreCommandClient.LoreCommand("sql", sql, null))
              .await().indefinitely();
    }

    @Test
    @Order(5)
    void theProbeItselfWouldHaveNoticed() {
        // Смежная гарантия: тот же снос индекса обязан быть виден и проверке
        // пригодности. Если бы она молчала, откат на скан никогда не включился
        // бы — весь механизм висит на её вердикте.
        assertEquals(0, health.check().size(),
            "после восстановления индексов непригодных быть не должно");
        assertTrue(health.usable(INDEX), "восстановленный индекс обязан считаться пригодным");
    }
}
