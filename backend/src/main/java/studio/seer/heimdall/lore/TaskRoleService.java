package studio.seer.heimdall.lore;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Единственная точка записи роли на задаче (ADR-LORE-042, TR-04/TR-06).
 *
 * <p>Отдельный бин, а не метод ресурса, по той же причине, что у
 * {@link LoreQgRunWriter}: писать роль будут и HTTP-эндпоинт, и путь создания
 * задачи. Скопировать правила во второе место значило бы завести вторую правду
 * о том, что считается корректным назначением, — а расхождение двух правд и
 * есть тот класс дефекта, ради которого роли уезжают из поля в ребро.
 *
 * <p>Правила живут в {@link TaskRoleWriter} и БЕЗ базы: здесь только сбор
 * фактов из графа и применение решения. Поэтому правила проверяются тестом, а
 * не прогоном, а этот класс остаётся тонким.
 */
@ApplicationScoped
public class TaskRoleService {

    private static final Logger LOG = Logger.getLogger(TaskRoleService.class);

    @ConfigProperty(name = "lore.db", defaultValue = "system_aida_lore")
    String db;

    @Inject
    MartCredentials mart;

    @Inject
    LoreIngestService ingest;

    @Inject
    @RestClient
    LoreCommandClient writeClient;

    /** Запрос назначения. Сырое написание допустимо: оно сводится таблицей. */
    public record RoleRequest(String task_uid, String role, String identity,
                              String profile, String model,
                              String verdict, String feedback_md) {}

    /**
     * Итог. Ответ по ADR-LORE-043 собирает {@link TaskRoleWriter#describe} —
     * здесь только признак «отказ или нет», чтобы ресурс выбрал код HTTP.
     */
    public record Result(boolean applied, Map<String, Object> body) {}

