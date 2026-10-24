package studio.seer.heimdall.lore;

import io.quarkus.runtime.Startup;
import io.vertx.core.json.JsonArray;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.ConfigProvider;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;

import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;

/**
 * Текущий релиз проекта переключается по факту тега в репозитории
 * (task:SPRINT_LORE_SLICE_ERGONOMICS/SE-18, пункт 3).
 *
 * <p>Флаг {@code is_current} раньше двигали только руками или при создании
 * записи — тег, публикация и деплой его не трогали, и у четырёх проектов
 * «текущим» висел уехавший релиз. Шаг в CI потребовал бы отдельного токена
 * записи в LORE; вместо этого LORE сам смотрит в Forgejo тем же мостом, что
 * гейт слияния, — новых секретов нет.
 *
 * <p>Правило: текущий — релиз, чей тег стоит в репозитории <b>последним</b>
 * (Forgejo отдаёт теги от новых к старым). Поле {@code git_tag} может
 * опережать факт (план несёт имя тега заранее, ср. SE-09), поэтому истина —
 * список тегов, а не поле. Релиз с пустым {@code git_tag} узнаётся по
 * {@code release_id}, совпадающему с тегом.
 *
 * <p>Неизвестность — не повод менять: репозиторий не резолвится, Forgejo
 * ответил не 200, ни один тег не узнан, тега текущего релиза в списке нет — флаг остаётся как есть.
 *
 * <p>{@code @Startup} обязателен: ленивый бин, которого никто не внедряет, не
 * создаётся никогда (AO-08). Выключается {@code lore.release.current-sync.enabled=false}.
 */
@Startup
@ApplicationScoped
public class LoreReleaseCurrentReconciler {

    private static final Logger LOG = Logger.getLogger(LoreReleaseCurrentReconciler.class);

    /** Сколько последних тегов смотреть: текущий почти всегда среди первых. */
    static final int TAG_PAGE = 50;

    @ConfigProperty(name = "lore.enabled", defaultValue = "false")
    boolean loreEnabled;

    @ConfigProperty(name = "lore.release.current-sync.minutes", defaultValue = "10")
    int minutes;

    @ConfigProperty(name = "lore.db", defaultValue = "system_aida_lore")
    String db;

    @Inject
    ForgejoBridge forgejo;

    @Inject
    LoreIngestService ingest;

    @Inject
    MartCredentials mart;

    @Inject
    @RestClient
    LoreCommandClient writeClient;

    private ScheduledExecutorService pool;
    private boolean notConfiguredReported;

    record Rel(String releaseId, String gitTag) {}

