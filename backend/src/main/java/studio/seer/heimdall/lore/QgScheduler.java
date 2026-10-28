package studio.seer.heimdall.lore;

import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.ConfigProvider;
import org.jboss.logging.Logger;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Function;

/**
 * Планировщик рутин канала 2 (SPEC-QG-JOB-CONTRACT §3, §7; task:SPRINT_QG_REBUILD/QG-11).
 *
 * <p>{@code @Startup} обязателен: ленивый {@code @ApplicationScoped}, которого никто
 * не внедряет, не создаётся никогда — так канал 1 ({@link LoreQgActionsPoller})
 * молчал всю жизнь кода (найдено в AO-08, сторож ScheduledBeansStartEagerlyTest).
 *
 * <p>Умолчания контракта: рутина выключена, пока нет
 * {@code lore.qg.routines.<name>.enabled=true} — включение осознанное, а не
 * побочный эффект деплоя; каденция — интервал ({@code .every}, ISO-8601), не cron;
 * одновременно идёт не больше одной попытки рутины, перекрытие пишется строкой
 * с флагом {@code overlap}, а не пропускается молча.
 */
@Startup
@ApplicationScoped
public class QgScheduler {

    private static final Logger LOG = Logger.getLogger(QgScheduler.class);

    @Inject
    Instance<QgRoutine> routines;

    @Inject
    LoreQgRunWriter writer;

    private ScheduledExecutorService pool;
    private final Map<String, AtomicBoolean> busy = new ConcurrentHashMap<>();

    @PostConstruct
    void start() {
        Function<String, Optional<String>> cfg = k -> ConfigProvider.getConfig().getOptionalValue(k, String.class);
        Map<String, Duration> plan = new LinkedHashMap<>();
        for (QgRoutine r : routines) {
            if (!enabled(r.name(), cfg)) {
                LOG.infof("[LORE QG] рутина %s выключена (lore.qg.routines.%s.enabled не true) — не запускается",
                    r.name(), r.name());
                continue;
            }
            plan.put(r.name(), every(r.name(), r.cadence(), cfg));
        }
        if (plan.isEmpty()) {
            LOG.info("[LORE QG] включённых рутин канала 2 нет — планировщик простаивает");
            return;
        }
        pool = Executors.newSingleThreadScheduledExecutor(t -> {
            Thread th = new Thread(t, "lore-qg-scheduler");
            th.setDaemon(true);
            return th;
        });
        for (QgRoutine r : routines) {
            Duration d = plan.get(r.name());
            if (d == null) continue;
            pool.scheduleAtFixedRate(() -> fire(r), 1, d.toMinutes(), TimeUnit.MINUTES);
            LOG.infof("[LORE QG] рутина %s запланирована, каждые %s", r.name(), d);
        }
    }

    @PreDestroy
    void stop() {
        if (pool != null) pool.shutdownNow();
    }

    /** Одна попытка. Исключение не уходит в пул: иначе scheduleAtFixedRate отменит рутину навсегда. */
    void fire(QgRoutine r) {
        AtomicBoolean b = busy.computeIfAbsent(r.name(), k -> new AtomicBoolean());
        Instant now = Instant.now();
        if (!b.compareAndSet(false, true)) {
            safeWrite(new LoreQgResource.QGRunRequest(
                r.name() + "_" + now.toString().replaceAll("[-:.]", "") + "_overlap", r.name(),
                now.toString().substring(0, 10), "NOT_MEASURED", now.toString(), now.toString(),
                "overlap: предыдущая попытка ещё идёт", QgAttemptRunner.CHANNEL,
                null, null, null, null, List.of()));
            return;
        }
        try {
            QgAttemptRunner.run(r, this::safeWrite, now);
        } catch (Throwable t) {
            LOG.warnf("[LORE QG] рутина %s: попытка не записана: %s", r.name(), t.toString());
        } finally {
            b.set(false);
        }
    }

    private void safeWrite(LoreQgResource.QGRunRequest run) {
        LoreQgRunWriter.Result res = writer.record(run);
        if (!res.ok()) LOG.warnf("[LORE QG] запись %s отвергнута: %s", run.run_id(), res.errorDetail());
    }

    static boolean enabled(String name, Function<String, Optional<String>> cfg) {
        return cfg.apply("lore.qg.routines." + name + ".enabled").map(String::trim).map("true"::equalsIgnoreCase).orElse(false);
    }

    /** ISO-8601 интервал из конфига; не разобран — каденция рутины, а не молчаливый ноль. */
    static Duration every(String name, Duration fallback, Function<String, Optional<String>> cfg) {
        Optional<String> v = cfg.apply("lore.qg.routines." + name + ".every");
        if (v.isEmpty()) return fallback;
        try {
            Duration d = Duration.parse(v.get().trim());
            return d.toMinutes() < 1 ? fallback : d;
        } catch (Exception e) {
            LOG.warnf("[LORE QG] lore.qg.routines.%s.every=%s не разобран — беру каденцию рутины %s",
                name, v.get(), fallback);
            return fallback;
        }
    }
}
