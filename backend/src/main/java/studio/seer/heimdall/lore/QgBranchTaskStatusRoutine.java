package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Ветки репозитория ↔ статусы задач (SPRINT_QG_REBUILD/QG-BRANCH-TASK-STATUS, по ADR-LORE-053).
 *
 * <p>Повод — выпуск v1.17.21fix 15.11.2026: отчёт «какие задачи фикса не приняты»
 * собирали руками, и в ветке релиза нашёлся код задач в IN PROGRESS, BLOCKED, PARTIAL.
 * Ветка знает, что в ней лежит, LORE — в каком состоянии задачи; рутина их сверяет.
 *
 * <p>Состав ветки — коммиты от последнего опубликованного релиза до головы ветки,
 * запросом к Forgejo в момент проверки (ветку сущностью LORE не ведём). Задачи —
 * коды {@code SPRINT_X/CODE} в сообщениях коммитов. По каждой ветке три метрики,
 * все — WARN, не FAIL (слово владелицы: «пока только предупреждением»; ADR-LORE-053-D9):
 * <ul>
 *   <li>{@code branch_<b>_tasks_not_accepted} — задачи не в rfd / uat / review / done; список — в source;</li>
 *   <li>{@code branch_<b>_tasks_unknown} — кода из коммита нет в LORE;</li>
 *   <li>{@code branch_<b>_commits_without_task} — коммиты (не слияния) без кода задачи:
 *       неизвестно ≠ всё в порядке.</li>
 * </ul>
 * Forgejo не ответил → NOT_MEASURED source_unreachable.
 */
@ApplicationScoped
public class QgBranchTaskStatusRoutine implements QgRoutine {

    private static final Logger LOG = Logger.getLogger(QgBranchTaskStatusRoutine.class);

    static final String NAME = "qg-branch-task-status";

    /** Код задачи в тексте: {@code SPRINT_X/CODE}, в том числе внутри {@code [[task:…]]}. */
    static final Pattern TASK_UID = Pattern.compile("(SPRINT_[A-Z0-9_]+/[A-Z0-9][A-Z0-9_-]*[A-Z0-9])");

    /** Слияние PR и прочие технические коммиты — не работа, задачу не несут. */
    private static final Pattern MERGE = Pattern.compile("^(Merge (pull request|branch|remote-tracking branch)|merge:)",
        Pattern.CASE_INSENSITIVE);

    /** Принятые: ждёт выкатки, на приёмке, на проверке, закрыта (слово владелицы: «rfd или uat или done»). */
    private static final Set<String> ACCEPTED = Set.of("ready_for_deploy", "uat", "review", "done");

    @Inject
    ForgejoBridge forgejo;

    @Inject
    LoreIngestService ingest;

    @ConfigProperty(name = "lore.qg.branch-status.project", defaultValue = "NooriUta/UnlimitedLORE")
    String project;

    @ConfigProperty(name = "lore.qg.branch-status.branches", defaultValue = "preprod,main")
    String branchesCsv;

    @Override public String name() { return NAME; }

    @Override public Duration cadence() { return Duration.ofDays(1); }

    @Override
    public Precondition check() {
        try {
            return forgejo.resolve(project).isPresent() ? Precondition.ok() : Precondition.notMeasured("source_missing");
        } catch (RuntimeException e) {
            return Precondition.notMeasured("source_unreachable");
        }
    }

    @Override
    public List<RawFact> collect() {
        List<RawFact> out = new ArrayList<>();
        Optional<ForgejoBridge.Repo> repo = forgejo.resolve(project);
        String base = repo.isEmpty() ? null : lastReleaseTag(repo.get());
        for (String b : branchesCsv.split(",")) {
            String branch = b.trim();
            if (branch.isEmpty()) continue;
            List<String> messages = repo.isEmpty() || base == null ? null : commitMessages(repo.get(), base, branch);
            Map<String, String> status = messages == null ? Map.of() : statuses(taskUids(messages));
            out.addAll(facts(branch, messages, status));
        }
        return out;
    }

    /** Тег последнего опубликованного релиза или {@code null}, если Forgejo не ответил. */
    String lastReleaseTag(ForgejoBridge.Repo repo) {
        try {
            // page=1 обязателен: Forgejo 17 игнорирует limit без page — «дай последний релиз» превращается
            // в «дай все» (находка апгрейда 22.11.2026; сторож ForgejoListPagingGuardTest).
            var resp = forgejo.api(repo, "GET", "/repos/" + repo.path() + "/releases?draft=false&page=1&limit=1", null);
            if (resp.statusCode() != 200) {
                LOG.warnf("[QG %s] Forgejo вернул %d на список релизов", NAME, resp.statusCode());
                return null;
            }
            JsonArray arr = new JsonArray(resp.body());
            return arr.isEmpty() ? null : arr.getJsonObject(0).getString("tag_name");
        } catch (Exception e) {
            LOG.warnf("[QG %s] список релизов не получен: %s", NAME, e.getClass().getSimpleName());
            return null;
        }
    }

