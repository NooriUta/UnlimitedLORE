package studio.seer.heimdall.lore;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.LongAdder;

/**
 * Счётчики запросов к LORE: кто × что × сколько (STAT-1).
 *
 * <p>Вопрос владельца — «кто что и по сколько запрашивает» — раньше не имел
 * ответа: {@link LoreAuditLogFilter} писал строку на КАЖДУЮ запись в лог-файл,
 * чтения не считал вовсе, а агрегировать текстовый лог нечем.
 *
 * <h2>Почему агрегат, а не точка на запрос</h2>
 * Точка на каждый вызов — это тысячи строк в минуту при нулевой пользе:
 * гранулярность мельче окна никто не читает, а место и время записи она ест.
 * Здесь счётчики копятся в памяти и сбрасываются в {@code MetricSnapshot} раз в
 * окно; точка = (окно × вызывающий × что звал).
 *
 * <h2>Почему MetricSnapshot, а не новый тип</h2>
 * Это уже нативный TIMESERIES ArcadeDB (ARC-02), заведён под метрики BRAGI.
 * Новый тип означал бы шаг миграции, а любой локальный {@code ./gradlew test}
 * применяет незакоммиченный шаг к боевой базе (см. память
 * lore-livedb-test-migrates-prod). Переиспользование снимает этот риск целиком.
 *
 * <h2>Потеря при рестарте допустима</h2>
 * Несброшенное окно (до минуты) при остановке теряется — кроме штатной, где
 * {@link #shutdown()} сбрасывает остаток. Для вопроса «кто сколько зовёт»
 * минута погрешности не значит ничего, а durable-очередь ради счётчика
 * использования — цена, несопоставимая с задачей.
 */
@ApplicationScoped
public class LoreRequestStats {

    private static final Logger LOG = Logger.getLogger(LoreRequestStats.class);

    /** Метрика количества вызовов. */
    static final String M_REQUESTS = "lore.requests";
    /** Метрика «началась сессия вызывающего» — см. {@link #touchSession}. */
    static final String M_SESSION  = "lore.session_start";

    @ConfigProperty(name = "lore.stats.enabled", defaultValue = "true")
    boolean statsEnabled;

    @ConfigProperty(name = "lore.enabled", defaultValue = "false")
    boolean loreEnabled;

    /** Окно агрегации, секунды. Меньше — больше точек без нового смысла. */
    @ConfigProperty(name = "lore.stats.window-seconds", defaultValue = "60")
    int windowSeconds;

    /**
     * Пауза, после которой следующий запрос считается началом новой сессии.
     * LORE не наблюдает вход в Keycloak — он происходит вне её периметра, —
     * поэтому «логин» здесь честно называется началом сессии: утверждать факт,
     * которого система не видела, метрика не должна.
     */
    @ConfigProperty(name = "lore.stats.session-gap-minutes", defaultValue = "30")
    int sessionGapMinutes;

    @ConfigProperty(name = "lore.db", defaultValue = "system_aida_lore")
    String db;

    @Inject
    MartCredentials mart;

    @Inject
    @RestClient
    LoreCommandClient writeClient;

    /** (вызывающий, ось, что звал) → счётчик за текущее окно. */
    private final Map<Key, LongAdder> counters = new ConcurrentHashMap<>();
    /** Вызывающий → когда его видели в последний раз (для границы сессии). */
    private final Map<String, Instant> lastSeen = new ConcurrentHashMap<>();

    private ScheduledExecutorService flusher;

    record Key(String caller, String axis, String what) {}

    @PostConstruct
    void start() {
        if (!statsEnabled || !loreEnabled) return;
        flusher = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "lore-stats-flush");
            t.setDaemon(true);   // счётчик использования не имеет права держать остановку приложения
            return t;
        });
        flusher.scheduleAtFixedRate(this::flushQuietly, windowSeconds, windowSeconds, TimeUnit.SECONDS);
        LOG.infof("[LORE STATS] сбор включён, окно %d с, граница сессии %d мин", windowSeconds, sessionGapMinutes);
    }

    @PreDestroy
    void shutdown() {
        if (flusher == null) return;
        flusher.shutdown();
        flushQuietly();   // штатная остановка не теряет последнее окно
    }

    /** Учесть один вызов. Вызывается из фильтра на каждый запрос — обязан быть дешёвым. */
    void record(String caller, String axis, String what) {
        if (!statsEnabled || !loreEnabled) return;
        counters.computeIfAbsent(new Key(caller, axis, what), k -> new LongAdder()).increment();
    }

    /**
     * Отметить активность вызывающего и сказать, началась ли новая сессия.
     * Первое появление после паузы длиннее {@code session-gap} = новая сессия.
     */
    boolean touchSession(String caller) {
        if (!statsEnabled || !loreEnabled || caller == null || caller.isBlank()) return false;
        Instant now = Instant.now();
        Instant prev = lastSeen.put(caller, now);
        return prev == null || Duration.between(prev, now).toMinutes() >= sessionGapMinutes;
    }

    void recordSessionStart(String caller, String axis) {
        if (!statsEnabled || !loreEnabled) return;
        counters.computeIfAbsent(new Key(caller, axis, M_SESSION), k -> new LongAdder()).increment();
    }

    private void flushQuietly() {
        try {
            flush();
        } catch (Exception e) {
            // Сбор статистики не имеет права влиять на работу LORE: не сбросили
            // окно — потеряли счётчик, а не запрос пользователя.
            LOG.warnf("[LORE STATS] сброс окна не удался: %s", LoreUpstream.detail(e));
        }
    }

    void flush() {
        if (counters.isEmpty()) return;
        String ts = Instant.now().toString();
        int written = 0;
        // Снимаем ключи по одному: параллельные инкременты во время сброса
        // попадут в следующее окно, а не потеряются между чтением и очисткой.
        for (Key k : counters.keySet().toArray(new Key[0])) {
            LongAdder adder = counters.remove(k);
            if (adder == null) continue;
            long v = adder.sum();
            if (v == 0) continue;
            boolean isSession = M_SESSION.equals(k.what());
            try {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "INSERT INTO MetricSnapshot SET ts=:ts, object_type='caller', object_id=:caller, "
                    + "metric=:metric, source=:src, segment=:seg, value=:v",
                    Map.of("ts", ts,
                        "caller", k.caller(),
                        "metric", isSession ? M_SESSION : M_REQUESTS,
                        "src", isSession ? "session" : k.what(),
                        "seg", k.axis(),
                        "v", (double) v))).await().indefinitely();
                written++;
            } catch (Exception e) {
                LOG.warnf("[LORE STATS] точка %s/%s не записана: %s", k.caller(), k.what(), LoreUpstream.detail(e));
            }
        }
        if (written > 0) LOG.debugf("[LORE STATS] окно сброшено: %d точек", written);
    }

    private String basicAuth() {
        return "Basic " + Base64.getEncoder().encodeToString(
            (mart.user() + ":" + mart.password()).getBytes(StandardCharsets.UTF_8));
    }
}
