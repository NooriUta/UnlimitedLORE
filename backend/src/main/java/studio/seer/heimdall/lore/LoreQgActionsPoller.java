package studio.seer.heimdall.lore;

import io.quarkus.runtime.Startup;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;
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
// AO-08: без @Startup бин ленив — пока его никто не внедрил, @PostConstruct не
// исполнится и расписание не запустится ни разу (так месяц молчали логины KC).
@Startup
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
    // AO-08: Optional, а не String с defaultValue = "". На проде переменная
    // LORE_QG_ACTIONS_PROJECTS не задана, объявление ${LORE_QG_ACTIONS_PROJECTS:}
    // разрешается в пустоту, а пустая строка в MicroProfile Config — «значения
    // нет». Пока бин был ленив и не создавался ни разу, ловушка ждала; с @Startup
    // она роняла подъём ВСЕГО приложения. Поймано полным прогоном тестов до слияния.
    @ConfigProperty(name = "lore.qg.actions-projects")
    java.util.Optional<String> projectsConfig;

    /**
     * Значение конфига (фолбэк). Источник №1 — настройка админки
     * {@link #SETTING_CODE}, читается на каждом заходе ({@link #currentProjects()}).
     */
    String projectsCsv = "";

    /** Ключ настройки в админке (dict_type=app_setting, значение — label_ru). */
    static final String SETTING_CODE = "qg.actions_projects";

    static final String SOURCE_SETTING = "настройка app_setting/" + SETTING_CODE;
    static final String SOURCE_CONFIG  = "конфиг lore.qg.actions-projects";
    static final String SOURCE_NONE    = "не задан";

    /** Slug git-проекта: {@code owner/repo}, буквы/цифры/._- в обеих частях. */
    private static final Pattern SLUG = Pattern.compile("[A-Za-z0-9._-]+/[A-Za-z0-9._-]+");

    /**
     * Итог резолва: что опрашивать, что отброшено как мусор и откуда взято.
     * Непустой {@code rejected} — повод для WARN, а не молчаливого пропуска.
     */
    record Projects(List<String> projects, List<String> rejected, String source) {}

    /** Подпись последнего резолва — чтобы одно и то же не повторять в лог каждые N минут. */
    private String lastResolution;

    /** Сколько последних прогонов забирать за один заход. */
    @ConfigProperty(name = "lore.qg.actions-page-size", defaultValue = "30")
    int pageSize;

    @Inject
    ForgejoBridge forgejo;

    @Inject
    LoreQgRunWriter writer;

    /** Чтение настройки — тем же клиентом, что и {@code LoreAssetResource.setting}. */
    @Inject
    LoreIngestService ingestService;

    private ScheduledExecutorService poller;

    @PostConstruct
    void start() {
        projectsCsv = projectsConfig == null ? "" : projectsConfig.orElse("");
        if (!loreEnabled || !pollEnabled) return;
        // QG-09: расписание запускается ВСЕГДА, даже при пустом конфиге — список
        // теперь задаётся в админке и может появиться без рестарта. Пустоту
        // каждый заход проверяет сам и говорит о ней (pollQuietly).
        poller = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "lore-qg-actions-poll");
            t.setDaemon(true);
            return t;
        });
        // Первый заход с задержкой в один интервал: на старте приложения Forgejo
        // может быть ещё не поднят, а стартовать с предупреждения об ошибке —
        // приучать не читать предупреждения.
        poller.scheduleAtFixedRate(this::pollQuietly, pollMinutes, pollMinutes, TimeUnit.MINUTES);
        LOG.infof("[LORE QG] опрос прогонов Actions включён, раз в %d мин; проекты — настройка %s "
            + "в админке, иначе конфиг lore.qg.actions-projects (сейчас: «%s»)",
            pollMinutes, SETTING_CODE, projectsCsv);
    }

    /**
     * SPRINT_QG_REBUILD/QG-09: список проектов задаётся в админке. Порядок:
     * непустая активная настройка → она; иначе конфиг (обратная совместимость
     * с {@code LORE_QG_ACTIONS_PROJECTS}); иначе пусто.
     *
     * <p>Непустая настройка побеждает, даже если в ней один мусор: владелец явно
     * задал список, и тихо подменить его конфигом значило бы опрашивать не то,
     * что он видит в админке. Мусор при этом назван в {@code rejected}.
     *
     * <p>Чистая функция — без базы и Quarkus, правило проверяет
     * {@code QgActionsProjectsResolveTest}.
     */
    static Projects resolveProjects(String setting, String config) {
        List<String> fromSetting = items(setting);
        if (!fromSetting.isEmpty()) return validate(fromSetting, SOURCE_SETTING);
        List<String> fromConfig = items(config);
        if (!fromConfig.isEmpty()) return validate(fromConfig, SOURCE_CONFIG);
        return new Projects(List.of(), List.of(), SOURCE_NONE);
    }

    private static List<String> items(String csv) {
        if (csv == null) return List.of();
        List<String> out = new ArrayList<>();
        for (String s : csv.split(",")) {
            String v = s.trim();
            if (!v.isEmpty()) out.add(v);
        }
        return out;
    }

    private static Projects validate(List<String> items, String source) {
        List<String> ok = new ArrayList<>();
        List<String> bad = new ArrayList<>();
        for (String s : items) (SLUG.matcher(s).matches() ? ok : bad).add(s);
        return new Projects(List.copyOf(ok), List.copyOf(bad), source);
    }

    /**
     * Список на ТЕКУЩИЙ заход: правка в админке подхватывается со следующего
     * цикла, без рестарта. Отказ чтения настройки — WARN и конфиг: опрос не
     * падает и не молчит, а неизвестность настройки не выдаётся за её отсутствие.
     */
    Projects currentProjects() {
        String setting;
        try {
            List<Map<String, Object>> rows = ingestService.queryPublic(
                "SELECT label_ru FROM KnowDictEntry WHERE dict_type='app_setting' AND code=:c AND is_active=true",
                Map.of("c", SETTING_CODE));
            Object v = rows.isEmpty() ? null : rows.get(0).get("label_ru");
            setting = v == null ? null : v.toString();
        } catch (RuntimeException e) {
            LOG.warnf("[LORE QG] настройка %s не прочитана (%s) — на этот заход берём конфиг lore.qg.actions-projects",
                SETTING_CODE, LoreUpstream.detail(e));
            setting = null;
        }
        return resolveProjects(setting, projectsCsv);
    }

    @PreDestroy
    void stop() {
        if (poller != null) poller.shutdown();
    }

    private void pollQuietly() {
        Projects p;
        try {
            p = currentProjects();
        } catch (RuntimeException e) {
            // Исключение из расписания убило бы scheduleAtFixedRate навсегда.
            LOG.warnf("[LORE QG] список проектов для опроса Actions не определён: %s", e.getMessage());
            return;
        }
        String sig = p.source() + "|" + p.projects() + "|" + p.rejected();
        boolean changed = !sig.equals(lastResolution);
        lastResolution = sig;
        if (changed) {
            for (String bad : p.rejected())
                LOG.warnf("[LORE QG] «%s» из %s — не slug вида owner/repo, пропущен", bad, p.source());
            if (p.projects().isEmpty()) {
                LOG.warnf("[LORE QG] опрос прогонов Actions включён, но список проектов пуст (%s; задаётся "
                    + "настройкой %s в админке или lore.qg.actions-projects) — записей канала 1 не будет. "
                    + "Это НЕ то же самое, что «прогонов не было».", p.source(), SETTING_CODE);
            } else {
                LOG.infof("[LORE QG] опрос прогонов Actions: проекты %s (%s)", p.projects(), p.source());
            }
        }
        List<String> outcomes = new ArrayList<>();
        for (String s : p.projects()) {
            try {
                outcomes.add(s + ": " + pollProject(s));
            } catch (Exception e) {
                // Недоступный Forgejo — потеря метрики, а не работы пользователя.
                LOG.warnf("[LORE QG] опрос прогонов %s не удался: %s", s, e.getMessage());
                outcomes.add(s + ": ошибка");
            }
        }
        // Строка на КАЖДЫЙ заход (15.11.2026): без неё успешный проход и проход,
        // не увидевший настройку, неотличимы в журнале — оба молчат.
        LOG.info(passLine(p, outcomes));
    }

    /** Итог захода одной строкой: откуда список, что опрошено, сколько записано. Чистая функция. */
    static String passLine(Projects p, List<String> outcomes) {
        return "[LORE QG] заход опроса Actions: источник — " + p.source()
            + ", проектов " + p.projects().size()
            + (p.projects().isEmpty() ? " (записей канала 1 не будет)" : "")
            + (outcomes.isEmpty() ? "" : "; " + String.join("; ", outcomes));
    }

    /** @return итог по проекту словами — он попадает в строку захода. */
    String pollProject(String slug) throws Exception {
        Optional<ForgejoBridge.Repo> repo = forgejo.resolve(slug);
        if (repo.isEmpty()) {
            LOG.warnf("[LORE QG] проект %s не разрешается в репозиторий Forgejo — пропущен", slug);
            return "не разрешается в репозиторий Forgejo";
        }
        // page=1 обязателен: без него Forgejo 17 игнорирует limit и отдаёт ВЕСЬ список прогонов
        // (22.11.2026, апгрейд 15 → 17: /actions/runs?limit=3 вернул 10 391 запись, 180 МБ).
        // Сторож — ForgejoListPagingGuardTest.
        var resp = forgejo.api(repo.get(), "GET",
            "/repos/" + repo.get().owner() + "/" + repo.get().name()
                + "/actions/runs?page=1&limit=" + pageSize, null);
        if (resp.statusCode() != 200) {
            LOG.warnf("[LORE QG] Forgejo вернул %d на список прогонов %s", resp.statusCode(), slug);
            return "Forgejo вернул " + resp.statusCode();
        }
        JsonObject body = new JsonObject(resp.body());
        JsonArray all = body.getJsonArray("workflow_runs", new JsonArray());
        // Обрезка остаётся страховкой, хотя page=1 выше уже ограничивает ответ: 15.11.2026 на проде
        // Forgejo при limit=30 вернул 8068 прогонов, и полагаться на то, что сервер соблюдает limit,
        // мы больше не хотим. Заход разбирает не больше страницы — новые первыми, остальное уже записано.
        JsonArray runs = pageOf(all, pageSize);
        if (all.size() > runs.size()) {
            LOG.debugf("[LORE QG] Forgejo вернул %d прогонов при limit=%d — взяты первые %d",
                all.size(), pageSize, runs.size());
        }
        int written = 0;
        for (int i = 0; i < runs.size(); i++) {
            if (recordRun(slug, runs.getJsonObject(i))) written++;
        }
        return "записано прогонов " + written + " из " + runs.size();
    }

    /** @return true если прогон записан; false если он ещё идёт и записывать нечего. */
    private boolean recordRun(String slug, JsonObject run) {
        String status = run.getString("status", "");
        // Идущий прогон не записываем: его исход ещё не определён, а запись с
        // выдуманным исходом хуже её отсутствия. На следующем заходе он будет готов.
        if (!"success".equals(status) && !"failure".equals(status) && !"cancelled".equals(status)) return false;

        String workflow = run.getString("workflow_id", "unknown");
        String routine = "qg-ci-" + workflow.replaceAll("\\.ya?ml$", "").replaceAll("[^A-Za-z0-9_-]", "-");
        RunFields f = runFields(run);
        String runDate = f.runDate();
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
            f.startedAt(),
            f.finishedAt(),
            f.url(),
            f.sha(),
            f.pr());

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
        String b = str(run, "prettyref", "head_branch");
        if (b == null) b = "";
        if (b.startsWith("#")) {
            try { return Integer.valueOf(b.substring(1)); } catch (NumberFormatException ignored) { }
        }
        return null;
    }

    /**
     * Поля прогона, которые идут в запись гейта. Forgejo отдаёт ActionRun в своей форме:
     * {@code created/updated/started/stopped}, {@code commit_sha}, {@code html_url}, {@code prettyref}
     * (swagger, схема ActionRun). Код читал форму GitHub ({@code *_at}, {@code head_sha}, {@code url}),
     * и 15.11.2026 на проде каждый прогон уходил «без даты» — канал 1 не записал ни одного.
     * Форма GitHub оставлена запасной: forgejo-mcp и старые фикстуры отдают её.
     *
     * @param runDate дата прогона (YYYY-MM-DD) по завершению → обновлению → созданию; нет ни одной — null
     */
    record RunFields(String runDate, String startedAt, String finishedAt, String url, String sha, Integer pr) {}

    static RunFields runFields(JsonObject run) {
        String finished = str(run, "stopped", "updated", "updated_at");
        String dateSrc = finished != null ? finished : str(run, "created", "created_at");
        String runDate = dateSrc != null && dateSrc.length() >= 10 ? dateSrc.substring(0, 10) : null;
        return new RunFields(
            runDate,
            str(run, "started", "run_started_at", "created", "created_at"),
            finished,
            str(run, "html_url", "url"),
            str(run, "commit_sha", "head_sha"),
            prNumber(run));
    }

    /** Первое непустое строковое поле из перечисленных; нет — null. */
    private static String str(JsonObject o, String... keys) {
        for (String k : keys) {
            Object v = o.getValue(k);
            if (v instanceof String s && !s.isBlank()) return s;
        }
        return null;
    }

    /** Не больше {@code size} первых прогонов; {@code size ≤ 0} — без обрезки. */
    static JsonArray pageOf(JsonArray runs, int size) {
        if (size <= 0 || runs.size() <= size) return runs;
        JsonArray out = new JsonArray();
        for (int i = 0; i < size; i++) out.add(runs.getValue(i));
        return out;
    }
}
