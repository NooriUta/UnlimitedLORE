package studio.seer.heimdall.lore;

import io.smallrye.mutiny.Uni;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_PRODUCT_BACKLOG/SELF-PROVISION-STANDALONE · D-2026-LORE-AUTO-BOOTSTRAP-CORE.
 *
 * <p>{@link AutoBootstrapEmptyDbTest} проверяет чистую функцию решения. Здесь —
 * весь путь {@code init()} с подставным клиентом ArcadeDB: какие команды реально
 * уходят в базу. Без живой БД.
 *
 * <ul>
 *   <li>База с ядром (общий стенд, прод) — в базу уходит ровно одна команда,
 *       проба чтения схемы, и ни одного DDL.</li>
 *   <li>Прод без базовых типов V/E (инцидент 13.11 «Supertype 'V' not found»)
 *       — тоже ни одного DDL: отсутствие V/E не делает базу «пустой».</li>
 *   <li>Пустая база — ядро поднимается без флага.</li>
 *   <li>Свежесозданная база первые мгновения отвечает ошибкой: проба
 *       повторяется, а не сдаётся с первого раза (иначе установка с нуля
 *       через инсталлятор зависела бы от гонки «база создана → бэкенд стартовал»).</li>
 * </ul>
 */
class LoreSchemaInitializerDdlTest {

    private static final String PROBE = "SELECT name FROM schema:types";

    /** Подставной клиент: пишет все команды, отвечает по правилу. */
    // @Vetoed: иначе Quarkus берёт подставной клиент бином (реализация LoreCommandClient) и роняет
    // сборку контейнера всех Quarkus-тестов — неразрешённый параметр конструктора (CI #1371).
    @jakarta.enterprise.inject.Vetoed
    static final class FakeClient implements LoreCommandClient {
        final List<String> sent = new ArrayList<>();
        final Function<String, Uni<LoreCommandResult>> answer;
        FakeClient(Function<String, Uni<LoreCommandResult>> answer) { this.answer = answer; }
        @Override
        public Uni<LoreCommandResult> command(String db, String authorization, LoreCommand body) {
            sent.add(body.command());
            return answer.apply(body.command());
        }
        List<String> ddl() {
            return sent.stream().filter(s -> !s.equals(PROBE)).toList();
        }
    }

    static Uni<LoreCommandClient.LoreCommandResult> ok(Object result) {
        return Uni.createFrom().item(new LoreCommandClient.LoreCommandResult(result));
    }

    static Uni<LoreCommandClient.LoreCommandResult> fail() {
        return Uni.createFrom().failure(new RuntimeException("HTTP 500 (свежая база)"));
    }

    static Function<String, Uni<LoreCommandClient.LoreCommandResult>> types(String... names) {
        List<Map<String, Object>> rows = java.util.Arrays.stream(names)
            .map(n -> Map.<String, Object>of("name", n)).toList();
        return sql -> sql.equals(PROBE) ? ok(rows) : ok(null);
    }

    static LoreSchemaInitializer initializer(FakeClient client, boolean flag) {
        LoreSchemaInitializer i = new LoreSchemaInitializer();
        i.enabled = true;
        i.bootstrap = flag;
        i.db = "lore_unit";
        i.client = client;
        i.mart = new MartCredentials() {
            @Override public String basicAuth() { return "Basic dGVzdDp0ZXN0"; }
        };
        i.probeDelayMs = 0;
        return i;
    }

    @Test
    void sharedStandWithCoreGetsZeroDdl() {
        FakeClient c = new FakeClient(types("V", "E", "KnowTask", "KnowSprint", "KnowADR", "LoreSchemaVersion"));
        LoreSchemaInitializer i = initializer(c, false);
        i.init();
        assertEquals(List.of(PROBE), c.sent, "на базе с ядром — только проба чтения схемы");
        assertFalse(i.bootstrapped());
    }

    @Test
    void prodWithoutBaseTypesGetsZeroDdl() {
        // Прод: bootstrap выключен с рождения, базовых типов V/E нет вовсе.
        FakeClient c = new FakeClient(types("KnowTask", "KnowSprint", "KnowADR", "LoreSchemaVersion"));
        LoreSchemaInitializer i = initializer(c, false);
        i.init();
        assertEquals(List.of(), c.ddl(), "отсутствие V/E не повод гнать DDL по проду");
        assertFalse(i.bootstrapped());
    }

    @Test
    void partialCoreIsNotEmptyAndGetsZeroDdl() {
        FakeClient c = new FakeClient(types("KnowADR"));
        LoreSchemaInitializer i = initializer(c, false);
        i.init();
        assertEquals(List.of(), c.ddl(), "хоть один ядровой тип — база не пустая, DDL не гоняем");
    }

    @Test
    void emptyDatabaseRaisesCoreWithoutFlag() {
        FakeClient c = new FakeClient(types());
        LoreSchemaInitializer i = initializer(c, false);
        i.init();
        assertTrue(i.bootstrapped());
        assertTrue(c.ddl().contains("CREATE VERTEX TYPE V IF NOT EXISTS"));
        assertTrue(c.ddl().stream().anyMatch(s -> s.startsWith("CREATE VERTEX TYPE KnowTask ")));
        assertTrue(c.ddl().stream().anyMatch(s -> s.startsWith("CREATE VERTEX TYPE KnowSprint ")));
        assertTrue(c.ddl().stream().anyMatch(s -> s.startsWith("CREATE VERTEX TYPE KnowADR ")));
    }

    @Test
    void freshDatabaseProbeIsRetriedNotGivenUpOnFirstError() {
        AtomicInteger probes = new AtomicInteger();
        FakeClient c = new FakeClient(sql -> {
            if (!sql.equals(PROBE)) return ok(null);
            return probes.incrementAndGet() <= 2 ? fail() : ok(List.of());
        });
        LoreSchemaInitializer i = initializer(c, false);
        i.init();
        assertEquals(3, probes.get(), "две ошибки свежей базы, третья проба — пустой список типов");
        assertTrue(i.bootstrapped(), "пустая база, ответившая не с первого раза, всё равно пустая");
    }

    @Test
    void unreachableDatabaseGetsZeroDdlAfterBoundedRetries() {
        AtomicInteger probes = new AtomicInteger();
        FakeClient c = new FakeClient(sql -> { probes.incrementAndGet(); return fail(); });
        LoreSchemaInitializer i = initializer(c, false);
        i.init();
        assertEquals(i.probeAttempts, probes.get(), "попыток ровно столько, сколько задано — не бесконечно");
        assertEquals(List.of(), c.ddl(), "«не смогли проверить» ≠ «пусто»: DDL наудачу не гоняем");
        assertFalse(i.bootstrapped());
    }

    @Test
    void explicitFlagSkipsProbeAndRaisesCore() {
        FakeClient c = new FakeClient(types("KnowTask"));
        LoreSchemaInitializer i = initializer(c, true);
        i.init();
        assertFalse(c.sent.contains(PROBE), "флаг — явное принуждение, проба не нужна");
        assertTrue(i.bootstrapped());
        assertTrue(c.ddl().stream().anyMatch(s -> s.startsWith("CREATE VERTEX TYPE KnowTask ")));
    }
}
