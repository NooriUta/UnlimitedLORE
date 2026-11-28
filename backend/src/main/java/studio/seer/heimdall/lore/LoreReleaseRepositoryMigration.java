package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * Миграция «релиз → репозиторий» ([[adr:ADR-LORE-066]], фаза А): каждому KnowRelease — ребро
 * {@link #EDGE} к KnowRepository, которому релиз принадлежит. Старые рёбра BELONGS_TO_PROJECT
 * не трогаются (их снятие — фаза Б, отдельным словом владелицы).
 *
 * <h2>Чей релиз (Д3, Д5)</h2>
 * Кандидаты — свои репозитории Forgejo: репозитории проекта релиза (primary-хосты {@code hosts[]}
 * и HAS_REPOSITORY) плюс репозиторий из префикса ключа «префикс#тег» (префикс — путь
 * {@code owner/name} в Forgejo или в зеркале GitHub). Тег — {@code git_tag}, затем {@code release_id}.
 * <ol>
 *   <li>Ровно один кандидат с объектом Release в Forgejo на этот тег — собственный оформленный релиз
 *       ({@code forgejo_release}).</li>
 *   <li>Release нет, но тег есть ровно в одном — {@code forgejo_tag}, «не оформлен в Forgejo».</li>
 *   <li>Ни тега, ни Release — репозиторий префикса ({@code uid_prefix}) или единственный репозиторий
 *       проекта ({@code project_single_repo}), «не оформлен в Forgejo».</li>
 *   <li>Несколько совпадений — побеждает репозиторий префикса; иначе {@code ambiguous} в отчёт.</li>
 *   <li>Ничего — {@code unresolved} в отчёт. Связь не выдумывается.</li>
 * </ol>
 * Обратное направление: объект Release в Forgejo, которому не нашлось записи в LORE, —
 * {@code missing_in_lore} (так у сайта пропущен v1.1.1). Записи миграция не создаёт: это находка.
 *
 * <p>Репозиторий, у которого Forgejo не отдал списки, считается «не проверенным», а не «пустым»:
 * релизы с ним в кандидатах идут в {@code unchecked}, а не решаются по префиксу.
 */
final class LoreReleaseRepositoryMigration {

    static final String MIGRATION_ID = "release-of-repository";
    static final String EDGE = "RELEASE_OF";

    private LoreReleaseRepositoryMigration() { }

    record Release(String uid, String releaseId, String gitTag, String releaseDate, List<String> projects) { }

    /** Репозиторий: url — ключ KnowRepository; path — owner/name; forgejo — свой ли хостинг; mirrorOf — url оригинала. */
    record Repo(String url, String path, boolean forgejo, String mirrorOf) { }

    /** Что знает Forgejo о репозитории. {@code null} в карте — списки не получены. */
    record Remote(Set<String> tags, Set<String> releases) { }

