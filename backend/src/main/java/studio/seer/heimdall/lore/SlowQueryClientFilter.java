package studio.seer.heimdall.lore;

import io.micrometer.core.instrument.Metrics;
import jakarta.ws.rs.client.ClientRequestContext;
import jakarta.ws.rs.client.ClientRequestFilter;
import jakarta.ws.rs.client.ClientResponseContext;
import jakarta.ws.rs.client.ClientResponseFilter;
import org.eclipse.microprofile.config.ConfigProvider;
import org.jboss.logging.Logger;
import studio.seer.heimdall.bench.MartQuery;

/**
 * SPRINT_LORE_OWN_HOST/OH-SLOW-QUERY-LOG · таймер вокруг каждого вызова ArcadeDB (клиент mart-api).
 *
 * <p>Повод — замер 16.11.2026 на lore-host: {@code POST /command} 1,5/с, p95 до 805 мс, медленные —
 * отдельные команды с хвостом до 0,8 с; шлёт их бэкенд LORE, и через {@code /command} идут и чтения.
 *
 * <p>Стоит на клиенте, а не в точках вызова: их сотни (LoreCommandClient, MartClient), и только здесь
 * видны все. Делает две вещи:
 * <ul>
 *   <li>вызов дольше порога {@code lore.slow-query.threshold-ms} (по умолчанию 300) — строка
 *       {@code [LORE SLOW-QUERY]} в лог: время, источник (срез или эндпоинт LORE), путь базы, чтение
 *       или запись и ШАБЛОН запроса ({@link SqlTemplate}: литералы → ?). Ни текст запроса, ни
 *       параметры в лог не идут — только шаблон;</li>
 *   <li>счётчик {@code lore_arcadedb_calls_total{endpoint=command|query, kind=read|write}} — какая доля
 *       {@code /command} приходится на чтения.</li>
 * </ul>
 *
 * <p>Ограничение: вызов, оборванный таймаутом клиента (30 с), до фильтра ответа не доходит и в журнал
 * не попадает — такие видны по исключению в логе вызывающего.
 */
public class SlowQueryClientFilter implements ClientRequestFilter, ClientResponseFilter {

    private static final Logger LOG = Logger.getLogger(SlowQueryClientFilter.class);
    private static final String T0 = "lore.slow-query.t0";
    private static final String SRC = "lore.slow-query.source";
    static final long DEFAULT_THRESHOLD_MS = 300;

    private volatile Long thresholdMs;
    private volatile Long topIntervalMs;

    /** Сводка по шаблонам — одна на процесс (фильтр создаётся на каждый клиент). */
    static final SlowQueryStats STATS = new SlowQueryStats(500);
    static final int TOP_N = 10;
    static final long DEFAULT_TOP_INTERVAL_MIN = 15;

    /** Интервал строки [LORE SLOW-QUERY TOP] — {@code lore.slow-query.top-interval-min}, по умолчанию 15 минут. */
    long topIntervalMs() {
        Long t = topIntervalMs;
        if (t == null) {
            long min;
            try {
                min = ConfigProvider.getConfig().getOptionalValue("lore.slow-query.top-interval-min", Long.class)
                    .orElse(DEFAULT_TOP_INTERVAL_MIN);
            } catch (Exception e) {
                min = DEFAULT_TOP_INTERVAL_MIN;
            }
            t = Math.max(1, min) * 60_000;
            topIntervalMs = t;
        }
        return t;
    }

    long thresholdMs() {
        Long t = thresholdMs;
        if (t == null) {
            try {
                t = ConfigProvider.getConfig().getOptionalValue("lore.slow-query.threshold-ms", Long.class)
                    .orElse(DEFAULT_THRESHOLD_MS);
            } catch (Exception e) {
                t = DEFAULT_THRESHOLD_MS;
            }
            thresholdMs = t;
        }
        return t;
    }

    @Override
    public void filter(ClientRequestContext req) {
        req.setProperty(T0, System.nanoTime());
        req.setProperty(SRC, QuerySource.current());
    }

    @Override
    public void filter(ClientRequestContext req, ClientResponseContext res) {
        try {
            Object t0 = req.getProperty(T0);
            if (!(t0 instanceof Long start)) return;
            long ms = (System.nanoTime() - start) / 1_000_000;
            String language;
            String command;
            Object e = req.getEntity();
            if (e instanceof LoreCommandClient.LoreCommand c) { language = c.language(); command = c.command(); }
            else if (e instanceof MartQuery q) { language = q.language(); command = q.command(); }
            else return;
            String path = req.getUri() == null ? "" : req.getUri().getPath();
            String endpoint = path.contains("/command/") ? "command" : path.contains("/query/") ? "query" : "other";
            String kind = SqlTemplate.kind(language, command);
            Metrics.counter("lore_arcadedb_calls", "endpoint", endpoint, "kind", kind).increment();
            Object src = req.getProperty(SRC);
            String source = src == null ? QuerySource.NONE : String.valueOf(src);
            String template = SqlTemplate.normalize(command);
            if (ms >= thresholdMs()) {
                LOG.warnf("[LORE SLOW-QUERY] %d ms · source=%s · %s/%s · status=%d · %s",
                    ms, source, endpoint, kind, res.getStatus(), template);
            }
            // «Готово, когда лог даёт топ шаблонов по суммарному времени»: сводка по всем вызовам, раз в интервал
            STATS.record(template, source, kind, ms);
            if (STATS.dueAt(System.currentTimeMillis(), topIntervalMs())) LOG.info(STATS.report(TOP_N));
        } catch (RuntimeException ex) {
            // Журнал — наблюдение, а не часть запроса: его сбой не должен ронять вызов базы.
            LOG.debugf("[LORE SLOW-QUERY] замер пропущен: %s", ex.getMessage());
        }
    }
}
