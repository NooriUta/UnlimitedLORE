package studio.seer.heimdall.lore;

import io.quarkus.runtime.ShutdownEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import org.jboss.logging.Logger;

import java.net.http.HttpClient;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Supplier;

/**
 * SPRINT_LORE_PIPELINE_HOST/PL-14 — единственное место, где код создаёт JDK
 * {@link HttpClient}: общий клиент, который закрывается при остановке приложения
 * и пересоздаётся при следующем обращении.
 *
 * <p><b>Корень (JFR, полный набор тестов 13.11.2026).</b> Статические клиенты мостов
 * (SecretProvider, KcBridge, ForgejoBridge) и общий клиент тестов создавались при
 * каждом старте Quarkus — 115 раз за прогон. У каждого клиента свой поток
 * {@code HttpClient-N-SelectorManager}: за прогон запущено 465, завершилось 2 —
 * при 90 полных сборках мусора. Клиенты прежних стартов не освобождались, и с
 * тестовой кучей 512 МБ это кончалось OutOfMemoryError в CI. Просто закрыть
 * статический клиент нельзя: classloader переиспользуется между стартами, и
 * закрытый клиент потом зовут снова (проба: 5 упавших, 599 пропущенных тестов).
 * Поэтому — закрыть на остановке и пересоздать по требованию. Сторож — LiveDbHttpGuardTest.
 */
final class LoreHttpClients {

    private static final Logger LOG = Logger.getLogger(LoreHttpClients.class);
    private static final List<Shared> ALL = new CopyOnWriteArrayList<>();

    private LoreHttpClients() {}

    /** Общий клиент из builder'а; живёт до остановки приложения, потом строится заново. */
    static Shared shared(Supplier<HttpClient.Builder> builder) {
        Shared s = new Shared(builder);
        ALL.add(s);
        return s;
    }

    /** Закрыть текущие клиенты (потоки селектора останавливаются сразу). Число закрытых. */
    static int shutdownAll() {
        int n = 0;
        for (Shared s : ALL) if (s.close()) n++;
        return n;
    }

    /** Клиент, который после закрытия при следующем обращении создаётся заново. */
    static final class Shared {
        private final Supplier<HttpClient.Builder> builder;
        private volatile HttpClient client;

        private Shared(Supplier<HttpClient.Builder> builder) { this.builder = builder; }

        HttpClient get() {
            HttpClient c = client;
            if (c == null || c.isTerminated()) {
                synchronized (this) {
                    c = client;
                    if (c == null || c.isTerminated()) {
                        c = builder.get().build();
                        client = c;
                    }
                }
            }
            return c;
        }

        /** true — был открытый клиент, и он закрыт. */
        synchronized boolean close() {
            HttpClient c = client;
            client = null;
            if (c == null) return false;
            c.shutdownNow();
            return true;
        }
    }

    /** Наблюдатель остановки приложения; бин с observer'ом ArC не удаляет как неиспользуемый. */
    @ApplicationScoped
    static class OnShutdown {
        void stop(@Observes ShutdownEvent ev) {
            int n = shutdownAll();
            if (n > 0) LOG.debugf("[LORE HTTP] закрыто клиентов при остановке: %d", n);
        }
    }
}