    public Result apply(RoleRequest req) {
        if (req == null || req.task_uid() == null || req.task_uid().isBlank()) {
            return refusal("не указана задача (task_uid)");
        }
        final String uid = req.task_uid();
        final String role = req.role();

        // Существование задачи проверяется ДО всего: CREATE EDGE с пустым FROM
        // в ArcadeDB — тихий no-op, и без этой проверки ответ был бы «создано»
        // при отсутствии ребра. Ровно эта ловушка стоила шага миграции.
        if (!exists("SELECT count(*) AS n FROM KnowTask WHERE task_uid = :u", Map.of("u", uid))) {
            return refusal("задачи " + uid + " нет. Задача пишется как 'СПРИНТ/КОД' — "
                + "одинокий код принадлежит многим спринтам сразу.");
        }

        // Сырое написание сводится к личности, а не отвергается: 3676 записей
        // корпуса написаны именно так, и требовать канонического имени от
        // вызывающего значило бы просто перенести угадывание на его сторону.
        String identity = req.identity();
        String profile = req.profile();
        String model = req.model();
        TaskRoleMapping.Target mapped = TaskRoleMapping.of(identity);
        if (mapped != null) {
            identity = mapped.identity();
            if (profile == null) profile = mapped.profile();
            if (model == null) model = mapped.model();
        }

        List<String> known = TaskRoleWriter.candidates(peopleOfTaskProject(uid), declaredAgents());
        List<String> holders = currentHolders(uid, role);

        TaskRoleWriter.Decision d = TaskRoleWriter.check(role, uid, identity, known, holders);
        if (d.verdict() == TaskRoleWriter.Verdict.REFUSE) {
            return new Result(false, TaskRoleWriter.describe(d, role, identity));
        }

        // Вердикт проверяется ОТДЕЛЬНО и тоже до записи: назначить роль и
        // отказать в отзыве значило бы записать половину — то есть полуправду
        // вместо отказа.
        TaskRoleWriter.Decision v = TaskRoleWriter.checkVerdict(role, req.verdict());
        if (v.verdict() == TaskRoleWriter.Verdict.REFUSE) {
            return new Result(false, TaskRoleWriter.describe(v, role, identity));
        }

        String now = Instant.now().toString();

        if (d.verdict() == TaskRoleWriter.Verdict.REPLACE) {
            // Мягкое удаление: прежнее ребро закрывается, а не стирается.
            // Поле отвечало только на «кто сейчас»; вопрос «сколько раз
            // передавали» был неотвечаем в принципе (ADR-LORE-042 §4).
            command("UPDATE ROLE_HELD_BY SET valid_to = :now "
                + "WHERE @out.task_uid = :u AND role = :r AND valid_to IS NULL",
                Map.of("now", now, "u", uid, "r", role));
        }

        if (d.verdict() == TaskRoleWriter.Verdict.UNCHANGED) {
            // Держатель тот же — ребро не трогаем, но отзыв ревьюера писать
            // надо: «тот же ревьюер вынес новый вердикт» — законный ход, и
            // отказ здесь заставил бы снимать и назначать ревьюера ради
            // повторной проверки.
            if (req.verdict() != null && !req.verdict().isBlank()) {
                command("UPDATE ROLE_HELD_BY SET verdict = :v, feedback_md = :f, reviewed_at = :now "
                    + "WHERE @out.task_uid = :u AND role = :r AND valid_to IS NULL",
                    LoreResourceBase.mapOfNullable("v", req.verdict(), "f", req.feedback_md(),
                        "now", now, "u", uid, "r", role));
                Map<String, Object> body = TaskRoleWriter.describe(d, role, identity);
                body.put("outcome", "updated");
                body.put("verdict", req.verdict());
                body.put("hint", "держатель тот же, записан новый вердикт ревью");
                return new Result(true, body);
            }
            return new Result(true, TaskRoleWriter.describe(d, role, identity));
        }

        // CREATE EDGE идёт через String.format, а не именованные параметры:
        // в этой сборке ArcadeDB они в CREATE EDGE не связываются (замерено;
        // тот же приём в доборе V36).
        StringBuilder set = new StringBuilder(" SET role = '").append(esc(role)).append('\'')
            .append(", valid_from = '").append(esc(now)).append('\'');
        if (profile != null) set.append(", profile = '").append(esc(profile)).append('\'');
        if (model != null) set.append(", model = '").append(esc(model)).append('\'');
        if (req.verdict() != null) {
            set.append(", verdict = '").append(esc(req.verdict())).append('\'')
               .append(", reviewed_at = '").append(esc(now)).append('\'');
        }
        if (req.feedback_md() != null) {
            set.append(", feedback_md = '").append(esc(req.feedback_md())).append('\'');
        }

        boolean agent = isAgent(identity);
        command(String.format(
            "CREATE EDGE ROLE_HELD_BY FROM (SELECT FROM KnowTask WHERE task_uid = '%s') "
            + "TO (SELECT FROM %s WHERE %s = '%s')%s",
            esc(uid), agent ? "KnowActor" : "KnowUser",
            agent ? "actor_id" : "display_name", esc(identity), set), Map.of());

        Map<String, Object> body = TaskRoleWriter.describe(d, role, identity);
        if (profile != null) body.put("profile", profile);
        if (model != null) body.put("model", model);
        if (req.verdict() != null) body.put("verdict", req.verdict());
        LOG.infof("[LORE ROLE] %s %s <- %s (%s)", uid, role, identity, body.get("outcome"));
        return new Result(true, body);
    }

    /**
     * Кандидаты-люди: те, у кого есть роль в проекте ЭТОЙ задачи.
     *
     * <p>Решение владельца: «пусть сверяется с ролями в проекте на людей».
     * Путь задача → спринт → проект, потому что проект висит на спринте, а не
     * на задаче: у задачи своего проекта нет и не должно быть.
     */
    List<String> peopleOfTaskProject(String taskUid) {
        List<String> out = new ArrayList<>();
        for (Map<String, Object> r : ingest.queryPublic(
                "SELECT @out.display_name AS person FROM HAS_PROJECT_ROLE WHERE @in.slug IN "
                + "(SELECT expand(out('PART_OF').out('BELONGS_TO_PROJECT').slug) FROM KnowTask "
                + "WHERE task_uid = :u)", Map.of("u", taskUid))) {
            Object p = r.get("person");
            if (p != null) out.add(String.valueOf(p));
        }
        return out;
    }

