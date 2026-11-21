package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;

import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MD-05 · дотяжка данных PR из git-хоста.
 *
 * <p>Корень пустых заголовков: KnowPR заводился одним ключом (pr_uid, pr_number, git_project) — мерж через мост до
 * #1641 (autoLink), task_link rel=pr ({@code /lore/task/pr}) и release_link, когда обогащение не удалось. Ядро здесь
 * — без сети и без БД: {@link Store} отбирает и пишет, {@link GitHost} читает PR. Пишутся только ПУСТЫЕ поля из
 * набора {@link ForgejoBridge#prFields}; чужой или недоступный репозиторий — пропуск с причиной, а не пустая подпись.
 * Повтор по дотянутому — ноль записей: дотянутый PR больше не кандидат.
 *
 * <p>KnowPR в модели — вершина без истории (lore-model.json: pr → KnowPR, без hist), поэтому обычный путь записи
 * PR — UPDATE вершины по pr_uid, тот же, что у мержа и release_link.
 */
final class PrBackfill {

    private PrBackfill() {}

    static final int DEFAULT_LIMIT = 200;
    static final int MAX_LIMIT = 1000;
    static final int EXAMPLES = 5;

    /** Поля, которые дотягиваются, — ровно набор {@link ForgejoBridge#prFields}, в его порядке. */
    static final List<String> FIELDS = List.of("title", "url", "state", "merged_at", "head_ref", "base_ref");

    // Коды причин пропуска — стабильные ключи отчёта.
    static final String NO_KEY = "no_key";
    static final String FOREIGN_REPO = "foreign_repo";
    static final String NOT_FOUND = "not_found";
    static final String NO_ACCESS = "no_access";
    static final String UPSTREAM_ERROR = "upstream_error";
    static final String EMPTY_ANSWER = "empty_answer";
    static final String NOTHING_NEW = "nothing_new";

    /** Публичные хостинги, куда токен своего Forgejo не отправляется: там PR не наш, и токен там чужой. */
    static final Set<String> FOREIGN_HOSTS = Set.of("github.com", "gitlab.com", "bitbucket.org", "codeberg.org");

    /** Ответ git-хоста по одному PR: поля или причина пропуска. */
    record Fetch(Map<String, Object> fields, String skipCode, String skipReason) {
        static Fetch ok(Map<String, Object> fields) { return new Fetch(fields, null, null); }
        static Fetch skip(String code, String reason) { return new Fetch(Map.of(), code, reason); }
    }

    /** Git-хост: данные PR по проекту и номеру; knownUrl — уже записанный адрес PR (уточняет репозиторий). */
    interface GitHost {
        Fetch fetch(String gitProject, long number, String knownUrl) throws Exception;
    }

    /** Хранилище KnowPR: кандидаты после курсора и запись недостающих полей. */
    interface Store {
        List<Map<String, Object>> candidates(String after, int limit);
        void write(String prUid, Map<String, Object> fields);
        /** Строка KnowPR по ключу; null — нет такой. */
        Map<String, Object> row(String prUid);
    }

    record Key(String gitProject, long number) {}

    // ── отбор и запись ───────────────────────────────────────────────────

    static final String CANDIDATE_WHERE = "(title IS NULL OR title = '' OR url IS NULL OR url = '' "
        + "OR state IS NULL OR state = '' OR (state = 'merged' AND merged_at IS NULL))";

    static String candidatesSql(int limit) {
        return "SELECT pr_uid, pr_number, git_project, title, url, state, merged_at, head_ref, base_ref FROM KnowPR "
            + "WHERE pr_uid > :cursor AND " + CANDIDATE_WHERE + " ORDER BY pr_uid LIMIT " + clamp(limit);
    }

    static final String ROW_SQL = "SELECT pr_uid, pr_number, git_project, title, url, state, merged_at, head_ref, base_ref FROM KnowPR WHERE pr_uid=:uid";

    /** UPDATE по фиксированному набору ключей: имена полей — только из {@link #FIELDS}. */
    static String writeSql(Set<String> keys) {
        StringBuilder set = new StringBuilder();
        for (String k : FIELDS) if (keys.contains(k)) set.append(set.length() == 0 ? "" : ", ").append(k).append("=:").append(k);
        if (set.length() == 0) throw new IllegalArgumentException("нечего писать");
        return "UPDATE KnowPR SET " + set + " WHERE pr_uid=:uid";
    }

    static int clamp(int limit) { return limit <= 0 ? DEFAULT_LIMIT : Math.min(limit, MAX_LIMIT); }

    private static boolean blank(Object v) { return v == null || String.valueOf(v).isBlank(); }

    /** Кандидат: нет заголовка, адреса или состояния, либо влит без даты мержа. Правило = {@link #CANDIDATE_WHERE}. */
    static boolean needsBackfill(Map<String, Object> row) {
        return blank(row.get("title")) || blank(row.get("url")) || blank(row.get("state"))
            || ("merged".equals(row.get("state")) && blank(row.get("merged_at")));
    }

    private static final Pattern UID = Pattern.compile("^([\\w.-]+/[\\w.-]+)#(\\d+)$");

    /** Проект и номер: из полей git_project + pr_number, иначе из pr_uid «owner/repo#N»; голый номер — null. */
    static Key key(Map<String, Object> row) {
        Object gp = row.get("git_project");
        Object n = row.get("pr_number");
        if (!blank(gp) && n instanceof Number num && num.longValue() > 0) return new Key(gp.toString(), num.longValue());
        Matcher m = UID.matcher(String.valueOf(row.get("pr_uid")).strip());
        if (m.matches()) return new Key(m.group(1), Long.parseLong(m.group(2)));
        return null;
    }

    /** Поля, которых у записи нет, а git-хост их дал. Записанное не затирается. */
    static Map<String, Object> gaps(Map<String, Object> current, Map<String, Object> fetched) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (String k : FIELDS) if (blank(current.get(k)) && !blank(fetched.get(k))) out.put(k, fetched.get(k));
        return out;
    }

    // ── ответ Forgejo ────────────────────────────────────────────────────

    /** HTTP-ответ Forgejo на GET /repos/{repo}/pulls/{n} → поля или причина пропуска. */
    static Fetch fromForgejo(String repoPath, long number, int status, String body) {
        if (status == 404) return Fetch.skip(NOT_FOUND, "PR #" + number + " нет в репозитории " + repoPath + " на Forgejo (404)");
        if (status == 401 || status == 403)
            return Fetch.skip(NO_ACCESS, "токен моста не видит репозиторий " + repoPath + " (HTTP " + status + ")");
        if (status >= 300 || status < 200) return Fetch.skip(UPSTREAM_ERROR, "Forgejo ответил " + status + " по " + repoPath);
        Map<String, Object> f;
        try {
            f = ForgejoBridge.prFields(new JsonObject(body == null || body.isBlank() ? "{}" : body));
        } catch (RuntimeException e) {
            return Fetch.skip(UPSTREAM_ERROR, "ответ Forgejo по " + repoPath + " — не JSON PR");
        }
        if (f.isEmpty()) return Fetch.skip(EMPTY_ANSWER, "в ответе Forgejo по " + repoPath + " нет полей PR");
        return Fetch.ok(f);
    }

    /** Хост публичного хостинга (не наш Forgejo) — токен моста туда не уходит. */
    static boolean foreignHost(String apiBase) {
        try {
            String h = URI.create(apiBase).getHost();
            if (h == null) return false;
            h = h.toLowerCase(java.util.Locale.ROOT);
            for (String f : FOREIGN_HOSTS) if (h.equals(f) || h.endsWith("." + f)) return true;
            return false;
        } catch (RuntimeException e) {
            return false;
        }
    }

    private static final Pattern PR_URL = Pattern.compile("^https?://([^/]+)/([^/]+)/([^/]+)/pulls?/(\\d+)/?$");

    /**
     * «owner/repo» из записанного адреса PR, если он на том же хосте и с тем же номером. У проекта бывает несколько
     * primary-репозиториев (NooriUta/UnlimitedLORE: UnlimitedLORE и forgejo-mcp) — адрес называет, какой.
     */
    static String repoPathFromUrl(String url, long number, String host) {
        if (url == null || host == null) return null;
        Matcher m = PR_URL.matcher(url.strip());
        if (!m.matches() || !m.group(1).equalsIgnoreCase(host) || Long.parseLong(m.group(4)) != number) return null;
        return m.group(2) + "/" + m.group(3);
    }

    // ── прогон ───────────────────────────────────────────────────────────

    /**
     * Одна порция: кандидаты после курсора {@code after} (по pr_uid), не больше {@code limit}. Пропущенные не мешают
     * идти дальше — курсор сдвигается по всем просмотренным. {@code done} — порция неполная, дальше кандидатов нет.
     */
    static Map<String, Object> run(Store store, GitHost host, String after, int limit, boolean dryRun) {
        int lim = clamp(limit);
        List<Map<String, Object>> rows = store.candidates(after == null ? "" : after, lim);
        int updated = 0, unchanged = 0;
        List<Map<String, Object>> items = new ArrayList<>();
        Map<String, Map<String, Object>> skippedBy = new LinkedHashMap<>();
        int skipped = 0;
        String last = after;
        for (Map<String, Object> row : rows) {
            String uid = String.valueOf(row.get("pr_uid"));
            last = uid;
            Key k = key(row);
            Fetch f;
            if (k == null) f = Fetch.skip(NO_KEY, "ключ PR без проекта и номера («" + uid + "») — не к кому обращаться");
            else {
                try {
                    f = host.fetch(k.gitProject(), k.number(), blank(row.get("url")) ? null : row.get("url").toString());
                } catch (Exception e) {
                    f = Fetch.skip(UPSTREAM_ERROR, "сбой обращения к git-хосту: " + e.getMessage());
                }
            }
            if (f.skipCode() != null) {
                skipped++;
                addSkip(skippedBy, f.skipCode(), f.skipReason(), uid);
                continue;
            }
            Map<String, Object> g = gaps(row, f.fields());
            if (g.isEmpty()) {
                unchanged++;
                continue;
            }
            if (!dryRun) store.write(uid, g);
            updated++;
            Map<String, Object> it = new LinkedHashMap<>();
            it.put("pr_uid", uid);
            it.put("fields", List.copyOf(g.keySet()));
            items.add(it);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("dry_run", dryRun);
        out.put("scanned", rows.size());
        out.put("updated", dryRun ? 0 : updated);
        if (dryRun) out.put("would_update", updated);
        out.put("unchanged", unchanged);
        out.put("skipped", skipped);
        out.put("skipped_by_reason", skippedBy);
        out.put("items", items);
        out.put("next_after", last);
        out.put("done", rows.size() < lim);
        out.put("outcome", !dryRun && updated > 0 ? LoreOutcome.UPDATED : LoreOutcome.UNCHANGED);
        return out;
    }

    private static void addSkip(Map<String, Map<String, Object>> by, String code, String reason, String uid) {
        Map<String, Object> g = by.computeIfAbsent(code, c -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("count", 0);
            m.put("reason", reason);
            m.put("examples", new ArrayList<String>());
            return m;
        });
        g.put("count", (Integer) g.get("count") + 1);
        @SuppressWarnings("unchecked")
        List<String> ex = (List<String>) g.get("examples");
        if (ex.size() < EXAMPLES) ex.add(uid);
    }

    /**
     * Дотяжка одного PR сразу после того, как его завели ключом (task_link rel=pr). Ответ — {@code pr_fields}
     * (что дописано) или {@code pr_details_missing} (почему нет); связь от неудачи не откатывается.
     */
    static Map<String, Object> fillOne(Store store, GitHost host, String gitProject, long number) {
        Map<String, Object> out = new LinkedHashMap<>();
        String uid = gitProject + "#" + number;
        Fetch f;
        try {
            f = host.fetch(gitProject, number, null);
        } catch (Exception e) {
            f = Fetch.skip(UPSTREAM_ERROR, "сбой обращения к git-хосту: " + e.getMessage());
        }
        if (f.skipCode() != null) {
            out.put("pr_details_missing", f.skipReason());
            return out;
        }
        try {
            Map<String, Object> cur = store.row(uid);
            if (cur == null) {
                out.put("pr_details_missing", "записи " + uid + " нет — дописывать некуда");
                return out;
            }
            Map<String, Object> g = gaps(cur, f.fields());
            if (!g.isEmpty()) store.write(uid, g);
            out.put("pr_fields", List.copyOf(g.keySet()));
        } catch (RuntimeException e) {
            out.put("pr_details_missing", "данные PR не записаны: " + e.getMessage());
        }
        return out;
    }
}
