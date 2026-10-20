package studio.seer.heimdall.lore;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Попытка рутины: запись ДО работы и ровно одна концовка (SPEC-QG-JOB-CONTRACT §3).
 *
 * <p>Исходный дефект QG — не «рутина ошиблась», а «рутины не было, и этого не
 * видно»: пять рутин 56 дней вели в несуществующий файл, отчёт молчал. Поэтому
 * первой записью идёт {@code RUNNING}; дальше её закрывает одна из концовок —
 * отработала (худший статус среди ИЗМЕРЕННЫХ метрик), предусловие не выполнено
 * ({@code NOT_MEASURED} с типизированной причиной), упала ({@code FAIL} с классом
 * исключения). Зависшую {@code RUNNING} закрывает надзиратель
 * ({@link #hungRuns}) — сама себя рутина пожаловаться на молчание не может.
 *
 * <p>Чистая часть — без CDI, база подставляется через {@link Sink}: так каждая
 * концовка проверяется тестом, а не наблюдением за прод-логом.
 */
final class QgAttemptRunner {

    private QgAttemptRunner() {}

    /** Куда пишется попытка. В приложении — {@link LoreQgRunWriter#record}. */
    interface Sink { void write(LoreQgResource.QGRunRequest run); }

    static final String CHANNEL = "app_job";
    static final String RUNNING = "RUNNING";
    static final String ABORTED = "ABORTED";

    /** У рутины, которой больше нет в приложении, каденция неизвестна — ждём двое суток. */
    static final Duration ORPHAN_HANG = Duration.ofHours(48);

    private static final List<String> SEVERITY = List.of("PASS", "WARN", "FAIL");
    private static final Set<String> UNMEASURED = LoreQgRunWriter.UNMEASURED_STATUSES;

    /** @return итоговый статус попытки */
    static String run(QgRoutine r, Sink sink, Instant now) {
        String runId = r.name() + "_" + now.toString().replaceAll("[-:.]", "");
        String runDate = now.atOffset(ZoneOffset.UTC).toLocalDate().toString();
        String started = now.toString();

        sink.write(req(runId, r.name(), runDate, RUNNING, started, null, null, null));

        String status;
        String flags = null;
        List<LoreQgResource.QGMetricEntry> metrics;
        try {
            QgRoutine.Precondition pre = r.check();
            if (pre == null || !pre.met()) {
                String reason = pre == null || pre.reason() == null ? "not_implemented" : pre.reason();
                metrics = List.of(new LoreQgResource.QGMetricEntry(
                    "precondition", null, null, null, "NOT_MEASURED", r.name(), reason, null));
                status = "NOT_MEASURED";
            } else {
                metrics = r.normalize(r.collect());
                if (metrics == null) metrics = List.of();
                status = worstMeasured(metrics);
            }
        } catch (RuntimeException e) {
            metrics = List.of();
            status = "FAIL";
            flags = exceptionFlag(e);
        }
        sink.write(req(runId, r.name(), runDate, status, started, Instant.now().toString(), flags, metrics));
        return status;
    }

    /** Худший статус среди измеренных; ни одной измеренной — {@code NOT_MEASURED}, не PASS. */
    static String worstMeasured(List<LoreQgResource.QGMetricEntry> metrics) {
        int worst = -1;
        for (LoreQgResource.QGMetricEntry m : metrics) {
            if (m.status() == null || UNMEASURED.contains(m.status())) continue;
            worst = Math.max(worst, SEVERITY.indexOf(m.status()));
        }
        return worst < 0 ? "NOT_MEASURED" : SEVERITY.get(worst);
    }

    /**
     * Класс исключения и ПЕРВАЯ строка сообщения. Хвост не пишется: в нём бывают
     * тела ответов, а это уже не диагностика, а утечка в общий корпус.
     */
    static String exceptionFlag(Throwable e) {
        String msg = e.getMessage() == null ? "" : e.getMessage().split("\\R", 2)[0];
        if (msg.length() > 200) msg = msg.substring(0, 200) + "…";
        return "exception: " + e.getClass().getSimpleName() + ": " + msg;
    }

    /**
     * Надзиратель: попытки {@code RUNNING} старше двух каденций своей рутины —
     * зависли (процесс убит, исключение мимо обёртки). Рутины, которой больше
     * нет, — по {@link #ORPHAN_HANG}.
     *
     * @param running строки ClRoutineRun со статусом RUNNING: run_id, routine_name, started_at
     */
    static List<String> hungRuns(List<Map<String, Object>> running, Map<String, Duration> cadence, Instant now) {
        List<String> out = new ArrayList<>();
        for (Map<String, Object> row : running) {
            Object sa = row.get("started_at");
            if (sa == null) { out.add(String.valueOf(row.get("run_id"))); continue; }
            Instant started;
            try { started = Instant.parse(sa.toString()); }
            catch (Exception e) { out.add(String.valueOf(row.get("run_id"))); continue; }
            Duration c = cadence.get(String.valueOf(row.get("routine_name")));
            Duration limit = c == null ? ORPHAN_HANG : c.multipliedBy(2);
            if (started.plus(limit).isBefore(now)) out.add(String.valueOf(row.get("run_id")));
        }
        return out;
    }

    private static LoreQgResource.QGRunRequest req(String runId, String routine, String runDate, String status,
                                                   String started, String finished, String flags,
                                                   List<LoreQgResource.QGMetricEntry> metrics) {
        return new LoreQgResource.QGRunRequest(runId, routine, runDate, status, started, finished, flags,
            CHANNEL, null, null, null, null, metrics);
    }
}