    /** Сообщения коммитов {@code base..branch} или {@code null}, если Forgejo не ответил. */
    List<String> commitMessages(ForgejoBridge.Repo repo, String base, String branch) {
        try {
            String range = URLEncoder.encode(base, StandardCharsets.UTF_8) + "..."
                + URLEncoder.encode(branch, StandardCharsets.UTF_8);
            var resp = forgejo.api(repo, "GET", "/repos/" + repo.path() + "/compare/" + range, null);
            if (resp.statusCode() != 200) {
                LOG.warnf("[QG %s] Forgejo вернул %d на сравнение %s…%s", NAME, resp.statusCode(), base, branch);
                return null;
            }
            JsonArray commits = new JsonObject(resp.body()).getJsonArray("commits", new JsonArray());
            List<String> out = new ArrayList<>();
            for (int i = 0; i < commits.size(); i++) {
                JsonObject c = commits.getJsonObject(i).getJsonObject("commit", new JsonObject());
                out.add(c.getString("message", ""));
            }
            return out;
        } catch (Exception e) {
            LOG.warnf("[QG %s] сравнение %s…%s не получено: %s", NAME, base, branch, e.getClass().getSimpleName());
            return null;
        }
    }

    /** Текущий статус по каждому найденному коду. Кода нет в LORE — его нет и в ответе. */
    Map<String, String> statuses(Set<String> uids) {
        if (uids.isEmpty()) return Map.of();
        Map<String, String> out = new HashMap<>();
        List<Map<String, Object>> rows = ingest.queryPublic(
            "SELECT task_uid, out('HAS_STATE')[valid_to IS NULL].status_raw[0] AS status_raw "
                + "FROM KnowTask WHERE task_uid IN :uids",
            Map.of("uids", new ArrayList<>(uids)));
        for (Map<String, Object> r : rows) {
            Object st = r.get("status_raw");
            out.put(String.valueOf(r.get("task_uid")), st == null ? null : st.toString());
        }
        return out;
    }

    static Set<String> taskUids(List<String> messages) {
        Set<String> out = new LinkedHashSet<>();
        for (String m : messages) {
            if (m == null) continue;
            Matcher x = TASK_UID.matcher(m);
            while (x.find()) out.add(x.group(1));
        }
        return out;
    }

    static boolean accepted(String statusRaw) {
        return ACCEPTED.contains(LoreStatusVocabulary.classify(statusRaw));
    }

    /**
     * Чистая функция: сообщения коммитов ветки и статусы задач → три факта.
     * {@code messages == null} — Forgejo не ответил: факты без значения.
     */
    static List<RawFact> facts(String branch, List<String> messages, Map<String, String> statusByUid) {
        String p = "branch_" + branch.replaceAll("[^A-Za-z0-9]", "_") + "_";
        String src = "forgejo:compare(last release…" + branch + ")";
        if (messages == null) return List.of(
            new RawFact(p + "tasks_not_accepted", null, src),
            new RawFact(p + "tasks_unknown", null, src),
            new RawFact(p + "commits_without_task", null, src));

        Set<String> uids = taskUids(messages);
        Set<String> notAccepted = new TreeSet<>(), unknown = new TreeSet<>();
        for (String u : uids) {
            if (!statusByUid.containsKey(u)) unknown.add(u);
            else if (!accepted(statusByUid.get(u))) notAccepted.add(u + " — " + statusByUid.get(u));
        }
        int withoutTask = 0;
        for (String m : messages) {
            if (m == null || MERGE.matcher(m.strip()).find()) continue;
            if (!TASK_UID.matcher(m).find()) withoutTask++;
        }
        return List.of(
            new RawFact(p + "tasks_not_accepted", notAccepted.size(), src + listed(notAccepted)),
            new RawFact(p + "tasks_unknown", unknown.size(), src + listed(unknown)),
            new RawFact(p + "commits_without_task", withoutTask, src + " · коммитов " + messages.size()));
    }

    private static String listed(Set<String> items) {
        if (items.isEmpty()) return "";
        List<String> head = new ArrayList<>(items).subList(0, Math.min(items.size(), 30));
        return " · " + String.join("; ", head) + (items.size() > head.size() ? "; …ещё " + (items.size() - head.size()) : "");
    }

    @Override
    public List<LoreQgResource.QGMetricEntry> normalize(List<RawFact> raw) {
        return normalizeFacts(raw);
    }

    static List<LoreQgResource.QGMetricEntry> normalizeFacts(List<RawFact> raw) {
        List<LoreQgResource.QGMetricEntry> out = new ArrayList<>();
        for (RawFact f : raw) out.add(QgSliceCounts.count(f.key(), f.value(), f.source(), "WARN"));
        return out;
    }
}
