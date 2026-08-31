package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.util.Optional;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * SPRINT_QG_REBUILD/QG-12, канал 1: прогоны Forgejo Actions попадают в корпус.
 *
 * <h2>Почему ЗАБИРАЕМ, а не нам ТОЛКАЮТ</h2>
 *
 * Первая версия была шагом в самих воркфлоу: последний шаг джоба звал
 * {@code POST /lore/qg/run}. Отказались по двум причинам, и обе существенные.
 *
 * <b>1. Толчок теряет ровно то, что важнее всего.</b> Шаг стоит последним. Если
 * джоб убит по таймауту, отменён или раннер умер — шаг не выполнится, и записи о
 * самом интересном исходе не будет. Опрос видит прогон с другой стороны и не
 * зависит от того, дожил ли джоб до конца.
 *
 * <b>2. Толчку нужна учётная запись.</b> Бэкенд опубликован на loopback, значит
 * раннеру пришлось бы ходить через публичный адрес, а там OIDC — то есть заводить
 * служебную учётку в Keycloak и класть её секрет в секреты организации. Здесь не
 * нужно ничего: {@link ForgejoBridge} уже ходит в Forgejo своим токеном, давно
 * заведённым для других задач. Меньше учёток — меньше того, что можно потерять.
 *
 * Контракт записи при этом НЕ меняется (§4.9): те же {@code channel=actions},
 * ссылка на прогон, коммит и номер PR, и та же единственная точка записи
 * {@link LoreQgRunWriter}. Меняется только направление, а не то, что записано.
 *
 * <h2>Чего этот опрос НЕ делает</h2>
 *
 * Не меняет условий слияния: CI как был условием merge, так и остаётся. Здесь
 * только запись факта — блокировка по новым гейтам это открытый вопрос 2 спеки,
 * и решает его владелец.
 *
 * <h2>Молчание не равно успеху</h2>
 *
 * Недоступный Forgejo не роняет LORE и не притворяется, что прогонов не было:
 * ошибка уходит в лог предупреждением. Отсутствие прогонов при живом Forgejo —
 * законное состояние (не было коммитов), и это ровно та разница, ради которой в
 * контракте появилось поле {@code channel}.
 */
@ApplicationScoped
public class LoreQgActionsPoller {

    private static final Logger LOG = Logger.getLogger(LoreQgActionsPoller.class);

    @ConfigProperty(name = "lore.enabled", defaultValue = "false")
    boolean loreEnabled;

    @ConfigProperty(name = "lore.qg.actions-poll.enabled", defaultValue = "true")
    boolean pollEnabled;

    @ConfigProperty(name = "lore.qg.actions-poll-minutes", defaultValue = "15")
    long pollMinutes;

    /**
     * Проекты, чьи прогоны вычитываем. Пусто — опрос не работает и говорит об
     * этом один раз: молча ничего не делать здесь нельзя, иначе пустота в
     * корпусе снова будет выглядеть как «прогонов не было».
     */
    @ConfigProperty(name = "lore.qg.actions-projects", defaultValue = "")
    String projectsCsv;

    /** Сколько последних прогонов забирать за один заход. */
    @ConfigProperty(name = "lore.qg.actions-page-size", defaultValue = "30")
    int pageSize;

    @Inject
    ForgejoBridge forgejo;

    @Inject
    LoreQgRunWriter writer;

    private ScheduledExecutorService poller;

