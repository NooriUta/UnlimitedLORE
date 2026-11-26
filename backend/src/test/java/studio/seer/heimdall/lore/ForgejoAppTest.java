package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_FORGEJO_MINIAPP/FJ-02 — исполнитель {@code POST /lore/forgejo-app/{route}} на заглушке апстрима
 * (SPEC-FORGEJO-APP-060 §4–§6, §9, §10; SPEC-AGENT-SURFACE-061 §4–§5).
 *
 * <p>Ветки схемы §10: UNKNOWN_KIND 404 → FORBIDDEN_FOR_ROLE 403 (ДО args) → APPROVAL_REQUIRED 428 /
 * APPROVAL_INVALID 403 → BAD_PARAMS/INVALID_VALUE 400 → SSRF → UPSTREAM_4XX/5XX → 200 с truncate и без.
 * Всякий отказ до апстрима проверяется ещё и тем, что апстрим не позван.
 */
class ForgejoAppTest {

    private static final ForgejoRoutes REG = ForgejoRoutes.load();

    /** Заглушка апстрима: пишет вызовы, отвечает заданным. */
    static final class Stub implements ForgejoApp.Upstream {
        final List<String> calls = new ArrayList<>();
        final List<String> bodies = new ArrayList<>();
        int status = 200;
        String body = "[]";
        String type = "application/json";
        Exception fail;

        @Override
        public ForgejoApp.Reply call(String method, String pathAndQuery, String json) throws Exception {
            calls.add(method + " " + pathAndQuery);
            bodies.add(json);
            if (fail != null) throw fail;
            return new ForgejoApp.Reply(status, body, type);
        }
    }

    private static ForgejoApp.Outcome run(String route, JsonObject args, String role, Stub up) {
        return ForgejoApp.execute(REG, route, args, role, null, true, up);
    }

    private static JsonObject repoArgs() { return new JsonObject().put("owner", "AIDA").put("repo", "UnlimitedLORE"); }

    private static JsonObject error(ForgejoApp.Outcome o) { return o.envelope().getJsonObject("error"); }

    // ── конверт v=1 ──────────────────────────────────────────────────────

    @Test
    void конвертV1_found_сHasMoreИКурсором() {
        Stub up = new Stub();
        JsonArray page = new JsonArray();
        for (int i = 0; i < 5; i++) page.add(new JsonObject().put("number", i).put("title", "t" + i));
        up.body = page.encode();
        ForgejoApp.Outcome o = run("list_issues", repoArgs().put("limit", 5), "developer", up);
        assertEquals(200, o.http());
        JsonObject env = o.envelope();
        assertEquals(1, env.getInteger("v"));
        assertEquals("forgejo:list_issues", env.getString("kind"));
        assertEquals("found", env.getString("outcome"));
        assertEquals(5, env.getJsonArray("data").size());
        assertNull(env.getValue("error"));
        JsonObject meta = env.getJsonObject("meta");
        assertTrue(meta.getBoolean("has_more"), "вернули ровно pageSize → has_more");
        assertEquals(ForgejoApp.cursorOf(5), meta.getString("cursor"));
        assertTrue(meta.containsKey("took_ms"));
        assertNull(meta.getValue("truncated"));
    }

    @Test
    void короткаяСтраница_hasMoreFalse_курсорNull_пустоЭтоEmpty() {
        Stub up = new Stub();
        up.body = new JsonArray().add(new JsonObject().put("number", 1)).encode();
        JsonObject meta = run("list_issues", repoArgs().put("limit", 5), "developer", up).envelope().getJsonObject("meta");
        assertFalse(meta.getBoolean("has_more"));
        assertNull(meta.getValue("cursor"));
        up.body = "[]";
        assertEquals("empty", run("list_issues", repoArgs(), "developer", up).envelope().getString("outcome"));
    }

