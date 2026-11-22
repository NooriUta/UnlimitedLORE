package studio.seer.heimdall.lore;

import io.quarkus.runtime.Startup;
import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Имена людей из Keycloak подтягиваются САМИ, фоном на сервере — владелица 22.11.2026:
 * «сервер должен обновлять сам фоново с kc данные, а не по кнопке».
 *
 * <p>До этой правки сверка запускалась только фронтом при открытии админки → «Люди»
 * (раз в сутки) или кнопкой. Пока в раздел никто не заходил админом, у всех девяти
 * человек на проде стояло {@code display_name = login}, {@code name_source = null} —
 * то есть сверка не отрабатывала ни разу.
 *
 * <p>Кнопка остаётся: фон раз в час, кнопка — «прямо сейчас».
 */
class LoreKcNamesPollerTest {

    /** Заглушка моста: считает заходы и говорит, настроен ли KC. */
    static class StubNames extends LoreKcResource {
        boolean configured;
        RuntimeException boom;
        final AtomicInteger calls = new AtomicInteger();
        Map<String, Object> summary = new LinkedHashMap<>();

        StubNames(boolean configured) { this.configured = configured; }

        @Override
        boolean namesSyncConfigured() { return configured; }

        @Override
        Map<String, Object> runNamesSync(boolean dryRun) {
            calls.incrementAndGet();
            if (boom != null) throw boom;
            return summary;
        }
    }

    static LoreKcNamesPoller poller(StubNames names) {
        LoreKcNamesPoller p = new LoreKcNamesPoller();
        p.names = names;
        p.loreEnabled = true;
        p.pollMinutes = 60;
        return p;
    }

    @Test
    void бинНеЛенивыйИначеРасписаниеНеЗапуститсяНиРазу() {
        // Ловушка AO-08 (та же, что год молчала у логинов KC): @ApplicationScoped без @Startup
        // не создаётся, пока его никто не внедрил, и @PostConstruct не исполняется.
        assertNotNull(LoreKcNamesPoller.class.getAnnotation(ApplicationScoped.class),
            "опросчик обязан быть бином");
        assertNotNull(LoreKcNamesPoller.class.getAnnotation(Startup.class),
            "без @Startup бин ленив — фоновая сверка имён не запустится ни разу");
    }

    @Test
    void интервалИзНастройкиПоУмолчаниюЧас() throws Exception {
        Field f = LoreKcNamesPoller.class.getDeclaredField("pollMinutes");
        ConfigProperty cp = f.getAnnotation(ConfigProperty.class);
        assertNotNull(cp, "интервал должен задаваться настройкой, а не быть вшит в код");
        assertEquals("lore.kc.names-poll-minutes", cp.name());
        assertEquals("60", cp.defaultValue(), "по умолчанию — раз в час");
    }

    @Test
    void фоновыйЗаходСверяетИмена() {
        StubNames names = new StubNames(true);
        poller(names).tick();
        assertEquals(1, names.calls.get(), "настроенный KC — сверка идёт сама, без кнопки и без админки");
    }

    @Test
    void мостНеНастроенСверкаНеЗовётсяИНеПадает() {
        StubNames names = new StubNames(false);
        assertDoesNotThrow(() -> poller(names).tick());
        assertEquals(0, names.calls.get(), "без моста к KC ходить некуда — зовём ноль раз, а не ловим исключение");
    }

    @Test
    void падениеСверкиНеРоняетОпросчик() {
        StubNames names = new StubNames(true);
        names.boom = new RuntimeException("KC ответил 403");
        assertDoesNotThrow(() -> poller(names).tick(),
            "недоступный Keycloak не имеет права ронять LORE: потеряли имена, а не работу пользователя");
        assertEquals(1, names.calls.get());
    }

    @Test
    void выключенныйLoreНеЗапускаетРасписание() {
        StubNames names = new StubNames(true);
        LoreKcNamesPoller p = poller(names);
        p.loreEnabled = false;
        p.start();
        assertFalse(p.running(), "LORE выключен — фонового опроса нет");
    }
}
