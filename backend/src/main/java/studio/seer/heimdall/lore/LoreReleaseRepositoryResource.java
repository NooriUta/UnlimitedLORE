package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.net.URI;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * Миграция «релиз → репозиторий» ([[adr:ADR-LORE-066]] фаза А, {@link LoreReleaseRepositoryMigration}). Только admin.
 * <ul>
 *   <li>{@code GET /lore/release-repository/migrate} — сухой прогон: план, неоднозначные, нерешённые,
 *       непроверенные (Forgejo не ответил) и Release в Forgejo без записи в LORE. Ничего не пишет.</li>
 *   <li>{@code POST …/migrate?apply=true} — ставит рёбра RELEASE_OF по плану, построенному заново.
 *       Старые рёбра к проекту не трогает. Есть провалы — 207.</li>
 * </ul>
 */
@Path("/lore/release-repository")
public class LoreReleaseRepositoryResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreReleaseRepositoryResource.class);
    private static final int PAGE = 50, MAX_PAGES = 40;

    static final String RELEASES_SQL =
        "SELECT release_uid, release_id, git_tag, release_date, out('BELONGS_TO_PROJECT').slug AS projects FROM KnowRelease";
    static final String REPOS_SQL =
        "SELECT url, host, owner, name, in('MIRRORED_TO').url AS mirror_of FROM KnowRepository";
    static final String PROJECTS_SQL =
        "SELECT slug, hosts, out('HAS_REPOSITORY').url AS repos FROM KnowGitProject";
    static final String EXISTING_SQL =
        "SELECT @out.release_uid AS u, @in.url AS r FROM " + LoreReleaseRepositoryMigration.EDGE;

    @Inject
    ForgejoBridge forgejo;


    @GET
    @Path("migrate")
    @Produces(MediaType.APPLICATION_JSON)
    public Response plan(@HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (!forgejo.configured()) return badParams("мост к Forgejo не настроен — чей релиз, проверить нечем");
        try {
            return noStore(Response.ok(currentPlan().toMap()));
        } catch (Exception e) {
            LOG.warnf("[LORE RELEASE-REPO] dry-run: %s", e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }

    @POST
    @Path("migrate")
    @Produces(MediaType.APPLICATION_JSON)
    public Response apply(@QueryParam("apply") String apply, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (apply == null || !"true".equalsIgnoreCase(apply.trim()))
            return badParams("применение — только с явным apply=true; сухой прогон — GET …/migrate");
        if (!forgejo.configured()) return badParams("мост к Forgejo не настроен — чей релиз, проверить нечем");
        LoreReleaseRepositoryMigration.Plan plan;
        try {
            plan = currentPlan();
        } catch (Exception e) {
            LOG.warnf("[LORE RELEASE-REPO] plan: %s", e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
        int created = 0;
        List<Map<String, Object>> failed = new ArrayList<>();
        for (LoreReleaseRepositoryMigration.Item it : plan.items()) {
            if (it.exists()) continue;
            try {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE " + LoreReleaseRepositoryMigration.EDGE
                        + " FROM (SELECT FROM KnowRelease WHERE release_uid=:u) TO (SELECT FROM KnowRepository WHERE url=:r)"
                        + " IF NOT EXISTS SET basis=:b, forgejo_release=:f",
                    Map.of("u", it.uid(), "r", it.repo(), "b", it.basis(), "f", it.formalized()))).await().indefinitely();
                if (!edgeExists(it.uid(), it.repo())) throw new IllegalStateException("ребро после создания не читается");
                created++;
            } catch (RuntimeException e) {
                Map<String, Object> f = it.toMap();
                f.put("error", e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
                failed.add(f);
            }
        }
        Map<String, Object> out = new LinkedHashMap<>(plan.toMap());
        out.put("dry_run", false);
        out.put("created", created);
        out.put("failed", failed.size());
        out.put("failed_items", failed);
        LOG.infof("[LORE RELEASE-REPO] apply: resolved=%d created=%d failed=%d unresolved=%d ambiguous=%d unchecked=%d",
            plan.items().size(), created, failed.size(), plan.unresolved().size(), plan.ambiguous().size(), plan.unchecked().size());
        return noStore(Response.status(failed.isEmpty() ? 200 : 207).entity(out));
    }

    private boolean edgeExists(String uid, String repo) {
        List<Map<String, Object>> n = ingestService.queryPublic(
            "SELECT count(*) AS n FROM " + LoreReleaseRepositoryMigration.EDGE + " WHERE @out.release_uid=:u AND @in.url=:r",
            Map.of("u", uid, "r", repo));
        return !n.isEmpty() && ((Number) n.get(0).getOrDefault("n", 0)).longValue() > 0;
    }

    LoreReleaseRepositoryMigration.Plan currentPlan() {
        List<LoreReleaseRepositoryMigration.Release> releases = new ArrayList<>();
        for (Map<String, Object> r : ingestService.queryPublic(RELEASES_SQL, Map.of()))
            releases.add(new LoreReleaseRepositoryMigration.Release(text(r.get("release_uid")), text(r.get("release_id")),
                text(r.get("git_tag")), text(r.get("release_date")), strings(r.get("projects"))));

        // Свой хостинг — хосты основных (primary) адресов проектов, не зеркал; имён хостов в коде нет
        // (SELF-PROVISION, noBakedHosts). Репозиторий-зеркало своим не бывает.
        List<Map<String, Object>> projectRows = ingestService.queryPublic(PROJECTS_SQL, Map.of());
        Set<String> ownHosts = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for (Map<String, Object> r : projectRows)
            for (String u : primaryBaseUrls(r.get("hosts"))) {
                try { ownHosts.add(URI.create(u).getHost()); } catch (RuntimeException ignored) { }
            }
        List<LoreReleaseRepositoryMigration.Repo> repos = new ArrayList<>();
        for (Map<String, Object> r : ingestService.queryPublic(REPOS_SQL, Map.of())) {
            String url = text(r.get("url"));
            if (url == null) continue;
            String path = text(r.get("owner")) + "/" + text(r.get("name"));
            List<String> mo = strings(r.get("mirror_of"));
            String host = text(r.get("host"));
            repos.add(new LoreReleaseRepositoryMigration.Repo(url, path, mo.isEmpty() && host != null && ownHosts.contains(host),
                mo.isEmpty() ? null : mo.get(0)));
        }

        Map<String, List<String>> projectRepos = new TreeMap<>();
        for (Map<String, Object> r : projectRows) {
            String slug = text(r.get("slug"));
            if (slug == null) continue;
            Set<String> urls = new TreeSet<>(strings(r.get("repos")));
            urls.addAll(primaryBaseUrls(r.get("hosts")));
            projectRepos.put(slug, List.copyOf(urls));
        }

        Set<String> existing = new HashSet<>();
        try {
            for (Map<String, Object> r : ingestService.queryPublic(EXISTING_SQL, Map.of()))
                existing.add(text(r.get("u")) + "|" + LoreReleaseRepositoryMigration.norm(text(r.get("r"))));
        } catch (RuntimeException e) {
            LOG.debugf("[LORE RELEASE-REPO] рёбер %s ещё нет: %s", LoreReleaseRepositoryMigration.EDGE, e.getMessage());
        }

        Map<String, LoreReleaseRepositoryMigration.Remote> remote = new LinkedHashMap<>();
        for (LoreReleaseRepositoryMigration.Repo repo : repos)
            if (repo.forgejo()) remote.put(LoreReleaseRepositoryMigration.norm(repo.url()), fetch(repo));
        return LoreReleaseRepositoryMigration.plan(releases, repos, projectRepos, remote, existing);
    }

    /** Теги и Release репозитория; null — Forgejo не ответил (не «пусто»). */
    private LoreReleaseRepositoryMigration.Remote fetch(LoreReleaseRepositoryMigration.Repo repo) {
        try {
            URI u = URI.create(repo.url());
            String[] seg = u.getPath().replaceAll("^/|/$", "").split("/");
            ForgejoBridge.Repo fr = new ForgejoBridge.Repo(u.getScheme() + "://" + u.getAuthority(), seg[seg.length - 2], seg[seg.length - 1]);
            Set<String> tags = names(fr, "/tags", "name");
            Set<String> releases = names(fr, "/releases?draft=false", "tag_name");
            if (tags == null || releases == null) return null;
            return new LoreReleaseRepositoryMigration.Remote(tags, releases);
        } catch (Exception e) {
            LOG.warnf("[LORE RELEASE-REPO] %s: %s", repo.url(), e.getMessage());
            return null;
        }
    }

    private Set<String> names(ForgejoBridge.Repo fr, String what, String field) throws Exception {
        Set<String> out = new TreeSet<>();
        
        for (int page = 1; page <= MAX_PAGES; page++) {
            // page обязателен: Forgejo 17 без page игнорирует limit (ForgejoListPagingGuardTest)
            HttpResponse<String> r = forgejo.api(fr, "GET", "/repos/" + fr.path() + (what.contains("?") ? what + "&page=" : what + "?page=") + page + "&limit=" + PAGE, null);
            if (r.statusCode() != 200) {
                LOG.warnf("[LORE RELEASE-REPO] %s%s: Forgejo %d", fr.path(), what, r.statusCode());
                return null;
            }
            JsonArray arr = new JsonArray(r.body());
            for (int i = 0; i < arr.size(); i++) {
                Object v = arr.getJsonObject(i).getValue(field);
                if (v != null) out.add(v.toString());
            }
            if (arr.size() < PAGE) return out;
        }
        LOG.warnf("[LORE RELEASE-REPO] %s%s: больше %d страниц — список не полный, считаю непроверенным", fr.path(), what, MAX_PAGES);
        return null;
    }

    static List<String> primaryBaseUrls(Object hostsRaw) {
        List<String> out = new ArrayList<>();
        if (hostsRaw == null) return out;
        try {
            JsonArray arr = hostsRaw instanceof JsonArray a ? a : new JsonArray(hostsRaw.toString());
            for (int i = 0; i < arr.size(); i++) {
                JsonObject h = arr.getJsonObject(i);
                if ("primary".equals(h.getString("role")) && h.getString("base_url") != null)
                    out.add(LoreReleaseRepositoryMigration.norm(h.getString("base_url")));
            }
        } catch (RuntimeException e) {
            LOG.debugf("[LORE RELEASE-REPO] hosts не разобран: %s", e.getMessage());
        }
        return out;
    }

    private static List<String> strings(Object o) {
        List<String> out = new ArrayList<>();
        if (o instanceof Iterable<?> it) { for (Object x : it) if (text(x) != null) out.add(text(x)); }
        else if (text(o) != null) out.add(text(o));
        return out;
    }

    private static String text(Object o) {
        if (o == null) return null;
        String s = String.valueOf(o).trim();
        return s.isEmpty() || "null".equals(s) ? null : s;
    }
}
