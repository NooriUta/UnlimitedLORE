package studio.seer.heimdall.lore;

import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * AO-SESSION-LOG: справочник harness и harness клиентов KC — в памяти, перечитывается в фоне
 * раз в 5 минут. Путь записи сверяет присланный X-Lore-Harness с этим снимком без похода в
 * базу ({@link HarnessCheck}); пока снимок не прочитан — пометка «unverified», не догадка.
 *
 * <p>{@code @Startup}: ленивый бин без внедрения не создаётся никогда (урок LoreQgActionsPoller).
 */
@ApplicationScoped
@Startup
public class HarnessRegistry {

    private static final Logger LOG = Logger.getLogger(HarnessRegistry.class);

    static final String DICT_SQL = "SELECT code FROM KnowDictEntry WHERE dict_type = 'harness' AND ifnull(is_active, true) = true";
    static final String CLIENTS_SQL = "SELECT client_id, harness FROM KnowActor WHERE kind = 'agent' AND client_id IS NOT NULL";

    @ConfigProperty(name = "lore.enabled", defaultValue = "false")
    boolean loreEnabled;

    @Inject
    LoreIngestService ingestService;

    private volatile HarnessCheck.Snapshot snapshot = HarnessCheck.Snapshot.EMPTY;
    private ScheduledExecutorService timer;

    HarnessCheck.Snapshot snapshot() {
        return snapshot;
    }

    @PostConstruct
    void start() {
        if (!loreEnabled) return;
        timer = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "lore-harness-registry");
            t.setDaemon(true);
            return t;
        });
        timer.scheduleWithFixedDelay(this::refreshQuietly, 5, 300, TimeUnit.SECONDS);
    }

    @PreDestroy
    void stop() {
        if (timer != null) timer.shutdownNow();
    }

    void refreshQuietly() {
        try {
            snapshot = read(ingestService.queryPublic(DICT_SQL, Map.of()), ingestService.queryPublic(CLIENTS_SQL, Map.of()));
        } catch (RuntimeException e) {
            // Прежний снимок остаётся; пустой — значит «unverified» в истории, а не ложная сверка.
            LOG.warnf("[LORE HARNESS] справочник не перечитан: %s", e.getMessage());
        }
    }

    static HarnessCheck.Snapshot read(List<Map<String, Object>> dict, List<Map<String, Object>> clients) {
        Set<String> codes = new HashSet<>();
        for (Map<String, Object> r : dict) if (r.get("code") != null) codes.add(String.valueOf(r.get("code")));
        Map<String, String> by = new HashMap<>();
        for (Map<String, Object> r : clients) {
            Object c = r.get("client_id"), h = r.get("harness");
            if (c != null && h != null && !String.valueOf(h).isBlank()) by.put(String.valueOf(c), String.valueOf(h));
        }
        return new HarnessCheck.Snapshot(true, Set.copyOf(codes), Map.copyOf(by));
    }
}
