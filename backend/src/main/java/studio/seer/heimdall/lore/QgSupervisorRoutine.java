package studio.seer.heimdall.lore;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Надзиратель канала 2 (SPEC-QG-JOB-CONTRACT §3, SPEC-QG-ARCHITECTURE §8).
 *
 * <p>Попытку, которая не дошла до концовки (процесс убит, исключение мимо
 * обёртки), сама рутина закрыть не может — она уже не работает. Надзиратель
 * находит {@code RUNNING} старше двух каденций своей рутины и закрывает их как
 * {@code ABORTED}. Молчание рутины перестаёт быть тишиной: в ряду появляется
 * строка с причиной.
 *
 * <p>Побочное действие в {@link #collect} намеренное и единственное в своём роде:
 * работа надзирателя и есть закрытие зависших. Метрика — сколько закрыто.
 *
 * <p>Как и любая рутина, выключен, пока нет
 * {@code lore.qg.routines.qg-supervisor.enabled=true}.
 */
@ApplicationScoped
public class QgSupervisorRoutine implements QgRoutine {

    static final String NAME = "qg-supervisor";

    @Inject
    Instance<QgRoutine> routines;

    @Inject
    LoreIngestService ingest;

    @Inject
    MartCredentials mart;

    @Inject
    @RestClient
    LoreCommandClient writeClient;

    @ConfigProperty(name = "lore.db", defaultValue = "system_aida_lore")
    String db;

    @Override public String name() { return NAME; }

    @Override public Duration cadence() { return Duration.ofHours(1); }

    @Override public Precondition check() { return Precondition.ok(); }

    @Override
    public List<RawFact> collect() {
        Map<String, Duration> cadence = new HashMap<>();
        for (QgRoutine r : routines) cadence.put(r.name(), r.cadence());
        List<Map<String, Object>> running = ingest.queryPublic(
            "SELECT run_id, routine_name, started_at FROM ClRoutineRun "
                + "WHERE status = 'RUNNING' AND channel = '" + QgAttemptRunner.CHANNEL + "'", Map.of());
        List<String> hung = QgAttemptRunner.hungRuns(running, cadence, Instant.now());
        String now = Instant.now().toString();
        for (String runId : hung) {
            writeClient.command(db, mart.basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE ClRoutineRun SET status = :st, finished_at = :fa, flags = :fl WHERE run_id = :rid",
                Map.of("st", QgAttemptRunner.ABORTED, "fa", now, "rid", runId,
                    "fl", "aborted by " + NAME + ": попытка не дошла до концовки за 2× каденции")))
                .await().indefinitely();
        }
        return List.of(new RawFact("aborted_runs", hung.size(), "ClRoutineRun"));
    }

    @Override
    public List<LoreQgResource.QGMetricEntry> normalize(List<RawFact> raw) {
        double n = raw.isEmpty() ? 0 : ((Number) raw.get(0).value()).doubleValue();
        return List.of(new LoreQgResource.QGMetricEntry(
            "aborted_runs", n, "count", 0.0, n == 0 ? "PASS" : "WARN", "ClRoutineRun", null, null));
    }
}
