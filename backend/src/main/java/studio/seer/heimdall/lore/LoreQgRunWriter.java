package studio.seer.heimdall.lore;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Роль ⑥ «Регистратор» из SPEC-QG-ARCHITECTURE §11.2: <b>единственная точка
 * записи</b> прогона гейта, общая для обоих каналов.
 *
 * Почему отдельный бин, а не метод ресурса. Записывать прогоны нужно из двух
 * мест: HTTP-эндпоинт {@code POST /lore/qg/run} и опрос Forgejo
 * ({@link LoreQgActionsPoller}). Скопировать SQL во второе место значило бы
 * завести вторую правду о том, что считается корректной записью — и первая же
 * правка проверок разошлась бы молча. Ровно этот класс дефекта разбирает весь
 * спринт, поэтому проверки и запись живут здесь в одном экземпляре.
 *
 * Проверки стоят ДО первой команды в базу намеренно: иначе прогон ложился бы
 * наполовину, то есть получалась бы полуправда вместо отказа.
 */
@ApplicationScoped
public class LoreQgRunWriter {

    private static final Logger LOG = Logger.getLogger(LoreQgRunWriter.class);

    /** Канал запуска (§4.8). Отличает «не было коммитов» от «гейт умер». */
    static final Set<String> CHANNELS = Set.of("actions", "app_job");

    /**
     * Типизированные причины «не измерено» (§5). Свободный текст запрещён
     * намеренно: по нему не сгруппировать и не посчитать, сколько дней держится.
     * Метрика {@code lore_addr_drift} прожила пять дней незамеченной ровно
     * потому, что причина не была счётной величиной.
     */
    static final Set<String> NOT_MEASURED_REASONS = Set.of(
        "source_unreachable", "source_missing", "stand_absent", "tool_disabled",
        "script_absent", "not_implemented", "budget_exhausted", "no_changes", "no_evidence");

    /** Статусы метрики, означающие «измерения не было». SKIP — легаси-форма того же. */
    static final Set<String> UNMEASURED_STATUSES = Set.of("NOT_MEASURED", "SKIP");

    @ConfigProperty(name = "lore.db", defaultValue = "system_aida_lore")
    String db;

    @Inject
    MartCredentials mart;

    @Inject
    @RestClient
    LoreCommandClient writeClient;

    /**
     * Итог записи. Отказ несёт причину текстом, потому что вызывающих двое и
     * оформляют они её по-разному: ресурс — как 400, опрос — как строку в логе.
     */
    public record Result(boolean ok, String errorDetail, String runId, int metricsWritten) {
        static Result rejected(String detail) { return new Result(false, detail, null, 0); }
        static Result written(String runId, int n) { return new Result(true, null, runId, n); }
    }

    /** Проверка контракта без записи — вынесена, чтобы её можно было звать в тестах отдельно. */
    static String validate(LoreQgResource.QGRunRequest req) {
        if (req == null || req.routine_name() == null || req.routine_name().isBlank())
            return "routine_name required";

        // QG-03: 56 строк метрик из 191 не имеют даты вовсе. Метрика без даты не
        // встаёт в ряд, не стареет и не поднимает детектор молчания — сказать
        // «держится N дней» просто не от чего. Старые строки остаются видимым
        // долгом, новые без даты больше не появляются.
        if (req.run_date() == null || req.run_date().isBlank())
            return "run_date required — метрика без даты не встаёт в ряд и не стареет (SPEC-QG-ARCHITECTURE §5)";

        if (req.channel() != null && !CHANNELS.contains(req.channel()))
            return "channel must be one of " + CHANNELS + ", got: " + req.channel();

        if (req.metrics() != null) {
            for (LoreQgResource.QGMetricEntry m : req.metrics()) {
                if (m.not_measured_reason() != null
                        && !NOT_MEASURED_REASONS.contains(m.not_measured_reason()))
                    return "not_measured_reason must be one of " + NOT_MEASURED_REASONS
                        + ", got: " + m.not_measured_reason() + " (metric " + m.key() + ")";
                if (m.status() != null && UNMEASURED_STATUSES.contains(m.status())
                        && (m.not_measured_reason() == null || m.not_measured_reason().isBlank()))
                    return "metric '" + m.key() + "' has status " + m.status()
                        + " without not_measured_reason — молчаливый SKIP и есть разбираемый дефект"
                        + " (35 таких метрик, SPEC-QG-ARCHITECTURE §5). Допустимые причины: "
                        + NOT_MEASURED_REASONS;
            }
        }
        return null;
    }