    record Item(String uid, String repo, String basis, boolean formalized, String tag, boolean exists) {
        Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("release_uid", uid);
            m.put("repository", repo);
            m.put("basis", basis);
            m.put("forgejo_release", formalized);
            m.put("tag", tag);
            m.put("edge_exists", exists);
            return m;
        }
    }

    record Plan(List<Item> items, List<Map<String, Object>> ambiguous, List<Map<String, Object>> unresolved,
                List<Map<String, Object>> unchecked, List<Map<String, Object>> missingInLore,
                List<String> uncheckedRepos) {

        int toCreate() { return (int) items.stream().filter(i -> !i.exists()).count(); }

        Map<String, Object> toMap() {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("migration_id", MIGRATION_ID);
            out.put("dry_run", true);
            out.put("edge", EDGE);
            out.put("resolved", items.size());
            out.put("to_create", toCreate());
            out.put("already", items.size() - toCreate());
            // счёты раньше списков — их берёт разбор в workflow (первое вхождение поля)
            out.put("ambiguous_count", ambiguous.size());
            out.put("unresolved_count", unresolved.size());
            out.put("unchecked_count", unchecked.size());
            out.put("missing_in_lore_count", missingInLore.size());
            Map<String, Integer> byBasis = new TreeMap<>();
            Map<String, Integer> byRepo = new TreeMap<>();
            for (Item i : items) {
                byBasis.merge(i.basis(), 1, Integer::sum);
                byRepo.merge(i.repo(), 1, Integer::sum);
            }
            out.put("by_basis", byBasis);
            out.put("by_repository", byRepo);
            out.put("ambiguous", ambiguous);
            out.put("unresolved", unresolved);
            out.put("unchecked", unchecked);
            out.put("unchecked_repositories", uncheckedRepos);
            out.put("missing_in_lore", missingInLore);
            out.put("items", items.stream().map(Item::toMap).toList());
            return out;
        }
    }

    /**
     * План.
     *
     * @param releases     все релизы
     * @param repos        все репозитории
     * @param projectRepos slug проекта → url его репозиториев (primary-хосты и HAS_REPOSITORY)
     * @param remote       url своего репозитория → данные Forgejo; значение null — не получены
     * @param existing     уже стоящие рёбра, «release_uid|url»
     */
    static Plan plan(List<Release> releases, List<Repo> repos, Map<String, List<String>> projectRepos,
                     Map<String, Remote> remote, Set<String> existing) {
        Map<String, Repo> byUrl = new LinkedHashMap<>();
        for (Repo r : repos) byUrl.put(norm(r.url()), r);
        // путь owner/name → url своего (Forgejo) репозитория; путь зеркала ведёт на оригинал
        Map<String, String> ownByPath = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        for (Repo r : repos) if (r.forgejo()) ownByPath.put(r.path(), norm(r.url()));
        for (Repo r : repos) {
            if (r.forgejo() || r.mirrorOf() == null) continue;
            Repo orig = byUrl.get(norm(r.mirrorOf()));
            if (orig != null && orig.forgejo()) ownByPath.putIfAbsent(r.path(), norm(orig.url()));
        }

        List<Item> items = new ArrayList<>();
        List<Map<String, Object>> ambiguous = new ArrayList<>(), unresolved = new ArrayList<>(), unchecked = new ArrayList<>();
        // url → теги, разобранные на этот репозиторий (для обратной сверки)
        Map<String, Set<String>> claimed = new TreeMap<>();

        for (Release rel : releases) {
            if (rel.uid() == null) continue;
            String prefix = rel.uid().contains("#") ? rel.uid().substring(0, rel.uid().indexOf('#')) : null;
            String prefixRepo = prefix == null ? null : ownByPath.get(prefix);
            Set<String> cands = new LinkedHashSet<>();
            if (prefixRepo != null) cands.add(prefixRepo);
            for (String p : rel.projects() == null ? List.<String>of() : rel.projects())
                for (String u : projectRepos.getOrDefault(p, List.of())) {
                    Repo r = byUrl.get(norm(u));
                    if (r != null && r.forgejo()) cands.add(norm(r.url()));
                }
            List<String> tags = new ArrayList<>();
            if (blank(rel.gitTag()) != null) tags.add(rel.gitTag().trim());
            if (blank(rel.releaseId()) != null && !tags.contains(rel.releaseId().trim())) tags.add(rel.releaseId().trim());

            List<String> notChecked = cands.stream().filter(u -> remote.get(u) == null).toList();
            String pickedRepo = null, basis = null, tag = null;
            boolean formalized = false;
            List<String> conflict = null;
            outer:
            for (String t : tags) {
                List<String> withRel = cands.stream().filter(u -> remote.get(u) != null && remote.get(u).releases().contains(t)).toList();
                List<String> withTag = cands.stream().filter(u -> remote.get(u) != null && remote.get(u).tags().contains(t)).toList();
                for (var pair : List.of(Map.entry("forgejo_release", withRel), Map.entry("forgejo_tag", withTag))) {
                    List<String> hit = pair.getValue();
                    if (hit.isEmpty()) continue;
                    String one = hit.size() == 1 ? hit.get(0) : hit.contains(prefixRepo) ? prefixRepo : null;
                    if (one == null) { conflict = hit; tag = t; break outer; }
                    pickedRepo = one; basis = pair.getKey(); tag = t;
                    formalized = "forgejo_release".equals(basis);
                    break outer;
                }
            }
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("release_uid", rel.uid());
            row.put("tags", tags);
            row.put("projects", rel.projects());
            row.put("candidates", List.copyOf(cands));
            if (conflict != null) {
                row.put("matches", conflict);
                ambiguous.add(row);
                continue;
            }
            if (pickedRepo == null) {
                if (!notChecked.isEmpty()) {
                    row.put("not_checked", notChecked);
                    unchecked.add(row);
                    continue;
                }
                if (prefixRepo != null) { pickedRepo = prefixRepo; basis = "uid_prefix"; }
                else if (cands.size() == 1) { pickedRepo = cands.iterator().next(); basis = "project_single_repo"; }
                else {
                    row.put("reason", cands.isEmpty() ? "нет своего репозитория ни у проекта, ни по префиксу" : "тега нет ни в одном из репозиториев проекта");
                    unresolved.add(row);
                    continue;
                }
                tag = tags.isEmpty() ? null : tags.get(0);
            }
            items.add(new Item(rel.uid(), pickedRepo, basis, formalized, tag, existing.contains(rel.uid() + "|" + pickedRepo)));
            for (String t : tags) claimed.computeIfAbsent(pickedRepo, k -> new TreeSet<>()).add(t);
        }

        // Обратная сверка — только по репозиториям, к которым кто-то относится: проекты и префиксы.
        Set<String> scope = new TreeSet<>();
        for (List<String> us : projectRepos.values()) for (String u : us) {
            Repo r = byUrl.get(norm(u));
            if (r != null && r.forgejo()) scope.add(norm(r.url()));
        }
        for (Item i : items) scope.add(i.repo());
        List<Map<String, Object>> missing = new ArrayList<>();
        List<String> uncheckedRepos = new ArrayList<>();
        for (String u : scope) {
            Remote rm = remote.get(u);
            if (rm == null) { uncheckedRepos.add(u); continue; }
            for (String t : new TreeSet<>(rm.releases())) {
                if (claimed.getOrDefault(u, Set.of()).contains(t)) continue;
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("repository", u);
                m.put("tag", t);
                missing.add(m);
            }
        }
        return new Plan(List.copyOf(items), ambiguous, unresolved, unchecked, missing, uncheckedRepos);
    }

    // ── PR → репозиторий (ребро {@link #PR_EDGE}, доводка v7) ─────────────────────────────────────────────────
    // Репозиторий PR однозначен из его адреса: …/owner/repo/pulls/N (Forgejo) или …/pull/N (GitHub). Forgejo
    // не спрашивается. Адрес без /pulls/ или репозиторий, которого нет в LORE, — в отчёт; связь не выдумывается.

    static final String PR_EDGE = "PR_OF";

    record Pr(String uid, String url) { }

    record PrItem(String uid, String repo, boolean exists) {
        Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("pr_uid", uid);
            m.put("repository", repo);
            m.put("edge_exists", exists);
            return m;
        }
    }

    record PrPlan(List<PrItem> items, List<Map<String, Object>> unresolved) {
        int toCreate() { return (int) items.stream().filter(i -> !i.exists()).count(); }

        /** Счёты раньше списков — их берёт разбор в workflow (первое вхождение поля). */
        Map<String, Object> toMap() {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("prs_edge", PR_EDGE);
            out.put("prs_resolved", items.size());
            out.put("prs_to_create", toCreate());
            out.put("prs_already", items.size() - toCreate());
            out.put("prs_unresolved_count", unresolved.size());
            Map<String, Integer> byRepo = new TreeMap<>();
            for (PrItem i : items) byRepo.merge(i.repo(), 1, Integer::sum);
            out.put("prs_by_repository", byRepo);
            out.put("prs_unresolved", unresolved);
            return out;
        }
    }

    private static final java.util.regex.Pattern PR_PATH = java.util.regex.Pattern.compile("^(.+?)/pulls?/\\d+/?$");

    /** url репозитория по адресу PR (нормализованный); не адрес PR — null. */
    static String repoUrlOfPr(String prUrl) {
        if (blank(prUrl) == null) return null;
        java.util.regex.Matcher m = PR_PATH.matcher(prUrl.trim());
        return m.matches() ? norm(m.group(1)) : null;
    }

    /**
     * План PR_OF.
     *
     * @param prs      все PR (uid, адрес)
     * @param repoUrls url всех KnowRepository — ключ вершины, как есть
     * @param existing уже стоящие рёбра, «pr_uid|нормализованный url»
     */
    static PrPlan planPrs(List<Pr> prs, java.util.Collection<String> repoUrls, Set<String> existing) {
        Map<String, String> byNorm = new LinkedHashMap<>();
        for (String u : repoUrls) if (u != null) byNorm.putIfAbsent(norm(u).toLowerCase(java.util.Locale.ROOT), u);
        List<PrItem> items = new ArrayList<>();
        List<Map<String, Object>> unresolved = new ArrayList<>();
        for (Pr pr : prs) {
            if (pr.uid() == null) continue;
            String reason = null, repo = null;
            if (blank(pr.url()) == null) reason = "у PR нет адреса";
            else {
                String r = repoUrlOfPr(pr.url());
                if (r == null) reason = "адрес PR без /pulls/";
                else if ((repo = byNorm.get(r.toLowerCase(java.util.Locale.ROOT))) == null) reason = "репозитория нет в LORE";
            }
            if (reason != null) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("pr_uid", pr.uid());
                row.put("url", pr.url());
                row.put("reason", reason);
                unresolved.add(row);
                continue;
            }
            items.add(new PrItem(pr.uid(), repo, existing.contains(pr.uid() + "|" + norm(repo))));
        }
        return new PrPlan(List.copyOf(items), unresolved);
    }

    static String norm(String url) {
        return url == null ? null : url.trim().replaceAll("/+$", "").replaceAll("\\.git$", "");
    }

    private static String blank(String s) {
        return s == null || s.isBlank() || "null".equals(s.trim()) ? null : s;
    }
}
