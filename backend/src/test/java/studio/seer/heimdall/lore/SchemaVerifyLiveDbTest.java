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

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Накатка схемы на живой базе: идемпотентность и то, что сверка действительно
 * СМОТРИТ В СХЕМУ (DBU-02).
 *
 * <p>Разбор шагов проверен без базы ({@code SchemaVerifyCoversStepsTest}), и
 * этого мало: он доказывает, что список полон, но ничего не говорит о том,
 * спрашивают ли по этому списку настоящую схему.
 *
 * <p>Здесь проверяются две вещи, которые на чистых функциях недоказуемы.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class SchemaVerifyLiveDbTest {

    @Inject
    LoreSchemaMigrationRunner runner;

    @Inject
    LoreIngestService ingest;

    /**
     * Повторная накатка ничего не меняет и не падает.
     *
     * <p>Это не абстрактная аккуратность. Ровно это обещает сообщение об отказе
     * старта: «накатите схему заново, шаги идемпотентны». Обещание, которое
     * никто не проверял, — такой же долг, как непроверенная починка: человек
     * последует совету и получит вторую поломку поверх первой.
     *
     * <p>Второй прогон на уже накатанной базе обязан пройти по короткому пути:
     * непринятых шагов нет, значит DDL не выполняется вовсе.
     */
    @Test
    @Order(1)
    void secondRunOnAnAlreadyMigratedSchemaChangesNothing() {
        List<Map<String, Object>> before = ingest.queryPublic(
            "SELECT count(*) AS n FROM schema:types", Map.of());
        long typesBefore = num(before);
        long ledgerBefore = num(ingest.queryPublic(
            "SELECT count(*) AS n FROM LoreSchemaVersion", Map.of()));

        assertDoesNotThrow(runner::run, "повторная накатка упала — обещание «шаги идемпотентны» ложно");

        assertTrue(num(ingest.queryPublic("SELECT count(*) AS n FROM schema:types", Map.of())) == typesBefore,
            "после повторной накатки изменилось число типов — шаг не идемпотентен");
        assertTrue(num(ingest.queryPublic("SELECT count(*) AS n FROM LoreSchemaVersion", Map.of())) == ledgerBefore,
            "повторная накатка дописала строки в реестр версий — история перестала быть историей");
    }

    /**
     * Сверка спрашивает НАСТОЯЩУЮ схему, а не саму себя.
     *
     * <p>Без этой проверки возможен худший исход: список типов полон, сверка
     * зелёная — и зелёная потому, что запрос к схеме всегда отвечает «есть».
     * Тогда «схема сверена» означало бы «мы посмотрели в зеркало».
     *
     * <p>Поэтому спрашиваем про заведомо несуществующий тип: ответ обязан
     * отличаться от ответа про существующий.
     */
    @Test
    @Order(2)
    void theSchemaProbeDistinguishesExistingFromMissing() {
        assertTrue(typeExists("KnowUseCase"),
            "проба не видит заведомо существующий тип — сверка ничего не проверяет");
        assertFalse(typeExists("KnowЗаведомоНетТакогоТипа42"),
            "проба отвечает «есть» на несуществующий тип — сверка была бы зелёной всегда");
    }

    /**
     * И то, ради чего всё: список требуемых типов ПОЛНОСТЬЮ материализован на
     * живой базе.
     *
     * <p>Совпадение списка с шагами доказано без базы. Здесь доказывается
     * вторая половина: шаги, объявившие эти типы, действительно их создали, а
     * не отчитались об этом.
     */
    @Test
    @Order(3)
    void everyRequiredTypeIsMateriallyPresent() {
        List<String> missing = LoreSchemaMigrations.requiredLiveTypes().stream()
            .filter(t -> !typeExists(t))
            .toList();
        assertTrue(missing.isEmpty(),
            "ledger заявляет актуальную схему, но этих типов в базе НЕТ: " + missing
            + " — ровно тот разрыв, ради которого сверка и написана");
    }

    private boolean typeExists(String name) {
        return !ingest.queryPublic("SELECT name FROM schema:types WHERE name = :n",
            Map.of("n", name)).isEmpty();
    }

    private static long num(List<Map<String, Object>> rows) {
        if (rows.isEmpty()) return -1;
        Object n = rows.get(0).get("n");
        return n instanceof Number x ? x.longValue() : -1;
    }
}
