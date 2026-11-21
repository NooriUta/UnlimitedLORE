package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MD-05 · дотяжка данных PR из git-хоста для KnowPR без заголовка.
 *
 * <p>Смоук стенда RFD2-MD05: «PR без заголовка: 547 из 1093». Такие KnowPR — следы путей, которые заводили
 * вершину одним ключом (мерж до #1641, task_link rel=pr, release_link при сбое обогащения). Операция идёт
 * порциями, пишет только недостающие поля, чужой или недоступный репозиторий пропускает с причиной; повтор — 0.
 * Здесь — ядро на заглушках хранилища и git-хоста (без сети и без БД).
 */
class PrBackfillTest {

    /** Хранилище в памяти: строки KnowPR по pr_uid, отбор кандидатов тем же правилом, что SQL. */
    static final class MemStore implements PrBackfill.Store {
        final TreeMap<String, Map<String, Object>> rows = new TreeMap<>();
        final List<String> writes = new ArrayList<>();
        /** pr_uid, запись которых «не ляжет»: строку удалили между отбором и записью (WriteCount = 0). */
        final java.util.Set<String> vanish = new java.util.HashSet<>();

        MemStore put(String uid, Object... kv) {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("pr_uid", uid);
            for (int i = 0; i < kv.length; i += 2) r.put((String) kv[i], kv[i + 1]);
            rows.put(uid, r);
            return this;
        }

        @Override public List<Map<String, Object>> candidates(String after, int limit) {
            List<Map<String, Object>> out = new ArrayList<>();
            for (Map<String, Object> r : rows.tailMap(after == null ? "" : after, false).values()) {
                if (!PrBackfill.needsBackfill(r)) continue;
                out.add(new LinkedHashMap<>(r));
                if (out.size() == limit) break;
            }
            return out;
        }

        @Override public Map<String, Object> row(String prUid) {
            Map<String, Object> r = rows.get(prUid);
            return r == null ? null : new LinkedHashMap<>(r);
        }

        @Override public long write(String prUid, Map<String, Object> fields) {
            if (vanish.contains(prUid) || !rows.containsKey(prUid)) return 0;
            writes.add(prUid);
            rows.get(prUid).putAll(fields);
            return 1;
        }
    }

    /** Заглушка Forgejo: «owner/repo#N» → ответ; ключ не найден — 404. Счётчик обращений. */
    static final class StubHost implements PrBackfill.GitHost {
        final Map<String, PrBackfill.Fetch> byKey = new LinkedHashMap<>();
        int calls;

        @Override public PrBackfill.Fetch fetch(String gitProject, long number, String knownUrl) {
            calls++;
            PrBackfill.Fetch f = byKey.get(gitProject + "#" + number);
            return f != null ? f : PrBackfill.Fetch.skip(PrBackfill.NOT_FOUND, "PR #" + number + " нет на Forgejo (404)");
        }
    }

    static Map<String, Object> forgejoPr(String title, String url, String state, String mergedAt) {
        Map<String, Object> f = new LinkedHashMap<>();
        f.put("title", title);
        f.put("url", url);
        f.put("state", state);
        if (mergedAt != null) f.put("merged_at", mergedAt);
        f.put("head_ref", "feat/x");
        f.put("base_ref", "develop");
        return f;
    }

    @Test
    void prБезЗаголовка_дотянут_повтор_ноль() {
        MemStore store = new MemStore()
            .put("NooriUta/UnlimitedLORE#1681", "pr_number", 1681, "git_project", "NooriUta/UnlimitedLORE",
                "url", "https://git.seidrstudio.pro/AIDA/UnlimitedLORE/pulls/1681");
        StubHost host = new StubHost();
        host.byKey.put("NooriUta/UnlimitedLORE#1681", PrBackfill.Fetch.ok(forgejoPr("fix: x (SPRINT_A_B/X-1)",
            "https://git.seidrstudio.pro/AIDA/UnlimitedLORE/pulls/1681", "merged", "2026-11-20T10:00:00Z")));

        Map<String, Object> r1 = PrBackfill.run(store, host, null, 100, false);
        assertEquals(1, r1.get("scanned"));
        assertEquals(1, r1.get("updated"));
        assertEquals(0, r1.get("skipped"));
        assertEquals(true, r1.get("done"));
        Map<String, Object> row = store.rows.get("NooriUta/UnlimitedLORE#1681");
        assertEquals("fix: x (SPRINT_A_B/X-1)", row.get("title"));
        assertEquals("merged", row.get("state"));
        assertEquals("2026-11-20T10:00:00Z", row.get("merged_at"));
        assertEquals("https://git.seidrstudio.pro/AIDA/UnlimitedLORE/pulls/1681", row.get("url"));

        Map<String, Object> r2 = PrBackfill.run(store, host, null, 100, false);
        assertEquals(0, r2.get("scanned"), "дотянутый PR больше не кандидат");
        assertEquals(0, r2.get("updated"));
        assertEquals(LoreOutcome.UNCHANGED, r2.get("outcome"));
        assertEquals(1, store.writes.size(), "повтор ничего не пишет");
    }

    @Test
    void записанное_не_затирается_пишутся_только_пустые_поля() {
        MemStore store = new MemStore()
            .put("P/R#5", "pr_number", 5, "git_project", "P/R", "title", "свой заголовок", "state", "merged");
        StubHost host = new StubHost();
        host.byKey.put("P/R#5", PrBackfill.Fetch.ok(forgejoPr("заголовок Forgejo", "https://h/P/R/pulls/5", "merged", "2026-01-01T00:00:00Z")));
        PrBackfill.run(store, host, null, 10, false);
        Map<String, Object> row = store.rows.get("P/R#5");
        assertEquals("свой заголовок", row.get("title"));
        assertEquals("https://h/P/R/pulls/5", row.get("url"));
        assertEquals("2026-01-01T00:00:00Z", row.get("merged_at"));
    }

    @Test
    void чужой_репо_пропуск_с_причиной_и_повтор_ноль_записей() {
        MemStore store = new MemStore()
            .put("NooriUta/aida-documentation#3", "pr_number", 3, "git_project", "NooriUta/aida-documentation");
        PrBackfill.GitHost host = (gp, n, url) -> PrBackfill.Fetch.skip(PrBackfill.FOREIGN_REPO,
            "чужой git-хост github.com — токен моста туда не отправляется");
        Map<String, Object> r = PrBackfill.run(store, host, null, 10, false);
        assertEquals(0, r.get("updated"));
        assertEquals(1, r.get("skipped"));
        @SuppressWarnings("unchecked")
        Map<String, Map<String, Object>> by = (Map<String, Map<String, Object>>) r.get("skipped_by_reason");
        assertEquals(1, by.get(PrBackfill.FOREIGN_REPO).get("count"));
        assertTrue(String.valueOf(by.get(PrBackfill.FOREIGN_REPO).get("reason")).contains("github.com"));
        assertEquals(List.of("NooriUta/aida-documentation#3"), by.get(PrBackfill.FOREIGN_REPO).get("examples"));
        assertNull(store.rows.get("NooriUta/aida-documentation#3").get("title"), "пустая подпись не пишется");
        assertTrue(store.writes.isEmpty());
        // повтор — тот же пропуск, ноль записей
        Map<String, Object> again = PrBackfill.run(store, host, null, 10, false);
        assertEquals(0, again.get("updated"));
        assertEquals(1, again.get("skipped"));
        assertTrue(store.writes.isEmpty());
    }

    @Test
    void ключ_без_проекта_пропуск_без_обращения_к_хосту() {
        MemStore store = new MemStore().put("412", "pr_number", 412);
        StubHost host = new StubHost();
        Map<String, Object> r = PrBackfill.run(store, host, null, 10, false);
        assertEquals(1, r.get("skipped"));
        assertEquals(0, host.calls);
        @SuppressWarnings("unchecked")
        Map<String, Object> by = (Map<String, Object>) r.get("skipped_by_reason");
        assertTrue(by.containsKey(PrBackfill.NO_KEY));
    }

    @Test
    void сбой_хоста_пропуск_а_не_падение_порции() {
        MemStore store = new MemStore()
            .put("P/R#1", "pr_number", 1, "git_project", "P/R")
            .put("P/R#2", "pr_number", 2, "git_project", "P/R");
        PrBackfill.GitHost host = (gp, n, url) -> {
            if (n == 1) throw new IllegalStateException("connect timed out");
            return PrBackfill.Fetch.ok(forgejoPr("второй", "https://h/P/R/pulls/2", "open", null));
        };
        Map<String, Object> r = PrBackfill.run(store, host, null, 10, false);
        assertEquals(1, r.get("updated"));
        assertEquals(1, r.get("skipped"));
        @SuppressWarnings("unchecked")
        Map<String, Object> by = (Map<String, Object>) r.get("skipped_by_reason");
        assertTrue(by.containsKey(PrBackfill.UPSTREAM_ERROR));
    }

    @Test
    void порции_по_курсору_пропущенные_не_мешают_идти_дальше() {
        MemStore store = new MemStore();
        StubHost host = new StubHost();
        for (int i = 1; i <= 5; i++) {
            store.put("P/R#" + i, "pr_number", i, "git_project", "P/R");
            if (i != 2) host.byKey.put("P/R#" + i, PrBackfill.Fetch.ok(forgejoPr("t" + i, "https://h/P/R/pulls/" + i, "open", null)));
        }
        Map<String, Object> p1 = PrBackfill.run(store, host, null, 2, false);
        assertEquals(2, p1.get("scanned"));
        assertEquals(false, p1.get("done"));
        assertEquals("P/R#2", p1.get("next_after"));
        Map<String, Object> p2 = PrBackfill.run(store, host, (String) p1.get("next_after"), 2, false);
        assertEquals(2, p2.get("updated"));
        Map<String, Object> p3 = PrBackfill.run(store, host, (String) p2.get("next_after"), 2, false);
        assertEquals(1, p3.get("updated"));
        assertEquals(true, p3.get("done"));
        assertEquals(4, store.writes.size());
    }

    @Test
    void пробный_прогон_ничего_не_пишет() {
        MemStore store = new MemStore().put("P/R#9", "pr_number", 9, "git_project", "P/R");
        StubHost host = new StubHost();
        host.byKey.put("P/R#9", PrBackfill.Fetch.ok(forgejoPr("t", "https://h/P/R/pulls/9", "open", null)));
        Map<String, Object> r = PrBackfill.run(store, host, null, 10, true);
        assertEquals(true, r.get("dry_run"));
        assertEquals(1, r.get("would_update"));
        assertEquals(0, r.get("updated"));
        assertTrue(store.writes.isEmpty());
    }

    @Test
    void кандидат_только_с_пустым_заголовком_адресом_состоянием_или_датой_влитого() {
        assertTrue(PrBackfill.needsBackfill(Map.of("pr_uid", "a#1")));
        assertTrue(PrBackfill.needsBackfill(Map.of("pr_uid", "a#1", "title", " ", "url", "u", "state", "open")));
        assertTrue(PrBackfill.needsBackfill(Map.of("pr_uid", "a#1", "title", "t", "url", "u", "state", "merged")),
            "влитый без даты — кандидат");
        assertFalse(PrBackfill.needsBackfill(Map.of("pr_uid", "a#1", "title", "t", "url", "u", "state", "open")),
            "открытый PR без даты мержа — полный");
        assertFalse(PrBackfill.needsBackfill(Map.of("pr_uid", "a#1", "title", "t", "url", "u", "state", "merged",
            "merged_at", "2026-01-01T00:00:00Z")));
    }

    @Test
    void ключ_pr_из_полей_или_из_pr_uid() {
        assertEquals(new PrBackfill.Key("P/R", 7), PrBackfill.key(Map.of("pr_uid", "P/R#7", "git_project", "P/R", "pr_number", 7)));
        assertEquals(new PrBackfill.Key("P/R", 7), PrBackfill.key(Map.of("pr_uid", "P/R#7")));
        assertNull(PrBackfill.key(Map.of("pr_uid", "7", "pr_number", 7)), "номер без проекта неоднозначен");
        assertNull(PrBackfill.key(Map.of("pr_uid", "P/R#x")));
    }

    @Test
    void ответ_forgejo_в_исход() {
        PrBackfill.Fetch ok = PrBackfill.fromForgejo("AIDA/UnlimitedLORE", 5, 200,
            "{\"title\":\"t\",\"html_url\":\"https://h/AIDA/UnlimitedLORE/pulls/5\",\"merged\":true,\"merged_at\":\"2026-01-01T00:00:00Z\"}");
        assertNull(ok.skipCode());
        assertEquals("t", ok.fields().get("title"));
        assertEquals("merged", ok.fields().get("state"));
        assertEquals(PrBackfill.NOT_FOUND, PrBackfill.fromForgejo("AIDA/X", 5, 404, "{}").skipCode());
        assertEquals(PrBackfill.NO_ACCESS, PrBackfill.fromForgejo("AIDA/X", 5, 403, "{}").skipCode());
        assertEquals(PrBackfill.NO_ACCESS, PrBackfill.fromForgejo("AIDA/X", 5, 401, "{}").skipCode());
        assertEquals(PrBackfill.UPSTREAM_ERROR, PrBackfill.fromForgejo("AIDA/X", 5, 502, "").skipCode());
        assertEquals(PrBackfill.EMPTY_ANSWER, PrBackfill.fromForgejo("AIDA/X", 5, 200, "{}").skipCode());
        assertTrue(PrBackfill.fromForgejo("AIDA/X", 5, 404, "{}").skipReason().contains("AIDA/X"));
    }

    @Test
    void чужой_хост_не_получает_токен_моста() {
        assertTrue(PrBackfill.foreignHost("https://github.com"));
        assertTrue(PrBackfill.foreignHost("https://gitlab.com"));
        assertFalse(PrBackfill.foreignHost("https://git.seidrstudio.pro"));
        assertFalse(PrBackfill.foreignHost("http://forgejo:3030"));
    }

    @Test
    void адрес_pr_уточняет_репозиторий_проекта_с_несколькими_репо() {
        // У NooriUta/UnlimitedLORE два primary-репо (UnlimitedLORE и forgejo-mcp): адрес PR называет, какой.
        assertEquals("AIDA/forgejo-mcp", PrBackfill.repoPathFromUrl("https://git.seidrstudio.pro/AIDA/forgejo-mcp/pulls/13", 13, "git.seidrstudio.pro"));
        assertNull(PrBackfill.repoPathFromUrl("https://git.seidrstudio.pro/AIDA/forgejo-mcp/pulls/14", 13, "git.seidrstudio.pro"), "номер другой");
        assertNull(PrBackfill.repoPathFromUrl("https://github.com/NooriUta/AIDA/pull/13", 13, "git.seidrstudio.pro"), "хост другой");
        assertNull(PrBackfill.repoPathFromUrl(null, 13, "git.seidrstudio.pro"));
    }

    @Test
    void одиночная_дотяжка_для_task_link() {
        MemStore store = new MemStore().put("P/R#3", "pr_number", 3, "git_project", "P/R");
        StubHost host = new StubHost();
        host.byKey.put("P/R#3", PrBackfill.Fetch.ok(forgejoPr("t3", "https://h/P/R/pulls/3", "merged", "2026-02-02T00:00:00Z")));
        Map<String, Object> one = PrBackfill.fillOne(store, host, "P/R", 3);
        assertEquals(List.of("title", "url", "state", "merged_at", "head_ref", "base_ref"), one.get("pr_fields"));
        assertEquals("t3", store.rows.get("P/R#3").get("title"));
        Map<String, Object> miss = PrBackfill.fillOne(store, new StubHost(), "P/R", 404);
        assertTrue(String.valueOf(miss.get("pr_details_missing")).contains("404"));
    }

    @Test
    void промах_записи_не_дотянуто_а_пропуск_с_причиной() {
        MemStore store = new MemStore()
            .put("P/R#1", "pr_number", 1, "git_project", "P/R")
            .put("P/R#2", "pr_number", 2, "git_project", "P/R");
        store.vanish.add("P/R#1");
        StubHost host = new StubHost();
        host.byKey.put("P/R#1", PrBackfill.Fetch.ok(forgejoPr("t1", "https://h/P/R/pulls/1", "open", null)));
        host.byKey.put("P/R#2", PrBackfill.Fetch.ok(forgejoPr("t2", "https://h/P/R/pulls/2", "open", null)));
        Map<String, Object> r = PrBackfill.run(store, host, null, 10, false);
        assertEquals(1, r.get("updated"), "дотянут только тот, чья запись легла");
        assertEquals(1, r.get("missed"), "промах считается отдельно");
        assertEquals(1, r.get("skipped"));
        @SuppressWarnings("unchecked")
        Map<String, Map<String, Object>> by = (Map<String, Map<String, Object>>) r.get("skipped_by_reason");
        assertEquals(List.of("P/R#1"), by.get(PrBackfill.WRITE_MISSED).get("examples"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> items = (List<Map<String, Object>>) r.get("items");
        assertEquals(List.of("P/R#2"), items.stream().map(i -> i.get("pr_uid")).toList());
    }

    @Test
    void промах_одиночной_дотяжки_не_pr_fields() {
        MemStore store = new MemStore().put("P/R#3", "pr_number", 3, "git_project", "P/R");
        store.vanish.add("P/R#3");
        StubHost host = new StubHost();
        host.byKey.put("P/R#3", PrBackfill.Fetch.ok(forgejoPr("t3", "https://h/P/R/pulls/3", "open", null)));
        Map<String, Object> one = PrBackfill.fillOne(store, host, "P/R", 3);
        assertNull(one.get("pr_fields"));
        assertTrue(String.valueOf(one.get("pr_details_missing")).contains("не легла"));
    }

    @Test
    void число_задетых_строк_из_ответа_движка() {
        List<String> sql = new ArrayList<>();
        long n = PrBackfill.writeChecked((q, p) -> { sql.add(q); return List.of(Map.of("count", 0)); },
            "P/R#1", Map.of("title", "t"));
        assertEquals(0, n);
        assertEquals("UPDATE KnowPR SET title=:title WHERE pr_uid=:uid", sql.get(0));
        assertEquals(1, PrBackfill.writeChecked((q, p) -> List.of(Map.of("count", 1)), "P/R#1", Map.of("url", "u")));
    }
}
