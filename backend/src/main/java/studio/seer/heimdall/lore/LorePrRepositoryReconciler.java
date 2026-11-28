package studio.seer.heimdall.lore;

import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.ConfigProvider;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.BiConsumer;
import java.util.function.BiFunction;
import java.util.function.Function;

/**
 * PR принадлежит репозиторию ([[adr:ADR-LORE-066]] фаза А, ребро PR_OF): новые PR получают ребро сверщиком.
 *
 * <p>KnowPR пишется в пяти местах (мерж, привязка к релизу, задача, бэкфилл, Forgejo-сверка) — правка каждого
 * дала бы пять копий одного правила. Сверщик раз в N минут ставит PR_OF тем PR, у кого ребра нет и чей адрес
 * (…/owner/repo/pulls/N) сопоставим с KnowRepository. План тот же, что у миграции
 * ({@link LoreReleaseRepositoryResource#currentPrPlan}); несопоставимые не трогаются — их видно в сухом прогоне.
 *
 * <p>{@code @Startup} обязателен: ленивый бин, которого никто не внедряет, не создаётся никогда (AO-08).
 * Выключается {@code lore.pr.repository-sync.enabled=false}.
 */
@Startup
@ApplicationScoped
public class LorePrRepositoryReconciler {

    private static final Logger LOG = Logger.getLogger(LorePrRepositoryReconciler.class);

    @ConfigProperty(name = "lore.enabled", defaultValue = "false")
    boolean loreEnabled;

    @ConfigProperty(name = "lore.pr.repository-sync.minutes", defaultValue = "10")
    int minutes;

    @ConfigProperty(name = "lore.db", defaultValue = "system_aida_lore")
    String db;

    @Inject
    LoreIngestService ingest;

    @Inject
    MartCredentials mart;

    @Inject
    @RestClient
    LoreCommandClient writeClient;

    private ScheduledExecutorService pool;

    @PostConstruct
    void start() {
        if (!loreEnabled) return;
        if (!enabled(k -> ConfigProvider.getConfig().getOptionalValue(k, String.class))) {
            LOG.info("[LORE PR-REPO] сверка PR → репозиторий выключена (lore.pr.repository-sync.enabled=false)");
            return;
        }
        pool = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "lore-pr-repository-sync");
            t.setDaemon(true);
            return t;
        });
        int every = Math.max(1, minutes);
        pool.scheduleAtFixedRate(this::runQuietly, 2, every, TimeUnit.MINUTES);
        LOG.infof("[LORE PR-REPO] сверка PR → репозиторий включена, раз в %d мин", every);
    }

    @PreDestroy
    void stop() {
        if (pool != null) pool.shutdownNow();
    }

    private void runQuietly() {
        try {
            int n = sync(ingest::queryPublic, (uid, repo) -> {
                writeClient.command(db, mart.basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    LoreReleaseRepositoryResource.CREATE_PR_EDGE_SQL, Map.of("u", uid, "r", repo))).await().indefinitely();
            });
            if (n > 0) LOG.infof("[LORE PR-REPO] поставлено рёбер PR_OF: %d", n);
        } catch (Exception e) {
            LOG.warnf("[LORE PR-REPO] сверка не удалась: %s", e.getMessage());
        }
    }

    /** Один проход: ставит недостающие PR_OF; сбой одной записи не останавливает остальные. Возвращает число поставленных. */
    static int sync(BiFunction<String, Map<String, Object>, List<Map<String, Object>>> query, BiConsumer<String, String> create) {
        LoreReleaseRepositoryMigration.PrPlan plan = LoreReleaseRepositoryResource.currentPrPlan(query);
        int n = 0;
        for (LoreReleaseRepositoryMigration.PrItem it : plan.items()) {
            if (it.exists()) continue;
            try {
                create.accept(it.uid(), it.repo());
                n++;
            } catch (RuntimeException e) {
                LOG.warnf("[LORE PR-REPO] %s → %s: %s", it.uid(), it.repo(), e.getMessage());
            }
        }
        return n;
    }

    static boolean enabled(Function<String, Optional<String>> cfg) {
        return cfg.apply("lore.pr.repository-sync.enabled").map(String::trim).map(v -> !"false".equalsIgnoreCase(v)).orElse(true);
    }
}