    @PostConstruct
    void start() {
        if (!loreEnabled || !pollEnabled) return;
        if (projectsCsv == null || projectsCsv.isBlank()) {
            LOG.warn("[LORE QG] опрос прогонов Actions включён, но lore.qg.actions-projects пуст — "
                + "записей канала 1 не будет. Это НЕ то же самое, что «прогонов не было».");
            return;
        }
        poller = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "lore-qg-actions-poll");
            t.setDaemon(true);
            return t;
        });
        // Первый заход с задержкой в один интервал: на старте приложения Forgejo
        // может быть ещё не поднят, а стартовать с предупреждения об ошибке —
        // приучать не читать предупреждения.
        poller.scheduleAtFixedRate(this::pollQuietly, pollMinutes, pollMinutes, TimeUnit.MINUTES);
        LOG.infof("[LORE QG] опрос прогонов Actions включён, раз в %d мин, проекты: %s",
            pollMinutes, projectsCsv);
    }

    @PreDestroy
    void stop() {
        if (poller != null) poller.shutdown();
    }

    private void pollQuietly() {
        for (String slug : projectsCsv.split(",")) {
            String s = slug.trim();
            if (s.isEmpty()) continue;
            try {
                pollProject(s);
            } catch (Exception e) {
                // Недоступный Forgejo — потеря метрики, а не работы пользователя.
                LOG.warnf("[LORE QG] опрос прогонов %s не удался: %s", s, e.getMessage());
            }
        }
    }

    void pollProject(String slug) throws Exception {
        Optional<ForgejoBridge.Repo> repo = forgejo.resolve(slug);
        if (repo.isEmpty()) {
            LOG.warnf("[LORE QG] проект %s не разрешается в репозиторий Forgejo — пропущен", slug);
            return;
        }
        var resp = forgejo.api(repo.get(), "GET",
            "/repos/" + repo.get().owner() + "/" + repo.get().name()
                + "/actions/runs?limit=" + pageSize, null);
        if (resp.statusCode() != 200) {
            LOG.warnf("[LORE QG] Forgejo вернул %d на список прогонов %s", resp.statusCode(), slug);
            return;
        }
        JsonObject body = new JsonObject(resp.body());
        JsonArray runs = body.getJsonArray("workflow_runs", new JsonArray());
        int written = 0;
        for (int i = 0; i < runs.size(); i++) {
            if (recordRun(slug, runs.getJsonObject(i))) written++;
        }
        LOG.debugf("[LORE QG] %s: записано прогонов %d из %d", slug, written, runs.size());
    }

    /** @return true если прогон записан; false если он ещё идёт и записывать нечего. */
    private boolean recordRun(String slug, JsonObject run) {
        String status = run.getString("status", "");
        // Идущий прогон не записываем: его исход ещё не определён, а запись с
        // выдуманным исходом хуже её отсутствия. На следующем заходе он будет готов.
        if (!"success".equals(status) && !"failure".equals(status) && !"cancelled".equals(status)) return false;

        String workflow = run.getString("workflow_id", "unknown");
        String routine = "qg-ci-" + workflow.replaceAll("\\.ya?ml$", "").replaceAll("[^A-Za-z0-9_-]", "-");
        String updated = run.getString("updated_at", run.getString("created_at", ""));
        String runDate = updated.length() >= 10 ? updated.substring(0, 10) : null;
        if (runDate == null) {
            // Без даты запись запрещена контрактом (QG-03), и обходить его здесь
            // было бы прямым воспроизведением разбираемого дефекта.
            LOG.warnf("[LORE QG] прогон %s без даты — пропущен", run.getValue("id"));
            return false;
        }

        String runStatus;
        String metricStatus;
        Double buildValue;
        String reason = null;
        switch (status) {
            case "success" -> { runStatus = "OK";   metricStatus = "PASS"; buildValue = 1.0; }
            case "failure" -> { runStatus = "FAIL"; metricStatus = "FAIL"; buildValue = 0.0; }
            // Отмена — НЕ провал: измерения не было по внешней причине, и валить
            // это в FAIL значило бы портить ряд чужим решением остановить прогон.
            default        -> { runStatus = "PARTIAL"; metricStatus = "NOT_MEASURED"; buildValue = -1.0;
                                reason = "no_evidence"; }
        }

        var req = LoreQgRunWriter.actionsRun(
            routine, runDate, runStatus, metricStatus, buildValue, reason,
            // run_id из идентификатора Forgejo: повторный заход перезапишет ту же
            // строку, а не заведёт вторую. Опрос обязан быть идемпотентным —
            // он видит одно и то же окно много раз.
            "forgejo_run_" + run.getValue("id"),
            run.getString("run_started_at", run.getString("created_at", null)),
            run.getString("updated_at", null),
            run.getString("url", null),
            run.getString("head_sha", null),
            prNumber(run));

        LoreQgRunWriter.Result r = writer.record(req);
        if (!r.ok()) {
            LOG.warnf("[LORE QG] прогон %s из %s отклонён контрактом: %s",
                run.getValue("id"), slug, r.errorDetail());
            return false;
        }
        return true;
    }

    /**
     * Номер PR у прогона по PR-событию. Forgejo кладёт его в head_branch вида
     * «#556» — отдельного поля нет. Не распознали — null, а не выдуманный ноль:
     * пустое поле честно означает «неизвестно», ноль означал бы «PR номер ноль».
     */
    static Integer prNumber(JsonObject run) {
        String b = run.getString("head_branch", "");
        if (b.startsWith("#")) {
            try { return Integer.valueOf(b.substring(1)); } catch (NumberFormatException ignored) { }
        }
        return null;
    }
}