    public Result record(LoreQgResource.QGRunRequest req) {
        String bad = validate(req);
        if (bad != null) return Result.rejected(bad);

        String runId = req.run_id() != null ? req.run_id()
            : req.routine_name() + "_" + req.run_date();
        String auth = mart.basicAuth();

        writeClient.command(db, auth, new LoreCommandClient.LoreCommand("sql",
            "UPDATE ClRoutineRun SET run_id=:rid, routine_name=:rn, run_date=:rd, " +
            "status=:st, started_at=:sa, finished_at=:fa, flags=:fl, " +
            "channel=:ch, source_url=:su, commit_sha=:cs, pr_number=:pr, model=:mdl " +
            "UPSERT WHERE run_id=:rid",
            LoreResourceBase.mapOfNullable("rid", runId, "rn", req.routine_name(), "rd", req.run_date(),
                "st", req.status(), "sa", req.started_at(), "fa", req.finished_at(),
                "fl", req.flags(),
                "ch", req.channel(), "su", req.source_url(), "cs", req.commit_sha(),
                "pr", req.pr_number(), "mdl", req.model()))).await().indefinitely();

        int written = 0;
        if (req.metrics() != null) {
            for (LoreQgResource.QGMetricEntry m : req.metrics()) {
                if (m.key() == null) continue;
                String mId = runId + "_" + m.key();
                writeClient.command(db, auth, new LoreCommandClient.LoreCommand("sql",
                    "UPDATE ClRoutineMetric SET metric_id=:mid, run_id=:rid, " +
                    "routine_name=:rn, run_date=:rd, metric_key=:mk, value=:val, " +
                    "unit=:unit, target=:tgt, status=:st, source=:src, " +
                    "not_measured_reason=:nmr, model=:mdl " +
                    "UPSERT WHERE metric_id=:mid",
                    LoreResourceBase.mapOfNullable("mid", mId, "rid", runId, "rn", req.routine_name(),
                        "rd", req.run_date(), "mk", m.key(), "val", m.value(),
                        "unit", m.unit(), "tgt", m.target(), "st", m.status(),
                        "src", m.source(),
                        "nmr", m.not_measured_reason(),
                        // модель метрики может отличаться от модели прогона: часть
                        // метрик собирается кодом и модели не имеет вовсе (§4.4)
                        "mdl", m.model() != null ? m.model() : req.model())))
                    .await().indefinitely();
                written++;
            }
        }
        LOG.debugf("[LORE QG RUN] %s: %d метрик", runId, written);
        return Result.written(runId, written);
    }

    /** Удобная форма для канала 1: прогон из Actions без метрик, кроме факта сборки. */
    public static LoreQgResource.QGRunRequest actionsRun(
            String routineName, String runDate, String runStatus, String metricStatus,
            Double buildValue, String notMeasuredReason,
            String runId, String startedAt, String finishedAt,
            String sourceUrl, String commitSha, Integer prNumber) {
        return new LoreQgResource.QGRunRequest(
            runId, routineName, runDate, runStatus, startedAt, finishedAt, null,
            "actions", sourceUrl, commitSha, prNumber,
            // модель у канала 1 ПУСТА ОСМЫСЛЕННО: там нет суждения, только факт
            // сборки. Это отличается от «забыли записать» (§4.9).
            null,
            List.of(new LoreQgResource.QGMetricEntry(
                "build_result", buildValue, "bool", 1.0, metricStatus,
                sourceUrl, notMeasuredReason, null)));
    }
}