    @Test
    void единичныйМаршрут_безCursorИHasMore() {
        Stub up = new Stub();
        up.body = new JsonObject().put("number", 42).put("title", "x").encode();
        JsonObject env = run("get_issue", repoArgs().put("index", 42), "analyst", up).envelope();
        assertEquals("found", env.getString("outcome"));
        assertEquals(42, env.getJsonObject("data").getInteger("number"));
        assertFalse(env.getJsonObject("meta").containsKey("has_more"));
        assertFalse(env.getJsonObject("meta").containsKey("cursor"));
        assertEquals(List.of("GET /repos/AIDA/UnlimitedLORE/issues/42"), up.calls);
    }

    // ── пагинация ────────────────────────────────────────────────────────

    @Test
    void page1ПриLimitБезPage_иДефолтLimit20() {
        Stub up = new Stub();
        run("list_issues", repoArgs().put("limit", 5), "developer", up);
        assertTrue(up.calls.get(0).contains("page=1") && up.calls.get(0).contains("limit=5"), up.calls.get(0));
        run("list_issues", repoArgs(), "developer", up);
        assertTrue(up.calls.get(1).contains("page=1") && up.calls.get(1).contains("limit=20"), up.calls.get(1));
    }

    @Test
    void курсорПереводитсяВСтраницу() {
        Stub up = new Stub();
        run("list_issues", repoArgs().put("limit", 20).put("cursor", ForgejoApp.cursorOf(40)), "developer", up);
        assertTrue(up.calls.get(0).contains("page=3"), up.calls.get(0));
        assertEquals("{\"o\":40}", new String(Base64.getUrlDecoder().decode(ForgejoApp.cursorOf(40)), StandardCharsets.UTF_8));
        ForgejoApp.Outcome bad = run("list_issues", repoArgs().put("cursor", "%%%"), "developer", up);
        assertEquals("BAD_PARAMS", error(bad).getString("code"));
    }

    // ── порядок слоёв и коды ошибок ─────────────────────────────────────

    @Test
    void неизвестныйМаршрут_404UnknownKind_сКандидатами() {
        Stub up = new Stub();
        ForgejoApp.Outcome o = run("list_issue", repoArgs(), "full", up);
        assertEquals(404, o.http());
        assertEquals("failed", o.envelope().getString("outcome"));
        assertNull(o.envelope().getValue("data"));
        assertEquals("UNKNOWN_KIND", error(o).getString("code"));
        assertEquals(404, error(o).getInteger("status"));
        assertTrue(error(o).getJsonArray("allowed").contains("list_issues"), error(o).encode());
        assertTrue(error(o).getString("hint").contains("describe"));
        assertTrue(up.calls.isEmpty());
    }

    @Test
    void rbacДоArgs_мусорныеАргументыНоРольНеТа_403() {
        Stub up = new Stub();
        ForgejoApp.Outcome o = run("create_issue", new JsonObject().put("owner", "../..").put("zzz", 1), "analyst", up);
        assertEquals(403, o.http());
        assertEquals("FORBIDDEN_FOR_ROLE", error(o).getString("code"));
        assertEquals(new JsonArray(REG.get("create_issue").roles()), error(o).getJsonArray("allowed"));
        assertTrue(up.calls.isEmpty());
        assertEquals("FORBIDDEN_FOR_ROLE", error(run("list_issues", repoArgs(), "intern", up)).getString("code"),
            "неизвестная роль — нет доступа ни к чему");
        assertEquals("FORBIDDEN_FOR_ROLE", error(run("list_issues", repoArgs(), null, up)).getString("code"));
        assertTrue(up.calls.isEmpty());
    }

    @Test
    void dispatchБезПодтверждения_428_сПодтверждениемДоFJ07_403ApprovalInvalid() {
        Stub up = new Stub();
        JsonObject args = repoArgs().put("workflow_file", "lore-cd.yml").put("ref", "develop");
        ForgejoApp.Outcome o = ForgejoApp.execute(REG, "dispatch_workflow", args, "developer", null, true, up);
        assertEquals(428, o.http());
        assertEquals("APPROVAL_REQUIRED", error(o).getString("code"));
        assertTrue(error(o).getString("hint").contains("X-Lore-Human-Approval"));
        ForgejoApp.Outcome a = ForgejoApp.execute(REG, "dispatch_workflow", args, "developer", "msg 14.11 «да»", true, up);
        assertEquals(403, a.http());
        assertEquals("APPROVAL_INVALID", error(a).getString("code"));
        assertTrue(error(a).containsKey("failed_check"));
        assertEquals(428, ForgejoApp.execute(REG, "delete_repo", repoArgs(), "full", null, true, up).http());
        assertTrue(up.calls.isEmpty());
    }

