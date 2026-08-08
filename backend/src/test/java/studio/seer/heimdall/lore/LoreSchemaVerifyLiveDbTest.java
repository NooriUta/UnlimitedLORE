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

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * DBR-06: сверка версии схемы работает ОТДЕЛЬНО от накатки.
 *
 * <p><b>Зачем.</b> Рантайм должен ходить в ArcadeDB токеном без
 * {@code updateSchema} — для этого накатку отключают ({@code lore.migrate=false}).
 * Но до этой правки под тем же флагом лежали и гарды: выключив накатку, мы
 * заодно выключали проверку совместимости, и приложение молча стартовало на
 * любой схеме. Это хуже отказа — сервис на чужой схеме пишет данные не туда, и
 * обнаруживается это не при старте, а по кривым выдачам через неделю.
 *
 * <p>Проверяется вызовом {@code verifySchemaOrFail()} напрямую, а не поднятием
 * второго профиля: гейт — это поведение метода, и тест на него не должен
 * зависеть от того, чья настройка выиграет у Quarkus при склейке источников
 * конфигурации.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreSchemaVerifyLiveDbTest {

    @Inject
    LoreSchemaMigrationRunner runner;

    @Inject
    LoreIngestService ingest;

    @Inject
    @org.eclipse.microprofile.rest.client.inject.RestClient
    LoreCommandClient writeClient;

    @org.eclipse.microprofile.config.inject.ConfigProperty(name = "lore.db")
    String db;

    @Inject
    MartCredentials mart;

    private void exec(String sql, Map<String, Object> params) {
        writeClient.command(db, mart.basicAuth(),
            new LoreCommandClient.LoreCommand("sql", sql, params)).await().indefinitely();
    }

    @Test
    @Order(1)
    void currentSchemaPasses() {
        // Тестовый резолвер накатывает схему на каждом старте, значит здесь
        // ledger полон и сверка обязана молчать.
        assertDoesNotThrow(runner::verifySchemaOrFail,
            "на актуальной схеме сверка не должна ничего находить");
    }

    @Test
    @Order(2)
    void missingStepStopsStartup() {
        int latest = LoreSchemaMigrations.codeVersion();
        var before = ingest.queryPublic(
            "SELECT version, name, checksum, applied_at, compat_major FROM LoreSchemaVersion WHERE version = :v",
            Map.of("v", latest));
        assertTrue(before.size() == 1, "фикстура: последний шаг обязан быть в ledger");

        // Изымаем строку последнего шага — это ровно то состояние, в котором
        // приложение раньше стартовало молча: схема отстала, накатывать некому.
        exec("DELETE FROM LoreSchemaVersion WHERE version = :v", Map.of("v", latest));
        try {
            var e = assertThrows(IllegalStateException.class, runner::verifySchemaOrFail,
                "неприменённый шаг обязан валить старт, а не проходить молча");
            assertTrue(e.getMessage().contains("не накатаны шаги"),
                "сообщение должно называть недостающие шаги, иначе оно бесполезно: " + e.getMessage());
            assertTrue(e.getMessage().contains(String.valueOf(latest)),
                "в сообщении обязан быть номер недостающего шага: " + e.getMessage());
        } finally {
            // Возвращаем строку: следующие тесты в этом же классе и соседние
            // классы делят одну БД, и оставленный за собой рассинхрон ловился
            // бы уже не здесь.
            var r = before.get(0);
            exec("INSERT INTO LoreSchemaVersion SET version = :v, name = :n, checksum = :c, "
                + "applied_at = :a, compat_major = :m",
                Map.of("v", r.get("version"), "n", String.valueOf(r.get("name")),
                       "c", String.valueOf(r.get("checksum")), "a", String.valueOf(r.get("applied_at")),
                       "m", r.get("compat_major") == null ? latest : r.get("compat_major")));
        }
    }

    @Test
    @Order(3)
    void restoredSchemaPassesAgain() {
        // Страховка от самого теста: если восстановление в finally не отработало,
        // молча пострадали бы соседи, а не этот класс.
        assertDoesNotThrow(runner::verifySchemaOrFail,
            "ledger должен быть восстановлен предыдущим тестом");
    }

    @Test
    @Order(4)
    void checksumDriftStopsStartup() {
        int latest = LoreSchemaMigrations.codeVersion();
        var before = ingest.queryPublic(
            "SELECT checksum FROM LoreSchemaVersion WHERE version = :v", Map.of("v", latest));
        String original = String.valueOf(before.get(0).get("checksum"));

        exec("UPDATE LoreSchemaVersion SET checksum = 'drifted' WHERE version = :v", Map.of("v", latest));
        try {
            var e = assertThrows(IllegalStateException.class, runner::verifySchemaOrFail,
                "дрейф checksum выпущенного шага обязан валить старт");
            assertTrue(e.getMessage().contains("изменён после применения"),
                "сообщение должно объяснять суть дрейфа: " + e.getMessage());
        } finally {
            exec("UPDATE LoreSchemaVersion SET checksum = :c WHERE version = :v",
                Map.of("c", original, "v", latest));
        }
    }
}
