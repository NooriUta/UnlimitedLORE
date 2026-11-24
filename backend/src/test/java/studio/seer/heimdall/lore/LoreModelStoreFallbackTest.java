package studio.seer.heimdall.lore;

import io.smallrye.mutiny.Uni;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-08 — fallback «работаю по файлу» громкий.
 * Повод (факт 24.11.2026): прод отвечал «модель из LORE не прочитана», а сигнала
 * нигде не было, кроме одной строки лога. Здесь, без живой базы (подмена швов
 * зависимостей), то, что обязан сделать стор при отказе чтения:
 * <ul>
 *   <li>{@code source() = "file"} и {@code warning()} — текстом (было до задачи);</li>
 *   <li>точка в ряд {@code MetricSnapshot} — сигнал виден метриками, а не только
 *       логом (KREG-08).</li>
 * </ul>
 *
 * <p>Зависимости подменяются JDK-прокси, а не классами-реализациями: реализация
 * {@link LoreCommandClient} наследует его JAX-RS-аннотации и Quarkus индексирует её
 * как ресурс — дубликат эндпоинта роняет все QuarkusTest одного прогона.
 */
class LoreModelStoreFallbackTest {

    /** Клиент, записывающий команды в список; вызов command() возвращает готовый Uni. */
    @SuppressWarnings("unchecked")
    static LoreCommandClient capturingClient(List<LoreCommandClient.LoreCommand> sink, RuntimeException onCommand) {
        return (LoreCommandClient) Proxy.newProxyInstance(
            LoreModelStoreFallbackTest.class.getClassLoader(), new Class<?>[] {LoreCommandClient.class},
            (proxy, method, args) -> {
                if ("command".equals(method.getName())) {
                    if (onCommand != null) throw onCommand;
                    sink.add((LoreCommandClient.LoreCommand) args[2]);
                    return Uni.createFrom().item(new LoreCommandClient.LoreCommandResult(Map.of()));
                }
                throw new UnsupportedOperationException(method.getName());
            });
    }

    /** Чтение открытой версии падает — как на проде; запись — через захватывающий клиент. */
    static LoreModelStore storeWithFailingRead(LoreCommandClient client) {
        LoreModelStore store = new LoreModelStore();
        store.enabled = true;
        store.db = "kreg08_test";
        store.bootstrapFirst = new LoreSchemaInitializer();
        store.migrationsFirst = new LoreSchemaMigrationRunner();
        store.mart = new MartCredentials() {
            @Override public String basicAuth() { return "Basic dGVzdA=="; }
        };
        store.ingest = new LoreIngestService() {
            @Override public List<Map<String, Object>> queryPublic(String sql, Map<String, Object> params) {
                throw new IllegalStateException("база недоступна (подмена теста)");
            }
        };
        store.client = client;
        return store;
    }

    @Test
    void failedReadFallsBackToFileWithWarning() {
        LoreModelStore store = storeWithFailingRead(capturingClient(new ArrayList<>(), null));
        store.load();
        assertEquals("file", store.source(), "источник — файл репозитория (флаг потребителю)");
        assertNotNull(store.warning(), "причина отказа — текстом, а не молча");
        assertTrue(store.warning().contains("не прочитана"), store.warning());
        assertTrue(store.warning().contains("база недоступна"), "причина — с сообщением нижележащей ошибки: " + store.warning());
    }

    @Test
    void fallbackWritesAPointToMetricSnapshot() {
        List<LoreCommandClient.LoreCommand> commands = new ArrayList<>();
        LoreModelStore store = storeWithFailingRead(capturingClient(commands, null));
        store.load();
        LoreCommandClient.LoreCommand point = commands.stream()
            .filter(c -> c.command() != null && c.command().contains("INSERT INTO MetricSnapshot"))
            .findFirst().orElse(null);
        assertNotNull(point, "fallback — громкий: точка в MetricSnapshot обязана быть, а не только строка в логе");
        assertEquals("sql", point.language(), "одна команда, не скрипт: как у соседних писателей ряда");
        assertEquals("lore.model.source", point.params().get("m"), "имя метрики — по образцу соседних (lore.*)");
        assertEquals("lore-model", point.params().get("oid"));
        assertEquals(0.0, point.params().get("v"), "0 — источник файл, 1 — LORE; точка пишется при отказе");
        assertNotNull(point.params().get("ts"), "момент точки — epoch millis");
        assertEquals(IllegalStateException.class.getSimpleName(), point.params().get("seg"), "класс отказа — тегом segment");
    }

    @Test
    void failedMetricWriteDoesNotMaskTheFallback() {
        LoreCommandClient failing = capturingClient(new ArrayList<>(),
            new IllegalStateException("ряд метрик тоже недоступен"));
        LoreModelStore store = storeWithFailingRead(failing);
        assertDoesNotThrow(store::load, "сбой сигнальной точки не роняет старт — fallback всё равно работает по файлу");
        assertEquals("file", store.source());
        assertNotNull(store.warning());
    }
}