    @Test
    void мержМимоМоста_409RefusedСПодсказкой() {
        Stub up = new Stub();
        ForgejoApp.Outcome o = run("merge_pull_request", repoArgs().put("index", 1), "full", up);
        assertEquals(409, o.http());
        assertEquals("REFUSED", error(o).getString("code"));
        assertTrue(error(o).getString("hint").contains("forgejo_pr_merge"));
        assertEquals("FORBIDDEN_FOR_ROLE", error(run("merge_pull_request", repoArgs().put("index", 1), "developer", up)).getString("code"));
        assertTrue(up.calls.isEmpty());
    }

    @Test
    void badParams_нетОбязательного_лишнийКлюч_типИГраницы() {
        Stub up = new Stub();
        ForgejoApp.Outcome miss = run("get_issue", new JsonObject().put("owner", "AIDA"), "full", up);
        assertEquals(400, miss.http());
        assertEquals("BAD_PARAMS", error(miss).getString("code"));
        assertTrue(error(miss).getJsonArray("allowed").contains("repo"));
        assertTrue(error(miss).getString("hint").contains("describe"));
        assertEquals("BAD_PARAMS", error(run("get_issue", repoArgs().put("index", 1).put("idx", 2), "full", up)).getString("code"));
        assertEquals("BAD_PARAMS", error(run("get_issue", repoArgs().put("index", "abc"), "full", up)).getString("code"));
        assertEquals("BAD_PARAMS", error(run("list_issues", repoArgs().put("limit", 51), "full", up)).getString("code"));
        ForgejoApp.Outcome en = run("list_issues", repoArgs().put("state", "opened"), "full", up);
        assertEquals("INVALID_VALUE", error(en).getString("code"));
        assertEquals(new JsonArray(List.of("open", "closed", "all")), error(en).getJsonArray("allowed"));
        assertTrue(up.calls.isEmpty());
    }

    @Test
    void ssrf_переменныеПутиНеВыходятЗаРепозиторий_апстримНеЗван() {
        Stub up = new Stub();
        for (String owner : List.of("..", "a%2fb", "http://evil.example", "a/b", "@evil", ""))
            assertEquals("BAD_PARAMS", error(run("get_repo", new JsonObject().put("owner", owner).put("repo", "r"), "full", up)).getString("code"), owner);
        for (String path : List.of("../secrets", "a/../../b", "%2e%2e/x", "/etc/passwd", "a\\b", "http://evil/x", "//evil/x", "a%2F..%2Fb"))
            assertEquals("BAD_PARAMS", error(run("get_file_contents", repoArgs().put("filepath", path), "full", up)).getString("code"), path);
        assertEquals("BAD_PARAMS", error(run("get_branch", repoArgs().put("branch", "x/../y"), "full", up)).getString("code"));
        assertTrue(up.calls.isEmpty(), String.valueOf(up.calls));
    }

    @Test
    void ssrf_хостТолькоНашForgejo() {
        URI ok = ForgejoApp.targetUri("http://forgejo:3030", "/repos/AIDA/x/issues?page=1&limit=5");
        assertEquals("forgejo", ok.getHost());
        assertEquals(3030, ok.getPort());
        assertEquals("/api/v1/repos/AIDA/x/issues", ok.getPath());
        assertThrows(IllegalArgumentException.class, () -> ForgejoApp.targetUri("http://forgejo:3030", "@evil.example/x"));
        assertThrows(IllegalArgumentException.class, () -> ForgejoApp.targetUri("http://forgejo:3030", "//evil.example/x"));
        assertThrows(IllegalArgumentException.class, () -> ForgejoApp.targetUri("http://forgejo:3030", "/../../admin"));
    }

