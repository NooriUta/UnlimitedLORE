package studio.seer.heimdall.lore;

import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;
import studio.seer.heimdall.bench.MartClient;
import studio.seer.heimdall.bench.MartQuery;

import java.time.Duration;
import java.util.Optional;

/**
 * Проба опциональных upstream при старте — одна, неблокирующая (SPRINT_LORE_EXT_ISSUES_W2/ISS-03-OPTIONAL-SERVICES,
 * issues SeidrStudio/UnlimitedLORE #3 и #7: «первая диагностика — только в момент вызова инструмента»).
 *
 * <p>Отдельный поток-демон: старт бэкенда пробу не ждёт, её сбой старт не роняет. Итог — строка в журнале:
 * недоступен → WARN с кодом и переменной ({@link OptionalUpstream#probe}); не задан/выключен → INFO, что деградирует.
 */
@ApplicationScoped
public class OptionalUpstreamProbe {

    private static final Logger LOG = Logger.getLogger(OptionalUpstreamProbe.class);

    @Inject
    BragiS3Service s3;

    @Inject
    @RestClient
    MartClient mart;

    @Inject
    MartCredentials martCredentials;

    @ConfigProperty(name = "bench.mart.enabled", defaultValue = "false")
    boolean benchEnabled;

    @ConfigProperty(name = "bench.mart.db", defaultValue = "RAGVSDL")
    String benchDb;

    void onStart(@Observes StartupEvent ev) {
        Thread t = new Thread(this::probeAll, "lore-optional-upstream-probe");
        t.setDaemon(true);
        t.start();
    }

    void probeAll() {
        try {
            if (!s3.configured()) {
                LOG.info("[OPTIONAL UPSTREAM] S3 не задан (S3_ENDPOINT пуст) — установка без файлов: загрузка и отдача"
                    + " файлов отвечают 503 FILES_NOT_CONFIGURED, остальное работает");
            } else {
                report(OptionalUpstream.Service.S3, OptionalUpstream.probe(OptionalUpstream.Service.S3, () -> {
                    s3.probe();
                    return null;
                }));
            }
            if (!benchEnabled) {
                LOG.info("[OPTIONAL UPSTREAM] bench выключен (BENCH_MART_ENABLED=false) — bench_query_slice отвечает 404"
                    + " MART_DISABLED");
            } else {
                report(OptionalUpstream.Service.MART, OptionalUpstream.probe(OptionalUpstream.Service.MART, () ->
                    mart.query(benchDb, martCredentials.benchAuth(), new MartQuery("sql", "SELECT 1", null, 1))
                        .await().atMost(Duration.ofSeconds(10))));
            }
        } catch (Throwable t) {
            // Проба — подсказка, а не условие старта: её собственный сбой только в журнал.
            LOG.warnf("[OPTIONAL UPSTREAM] проба не выполнена: %s", t.toString());
        }
    }

    private static void report(OptionalUpstream.Service s, Optional<String> warning) {
        if (warning.isPresent()) LOG.warn("[OPTIONAL UPSTREAM] " + warning.get());
        else LOG.infof("[OPTIONAL UPSTREAM] %s доступен", s.name());
    }
}
