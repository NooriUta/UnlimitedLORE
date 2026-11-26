package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_FORGEJO_MINIAPP/FJ-05 — запись PR и issues через миниапп: каждый маршрут групп PR и issues-write
 * собирается в правильный вызов Forgejo (метод, путь без «{…}», обязательные поля тела); роли по матрице;
 * кириллица целая; merge — только через гейт моста (forgejo_pr_merge), апстрим merge не зовётся.
 */
class ForgejoAppWriteRoutesTest {

    private static final ForgejoRoutes REG = ForgejoRoutes.load();
    private static final Set<String> GROUPS = Set.of("PR", "issues-write");

    private static List<ForgejoRoutes.Route> writeRoutes() {
        return REG.all().stream().filter(r -> GROUPS.contains(r.group()) && r.via() == null).toList();
    }

    /** Минимальные валидные args по схеме маршрута: owner/repo — наш репозиторий, остальное — по типу. */
    static JsonObject sampleArgs(ForgejoRoutes.Route r) {
        JsonObject a = new JsonObject();
        for (ForgejoRoutes.Param p : r.params().values()) {
            if (!p.required()) continue;
            String n = p.name();
            Object v = switch (String.valueOf(p.type())) {
                case "int", "number" -> 1;
                case "bool" -> true;
                case "enum" -> p.values().get(0);
                case "array" -> "int".equals(p.items()) ? new JsonArray().add(1) : new JsonArray().add("a");
                case "object" -> new JsonObject();
                default -> switch (n) {
                    case "owner" -> "AIDA";
                    case "repo" -> "UnlimitedLORE";
                    case "color" -> "#00aa00";
                    case "head" -> "feat/x";
                    case "base" -> "develop";
                    default -> "x";
                };
            };
            a.put(n, v);
        }
        return a;
    }

    @Test
    void каждыйМаршрутЗаписи_собираетсяВВызовForgejo() {
        List<String> bad = new ArrayList<>();
        for (ForgejoRoutes.Route r : writeRoutes()) {
            ForgejoAppTest.Stub up = new ForgejoAppTest.Stub();
            up.body = "{}";
            ForgejoApp.Outcome o = ForgejoApp.execute(REG, r.name(), sampleArgs(r), "developer", null, true, up);
            if (o.http() != 200) { bad.add(r.name() + ": http " + o.http() + " " + o.envelope().getJsonObject("error")); continue; }
            String call = up.calls.get(0);
            if (!call.startsWith(r.method() + " /repos/AIDA/UnlimitedLORE")) bad.add(r.name() + ": вызов " + call);
            if (call.contains("{") || call.contains("}")) bad.add(r.name() + ": в пути осталась переменная " + call);
            if (Set.of("POST", "PATCH", "PUT").contains(r.method())) {
                JsonObject body = new JsonObject(up.bodies.get(0));
                for (ForgejoRoutes.Param p : r.params().values())
                    if (p.required() && "body".equals(p.in()) && !body.containsKey(p.wire() == null ? p.name() : p.wire()))
                        bad.add(r.name() + ": в теле нет обязательного " + p.name());
            }
        }
        assertTrue(bad.isEmpty(), "маршруты записи собираются неверно: " + bad);
        assertTrue(writeRoutes().size() >= 18, "групп PR + issues-write не меньше 18 маршрутов, найдено " + writeRoutes().size());
    }

    @Test
    void роли_tester_правит_issue_analyst_403_доАпстрима() {
        ForgejoRoutes.Route r = REG.get("edit_issue");
        ForgejoAppTest.Stub up = new ForgejoAppTest.Stub();
        up.body = "{}";
        assertEquals(200, ForgejoApp.execute(REG, "edit_issue", sampleArgs(r), "tester", null, true, up).http());
        ForgejoAppTest.Stub up2 = new ForgejoAppTest.Stub();
        ForgejoApp.Outcome o = ForgejoApp.execute(REG, "edit_issue", sampleArgs(r), "analyst", null, true, up2);
        assertEquals(403, o.http());
        assertEquals("FORBIDDEN_FOR_ROLE", o.envelope().getJsonObject("error").getString("code"));
        assertTrue(up2.calls.isEmpty(), "отказ роли — до похода в Forgejo");
    }