    @Test
    void путьФайлаКодируетсяПоСегментам() {
        Stub up = new Stub();
        up.body = "{}";
        run("get_file_contents", repoArgs().put("filepath", "docs/a b.md").put("ref", "develop"), "full", up);
        assertEquals("GET /repos/AIDA/UnlimitedLORE/contents/docs/a%20b.md?ref=develop", up.calls.get(0));
    }

    @Test
    void телоЗаписи_иПереименованиеПоляНаПроводе() {
        Stub up = new Stub();
        up.status = 201;
        up.body = new JsonObject().put("number", 7).encode();
        ForgejoApp.Outcome o = run("create_issue", repoArgs().put("title", "T").put("body", "B"), "tester", up);
        assertEquals(200, o.http());
        assertEquals("POST /repos/AIDA/UnlimitedLORE/issues", up.calls.get(0));
        JsonObject sent = new JsonObject(up.bodies.get(0));
        assertEquals("T", sent.getString("title"));
        assertFalse(sent.containsKey("owner"));
        run("render_markdown", new JsonObject().put("text", "# x"), "analyst", up);
        assertEquals("# x", new JsonObject(up.bodies.get(1)).getString("Text"));
        up.status = 204;
        up.body = "";
        JsonObject del = run("delete_issue_comment", repoArgs().put("id", 3), "developer", up).envelope();
        assertEquals("found", del.getString("outcome"));
    }

    @Test
    void апстрим4xx5xx_сИсходнымСтатусомИПодсказкой() {
        Stub up = new Stub();
        up.status = 404;
        up.body = "{\"message\":\"not found\"}";
        ForgejoApp.Outcome nf = run("get_repo", repoArgs(), "full", up);
        assertEquals(404, nf.http());
        assertEquals("UPSTREAM_4XX", error(nf).getString("code"));
        assertEquals(404, error(nf).getInteger("status"));
        assertTrue(error(nf).getString("hint").contains("owner/repo"));
        up.status = 429;
        assertTrue(error(run("get_repo", repoArgs(), "full", up)).getString("hint").contains("backoff"));
        up.status = 500;
        assertEquals("UPSTREAM_5XX", error(run("get_repo", repoArgs(), "full", up)).getString("code"));
        up.fail = new java.net.ConnectException("refused");
        ForgejoApp.Outcome net = run("get_repo", repoArgs(), "full", up);
        assertEquals("UPSTREAM_5XX", error(net).getString("code"));
        assertEquals(502, net.http());
        assertEquals("failed", net.envelope().getString("outcome"));
    }

    @Test
    void getJobLog_capabilityНеПодключена_501Refused_послеRbac() {
        Stub up = new Stub();
        JsonObject args = repoArgs().put("task_id", 5);
        assertEquals("FORBIDDEN_FOR_ROLE", error(run("get_job_log", args, "analyst", up)).getString("code"));
        ForgejoApp.Outcome o = run("get_job_log", args, "developer", up);
        assertEquals(501, o.http());
        assertEquals("REFUSED", error(o).getString("code"));
        assertTrue(error(o).getString("hint").contains("OQ-060-LOGS-VOLUME"));
        assertTrue(up.calls.isEmpty());
    }

    // ── truncate 6k ──────────────────────────────────────────────────────

