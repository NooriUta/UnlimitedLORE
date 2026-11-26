package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_FORGEJO_MINIAPP/FJ-04 — QG-прогон read-группы миниаппа: каждый read-маршрут реестра имеет пробу
 * (сторож покрытия), пробы связываются по $ref, позитивный контроль отличает «пусто» от «проверили».
 */
class ForgejoReadProbesTest {

    private static final ForgejoRoutes REG = ForgejoRoutes.load();
    private static final ForgejoReadProbes PROBES = ForgejoReadProbes.load();

    /** Read-маршруты реестра: группы read / actions-read и GET из notifications. */
    private static Set<String> readRoutes() {
        return REG.all().stream()
            .filter(r -> "read".equals(r.group()) || "actions-read".equals(r.group())
                || "notifications".equals(r.group()) && "GET".equals(r.method()))
            .map(ForgejoRoutes.Route::name).collect(Collectors.toSet());
    }

    @Test
    void каждыйReadМаршрутИмеетПробу() {
        Set<String> probed = PROBES.probes().stream().map(ForgejoReadProbes.Probe::route).collect(Collectors.toSet());
        Set<String> missing = new HashSet<>(readRoutes());
        missing.removeAll(probed);
        assertTrue(missing.isEmpty(), "read-маршруты без пробы: " + missing);
        Set<String> extra = new HashSet<>(probed);
        extra.removeAll(readRoutes());
        assertTrue(extra.isEmpty(), "пробы не read-маршрутов или несуществующих: " + extra);
    }

    @Test
    void служебныйМаршрутQgRead_неСталкиваетсяСРеестром_иВиденВОглавлении() {
        assertTrue(REG.get(LoreForgejoAppResource.QG_READ) == null, "qg_read — не маршрут Forgejo");
        JsonObject toc = LoreForgejoAppResource.describeBody(REG, null, null, "full").getJsonObject("data");
        assertTrue(toc.getString("qg", "").contains("qg_read"), toc.encode());
    }

    @Test
    void refusedТолькоСПричиной_иRefДоступенРаньше() {
        Set<String> seen = new HashSet<>();
        for (ForgejoReadProbes.Probe p : PROBES.probes()) {
            if ("refused".equals(p.expect())) assertFalse(p.reason() == null || p.reason().isBlank(), p.route() + ": refused без причины");
            for (String ref : p.refs()) assertTrue(seen.contains(ref), p.route() + ": $ref на " + ref + " — пробы раньше нет");
            seen.add(p.route());
        }
    }

    /** Заглушка Forgejo: отвечает по пути, чтобы проверить цепочку $ref. */
    private static ForgejoApp.Upstream fakeForgejo(boolean emptyIssues, boolean wrongPr) {
        return (method, path, body) -> {
            String p = path.replaceAll("\\?.*", "");
            if (p.equals("/user")) return ok(new JsonObject().put("login", "ciadmin").encode());
            if (p.endsWith("/repos/AIDA/UnlimitedLORE/issues")) return ok(emptyIssues ? "[]" : new JsonArray().add(new JsonObject().put("number", 7)).encode());
            if (p.endsWith("/pulls/1827")) return ok(new JsonObject().put("number", wrongPr ? 1 : 1827).encode());
            if (p.endsWith("/commits")) return ok(new JsonArray().add(new JsonObject().put("sha", "abc123")).encode());
            if (p.contains("/commits/abc123/status")) return ok(new JsonObject().put("state", "success").encode());
            if (p.equals("/repos/AIDA/UnlimitedLORE")) return ok(new JsonObject().put("full_name", "AIDA/UnlimitedLORE").encode());
            if (p.equals("/orgs/AIDA")) return ok(new JsonObject().put("username", "AIDA").encode());
            if (p.endsWith("/branches/develop")) return ok(new JsonObject().put("name", "develop").encode());
            // FJ-08: формы ответа Actions Forgejo 17 — объект со списком внутри
            if (p.endsWith("/actions/runs")) return ok(new JsonObject().put("workflow_runs", new JsonArray().add(new JsonObject().put("id", 77))).encode());
            if (p.endsWith("/actions/runs/77/jobs")) return ok(new JsonObject().put("jobs", new JsonArray().add(new JsonObject().put("id", 88))).encode());
            if (p.endsWith("/actions/jobs/88")) return ok(new JsonObject().put("id", 88).put("status", "success").encode());
            if (p.endsWith("/actions/jobs/88/logs")) return new ForgejoApp.Reply(200, "строка 1\nстрока 2\n", "text/plain");
            if (p.startsWith("/markdown") || p.startsWith("/markup")) return new ForgejoApp.Reply(200, "<p><strong>ok</strong></p>", "text/html");
            if (p.endsWith(".diff")) return new ForgejoApp.Reply(200, "diff --git a/x b/x", "text/plain");
            if (p.startsWith("/gitignore/templates") && !p.equals("/gitignore/templates")) return ok(new JsonObject().put("name", "Java").encode());
            if (p.equals("/gitignore/templates") || p.equals("/label/templates")) return ok(new JsonArray().add("Java").encode());
            if (p.equals("/licenses")) return ok(new JsonArray().add(new JsonObject().put("key", "mit")).encode());
            // всё прочее — список из одного объекта с id/number (детальные — объект)
            JsonObject one = new JsonObject().put("id", 5).put("number", 5).put("name", "x").put("login", "x").put("sha", "abc123");
            return ok(p.matches(".*/\\d+$") || p.matches(".*/templates/.+") || p.startsWith("/licenses/")
                || p.startsWith("/users/") && !p.substring(7).contains("/") || p.equals("/version") || p.equals("/nodeinfo")
                ? one.encode() : new JsonArray().add(one).encode());
        };
    }