    @Test
    void кириллицаВЗаголовкеИТеле_доходитЦелой() {
        String title = "Задача: ёлка — «кавычки» и эмодзи ✅";
        String text = "Тело с переводом строки\nи символами <>&\"";
        ForgejoAppTest.Stub up = new ForgejoAppTest.Stub();
        up.body = "{\"number\":5}";
        ForgejoApp.Outcome o = ForgejoApp.execute(REG, "create_issue",
            new JsonObject().put("owner", "AIDA").put("repo", "UnlimitedLORE").put("title", title).put("body", text),
            "developer", null, true, up);
        assertEquals(200, o.http());
        JsonObject sent = new JsonObject(up.bodies.get(0));
        assertEquals(title, sent.getString("title"));
        assertEquals(text, sent.getString("body"));
    }

    @Test
    void createPullRequest_теЖеПоляЧтоУforgejo_pr_new() {
        ForgejoAppTest.Stub up = new ForgejoAppTest.Stub();
        up.body = "{\"number\":9}";
        ForgejoApp.execute(REG, "create_pull_request", new JsonObject().put("owner", "AIDA").put("repo", "UnlimitedLORE")
            .put("title", "t").put("body", "b").put("head", "feat/x").put("base", "develop"), "developer", null, true, up);
        assertEquals("POST /repos/AIDA/UnlimitedLORE/pulls", up.calls.get(0));
        // LoreForgejoResource.createPr шлёт ровно {title, body, head, base}
        assertEquals(Set.of("title", "body", "head", "base"), new JsonObject(up.bodies.get(0)).fieldNames());
    }

    @Test
    void merge_толькоЧерезГейт_апстримMergeНеЗовётся() {
        ForgejoRoutes.Route r = REG.get("merge_pull_request");
        assertEquals("forgejo_pr_merge", r.via());
        ForgejoAppTest.Stub dev = new ForgejoAppTest.Stub();
        assertEquals(403, ForgejoApp.execute(REG, "merge_pull_request", sampleArgs(r), "developer", null, true, dev).http());
        ForgejoAppTest.Stub full = new ForgejoAppTest.Stub();
        ForgejoApp.Outcome o = ForgejoApp.execute(REG, "merge_pull_request", sampleArgs(r), "full", null, true, full);
        assertEquals(409, o.http());
        JsonObject err = o.envelope().getJsonObject("error");
        assertEquals("REFUSED", err.getString("code"));
        assertTrue(err.getString("hint").contains("forgejo_pr_merge"), err.encode());
        assertTrue(dev.calls.isEmpty() && full.calls.isEmpty(), "merge мимо гейта CI не уходит в Forgejo ни при какой роли");
    }

    @Test
    void gitProject_работаетИДляЗаписи() {
        ForgejoAppTest.Stub up = new ForgejoAppTest.Stub();
        up.body = "{}";
        ForgejoApp.Projects projects = slug -> "NooriUta/UnlimitedLORE".equals(slug)
            ? java.util.Optional.of(new ForgejoBridge.Repo("https://git.seidrstudio.pro", "AIDA", "UnlimitedLORE"))
            : java.util.Optional.empty();
        ForgejoApp.Outcome o = ForgejoApp.execute(REG, "create_issue_comment",
            new JsonObject().put("git_project", "NooriUta/UnlimitedLORE").put("index", 3).put("body", "ок"),
            "developer", null, true, up, "https://git.seidrstudio.pro", projects);
        assertEquals(200, o.http(), o.envelope().encode());
        assertEquals("POST /repos/AIDA/UnlimitedLORE/issues/3/comments", up.calls.get(0));
        assertFalse(up.bodies.get(0).contains("git_project"), "git_project не уходит в тело Forgejo");
    }
}