    @PostConstruct
    void start() {
        if (!loreEnabled) return;
        if (!enabled(k -> ConfigProvider.getConfig().getOptionalValue(k, String.class))) {
            LOG.info("[LORE RELEASE] сверка текущего релиза по тегам выключена (lore.release.current-sync.enabled=false)");
            return;
        }
        pool = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "lore-release-current-sync");
            t.setDaemon(true);
            return t;
        });
        int every = Math.max(1, minutes);
        pool.scheduleAtFixedRate(this::runQuietly, 1, every, TimeUnit.MINUTES);
        LOG.infof("[LORE RELEASE] сверка текущего релиза по тегам Forgejo включена, раз в %d мин", every);
    }

    @PreDestroy
    void stop() {
        if (pool != null) pool.shutdownNow();
    }

    private void runQuietly() {
        try {
            run();
        } catch (Exception e) {
            LOG.warnf("[LORE RELEASE] сверка текущего релиза не удалась: %s", e.getMessage());
        }
    }

    void run() {
        if (!forgejo.configured()) {
            if (!notConfiguredReported) {
                notConfiguredReported = true;
                LOG.warn("[LORE RELEASE] сверка текущего релиза пропущена: мост к Forgejo не настроен "
                    + "(нет FORGEJO_API_TOKEN) — флаг is_current двигается только руками");
            }
            return;
        }
        for (Map<String, Object> row : ingest.queryPublic("SELECT slug FROM KnowGitProject", Map.of())) {
            Object slug = row.get("slug");
            if (slug != null) reconcile(slug.toString());
        }
    }

    private void reconcile(String gp) {
        Optional<ForgejoBridge.Repo> repo = forgejo.resolve(gp);
        if (repo.isEmpty()) return;   // не в нашем Forgejo — не знаем, не трогаем
        List<String> tags;
        try {
            HttpResponse<String> r = forgejo.api(repo.get(), "GET",
                "/repos/" + repo.get().path() + "/tags?limit=" + TAG_PAGE, null);
            if (r.statusCode() != 200) {
                LOG.debugf("[LORE RELEASE] %s: Forgejo ответил %d на список тегов — флаг не трогаю", gp, r.statusCode());
                return;
            }
            tags = tagNames(r.body());
        } catch (Exception e) {
            LOG.debugf("[LORE RELEASE] %s: список тегов не получен (%s) — флаг не трогаю", gp, e.getMessage());
            return;
        }
        List<Map<String, Object>> rows = ingest.queryPublic(
            "SELECT release_id, git_tag, is_current FROM KnowRelease WHERE git_project = :gp", Map.of("gp", gp));
        List<Rel> rels = new ArrayList<>();
        String current = null;
        for (Map<String, Object> r : rows) {
            String id = r.get("release_id") == null ? null : r.get("release_id").toString();
            if (id == null) continue;
            rels.add(new Rel(id, r.get("git_tag") == null ? null : r.get("git_tag").toString()));
            if (Boolean.TRUE.equals(r.get("is_current"))) current = id;
        }
        Optional<String> pick = pickCurrent(tags, rels, current);
        if (pick.isEmpty() || pick.get().equals(current)) return;
        writeClient.command(db, mart.basicAuth(), new LoreCommandClient.LoreCommand("sql",
            "UPDATE KnowRelease SET is_current=false WHERE is_current=true AND git_project = :gp",
            Map.of("gp", gp))).await().indefinitely();
        writeClient.command(db, mart.basicAuth(), new LoreCommandClient.LoreCommand("sql",
            "UPDATE KnowRelease SET is_current=true WHERE release_id = :rid AND git_project = :gp",
            Map.of("rid", pick.get(), "gp", gp))).await().indefinitely();
        LOG.infof("[LORE RELEASE] %s: текущий релиз %s → %s (его тег последний в репозитории)",
            gp, current == null ? "—" : current, pick.get());
    }

    /**
     * Как {@link #pickCurrent(List, List)}, но флаг двигается только от текущего релиза,
     * чей тег в репозитории ЕСТЬ. Тега текущего нет (релиз без тега, тег в другом
     * репозитории или старше окна {@link #TAG_PAGE}) — неизвестно, новее ли выбранный,
     * и флаг не трогаем: иначе флаг уезжает НАЗАД (20.10: NooriUta/AIDA v1.8.0 → v1.7.2).
     */
    static Optional<String> pickCurrent(List<String> repoTagsNewestFirst, List<Rel> releases, String currentId) {
        if (currentId != null) {
            Rel cur = releases.stream().filter(r -> currentId.equals(r.releaseId())).findFirst().orElse(null);
            String curTag = cur == null || cur.gitTag() == null || cur.gitTag().isBlank() ? currentId : cur.gitTag();
            if (!repoTagsNewestFirst.contains(curTag)) return Optional.empty();
        }
        return pickCurrent(repoTagsNewestFirst, releases);
    }

    /** Первый тег репозитория (от новых к старым), у которого есть запись релиза. */
    static Optional<String> pickCurrent(List<String> repoTagsNewestFirst, List<Rel> releases) {
        for (String tag : repoTagsNewestFirst) {
            for (Rel r : releases) if (tag.equals(r.gitTag())) return Optional.of(r.releaseId());
            for (Rel r : releases)
                if ((r.gitTag() == null || r.gitTag().isBlank()) && tag.equals(r.releaseId())) return Optional.of(r.releaseId());
        }
        return Optional.empty();
    }

    static List<String> tagNames(String json) {
        JsonArray arr = new JsonArray(json);
        List<String> out = new ArrayList<>(arr.size());
        for (int i = 0; i < arr.size(); i++) {
            String n = arr.getJsonObject(i).getString("name");
            if (n != null && !n.isBlank()) out.add(n);
        }
        return out;
    }

    static boolean enabled(Function<String, Optional<String>> cfg) {
        return cfg.apply("lore.release.current-sync.enabled").map(String::trim).map(v -> !"false".equalsIgnoreCase(v)).orElse(true);
    }
}