    @Test
    void truncate_списокТеряетХвостЦелымиЗаписями_маркерИMetaTruncated() {
        Stub up = new Stub();
        JsonArray big = new JsonArray();
        for (int i = 0; i < 50; i++) {
            // строки короче нижнего порога ужатия — влезть можно только срезом хвоста списка
            JsonObject issue = new JsonObject().put("number", i).put("title", "t" + i).put("state", "open");
            for (int f = 0; f < 12; f++) issue.put("f" + f, "x".repeat(60));
            big.add(issue);
        }
        up.body = big.encode();
        JsonObject env = run("list_issues", repoArgs().put("limit", 50), "developer", up).envelope();
        JsonArray data = env.getJsonArray("data");
        assertTrue(data.encode().length() <= ForgejoTruncate.BUDGET_CHARS, "длина " + data.encode().length());
        String last = String.valueOf(data.getValue(data.size() - 1));
        assertTrue(last.startsWith("--- TRUNCATED --- ") && last.endsWith(" more items"), last);
        JsonObject first = data.getJsonObject(0);
        assertTrue(first.containsKey("number") && first.containsKey("title") && first.containsKey("state"), "keyFloor: запись сохраняет ключи");
        JsonObject tr = env.getJsonObject("meta").getJsonObject("truncated");
        assertEquals(50, tr.getInteger("kept") + tr.getInteger("dropped"));
        assertTrue(tr.getInteger("dropped") > 0);
        assertTrue(env.getJsonObject("meta").getBoolean("has_more"), "has_more — по ответу апстрима, не по срезанному");
    }

    @Test
    void truncate_длинныеСтрокиУжимаются_иВыключаетсяФлагом() {
        Stub up = new Stub();
        up.body = new JsonObject().put("number", 1).put("body", "y".repeat(60_000)).encode();
        JsonObject env = run("get_issue", repoArgs().put("index", 1), "full", up).envelope();
        String body = env.getJsonObject("data").getString("body");
        assertTrue(body.contains("--- TRUNCATED --- "), body.substring(0, 50));
        assertTrue(env.getJsonObject("data").encode().length() <= ForgejoTruncate.BUDGET_CHARS);
        assertTrue(env.getJsonObject("meta").getValue("truncated") != null);
        JsonObject raw = ForgejoApp.execute(REG, "get_issue", repoArgs().put("index", 1), "full", null, false, up).envelope();
        assertEquals(60_000, raw.getJsonObject("data").getString("body").length());
        assertNull(raw.getJsonObject("meta").getValue("truncated"));
    }

    @Test
    void сырой_diff_строкойСTruncate() {
        Stub up = new Stub();
        up.type = "text/plain";
        up.body = "diff --git a/x b/x\n" + "+line\n".repeat(10_000);
        JsonObject env = run("get_pr_diff", repoArgs().put("index", 3), "tester", up).envelope();
        String data = env.getString("data");
        assertTrue(data.startsWith("diff --git"));
        assertTrue(data.contains("--- TRUNCATED --- "));
        assertTrue(data.length() <= ForgejoTruncate.BUDGET_CHARS + 64);
    }

    // ── describe (FJ-03): карточка и оглавление по роли ─────────────────

    @Test
    void describe_оглавлениеПоРоли_карточкаМаршрута_неизвестный() {
        JsonObject toc = LoreForgejoAppResource.describeBody(REG, null, null, "analyst").getJsonObject("data");
        assertEquals(List.of("read"), new ArrayList<>(toc.getJsonObject("groups").fieldNames()));
        assertEquals("empty", LoreForgejoAppResource.describeBody(REG, null, null, "intern").getString("outcome"));
        JsonObject card = LoreForgejoAppResource.describeBody(REG, "list_issues", null, "analyst").getJsonObject("data");
        assertEquals("forgejo:list_issues", card.getString("kind"));
        assertEquals("GET", card.getString("method"));
        assertEquals("/repos/{owner}/{repo}/issues", card.getString("path"));
        assertTrue(card.getBoolean("list"));
        assertTrue(card.getBoolean("allowed_for_you"));
        assertTrue(card.getJsonArray("params").encode().contains("\"limit\""));
        JsonObject unknown = LoreForgejoAppResource.describeBody(REG, "list_issue", null, "full");
        assertEquals("UNKNOWN_KIND", unknown.getJsonObject("error").getString("code"));
    }

    // ── матрица фильтра записи пускает в исполнитель, решает roles[] ─────

    @Test
    void фильтрЗаписиПропускаетВсеПрофили_решениеЗаИсполнителем() {
        for (String p : List.of("full", "architect", "developer", "tester", "pm", "analyst", "marketer", "product-analyst"))
            assertNull(AgentScopeFilter.decide(p, "/lore/forgejo-app/create_issue"), p);
    }
}