    /**
     * То же, но по спринту: на создании задачи её самой ещё нет, а проект
     * известен — он висит на спринте.
     */
    List<String> peopleOfSprintProject(String sprintId) {
        List<String> out = new ArrayList<>();
        for (Map<String, Object> r : ingest.queryPublic(
                "SELECT @out.display_name AS person FROM HAS_PROJECT_ROLE WHERE @in.slug IN "
                + "(SELECT expand(out('BELONGS_TO_PROJECT').slug) FROM KnowSprint "
                + "WHERE sprint_id = :s)", Map.of("s", sprintId))) {
            Object p = r.get("person");
            if (p != null) out.add(String.valueOf(p));
        }
        return out;
    }

    /**
     * Гейт создания задачи для АГЕНТА (решение владельца 30.08.2026):
     * «отсутствующие роли не записывать для агентов, а возвращать ошибку
     * записи задачи, пока не исправится».
     *
     * <p>Почему отказом, а не пометкой в вердикте полноты. Вердикт советует, и
     * это правильно там, где пропуск честнее выдумки: оценку в днях лучше не
     * ставить, чем поставить мусорную. С ролью наоборот — её не «не знают», её
     * не пишут, потому что можно не писать. Задача без автора и исполнителя
     * уходит в корпус и остаётся там навсегда: 4114 заполненных значений и 438
     * неразбираемых накопились именно так, по одной необязательной записи.
     *
     * <p>Гейт только для агентов. Человек ставит роль в форме, видя список, и
     * отказ ему мешал бы: он может завести задачу до того, как решено, кто её
     * делает. У агента такого случая нет — он пишет из сценария, где обе роли
     * известны, а «пока не знаю» на деле означает «не стал указывать».
     *
     * @return причина отказа либо {@code null}, если писать можно
     */
    public String refuseCreateForAgent(String sprintId, String author, String executor) {
        return TaskRoleWriter.refuseCreate(author, executor,
            TaskRoleWriter.candidates(peopleOfSprintProject(sprintId), declaredAgents()));
    }

    /** Заявленные агентные личности. Спрашиваем граф, а не таблицу сопоставления. */
    List<String> declaredAgents() {
        List<String> out = new ArrayList<>();
        for (Map<String, Object> r : ingest.queryPublic("SELECT actor_id FROM KnowActor", Map.of())) {
            Object a = r.get("actor_id");
            if (a != null) out.add(String.valueOf(a));
        }
        return out;
    }

    /** Активные держатели роли: ребро с открытым valid_to — как открытая строка истории. */
    List<String> currentHolders(String taskUid, String role) {
        List<String> out = new ArrayList<>();
        for (Map<String, Object> r : ingest.queryPublic(
                "SELECT @in.display_name AS person, @in.actor_id AS agent FROM ROLE_HELD_BY "
                + "WHERE @out.task_uid = :u AND role = :r AND valid_to IS NULL",
                Map.of("u", taskUid, "r", role == null ? "" : role))) {
            Object who = r.get("agent") != null ? r.get("agent") : r.get("person");
            if (who != null) out.add(String.valueOf(who));
        }
        return out;
    }

    private boolean isAgent(String identity) {
        return exists("SELECT count(*) AS n FROM KnowActor WHERE actor_id = :i", Map.of("i", identity));
    }

    private boolean exists(String sql, Map<String, Object> params) {
        List<Map<String, Object>> rows = ingest.queryPublic(sql, params);
        if (rows.isEmpty()) return false;
        Object n = rows.get(0).get("n");
        return n instanceof Number num && num.longValue() > 0;
    }

    private void command(String sql, Map<String, Object> params) {
        writeClient.command(db, mart.basicAuth(),
            new LoreCommandClient.LoreCommand("sql", sql, params)).await().indefinitely();
    }

    private static Result refusal(String why) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("outcome", "noop");
        body.put("reason", why);
        return new Result(false, body);
    }

    private static String esc(String v) { return v == null ? null : v.replace("'", "\\'"); }
}