    private static ForgejoApp.Reply ok(String body) { return new ForgejoApp.Reply(200, body, "application/json"); }

    @Test
    void прогонНаЗаглушке_зелёный_сЦепочкойRef() {
        ForgejoReadProbes.Report rep = ForgejoReadProbes.run(REG, PROBES, fakeForgejo(false, false));
        List<ForgejoReadProbes.Result> bad = rep.results().stream().filter(r -> !r.pass()).toList();
        assertTrue(bad.isEmpty(), "упали: " + bad);
        assertEquals(PROBES.probes().size(), rep.total());
        assertEquals(rep.total(), rep.passed());
        ForgejoReadProbes.Result status = rep.results().stream().filter(r -> r.route().equals("get_commit_status")).findFirst().orElseThrow();
        assertEquals("found", status.outcome(), "sha из list_repo_commits доехал по $ref");
    }

    @Test
    void позитивныйКонтроль_неСовпалПоле_FAIL() {
        ForgejoReadProbes.Report rep = ForgejoReadProbes.run(REG, PROBES, fakeForgejo(false, true));
        ForgejoReadProbes.Result pr = rep.results().stream().filter(r -> r.route().equals("get_pull_request")).findFirst().orElseThrow();
        assertFalse(pr.pass(), "PR #1827 вернул чужой номер — проба обязана упасть");
        assertTrue(pr.note().contains("number"), pr.note());
    }

    @Test
    void refНаПустойСписок_SKIP_сПричиной_неPASS() {
        ForgejoReadProbes.Report rep = ForgejoReadProbes.run(REG, PROBES, fakeForgejo(true, false));
        ForgejoReadProbes.Result issue = rep.results().stream().filter(r -> r.route().equals("get_issue")).findFirst().orElseThrow();
        assertEquals("skip", issue.verdict(), "нет issue — get_issue не проверен, это не зелёный");
        assertTrue(issue.note().contains("list_issues"), issue.note());
        assertEquals(1, rep.skipped() >= 1 ? 1 : 0);
    }

    @Test
    void отказАпстрима_FAIL_сКодом() {
        ForgejoReadProbes.Report rep = ForgejoReadProbes.run(REG, PROBES,
            (m, p, b) -> new ForgejoApp.Reply(500, "{\"message\":\"boom\"}", "application/json"));
        ForgejoReadProbes.Result v = rep.results().stream().filter(r -> r.route().equals("get_server_version")).findFirst().orElseThrow();
        assertFalse(v.pass());
        assertEquals("failed", v.outcome());
        assertTrue(v.note().contains("UPSTREAM_5XX"), v.note());
        ForgejoReadProbes.Result log = rep.results().stream().filter(r -> r.route().equals("get_job_log")).findFirst().orElseThrow();
        assertTrue(log.pass(), "get_job_log ожидаемо refused и до апстрима не доходит");
    }
}
