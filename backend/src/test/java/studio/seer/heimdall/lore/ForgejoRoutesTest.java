package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_FORGEJO_MINIAPP/FJ-01 — реестр маршрутов Forgejo-миниаппа (ADR-LORE-060 R1, SPEC-FORGEJO-APP-060 §3, §7).
 *
 * <p>Реестр — данные ({@code forgejo/forgejo-routes.json}), RBAC — его поле {@code roles[]}. Сторож держит три вещи:
 * у каждого маршрута есть группа матрицы, непустые роли и риск; роли маршрута = строка матрицы §7 его группы
 * (allowlist — новая роль не видит ничего); имена маршрутов, пришедших из forgejo-mcp, = снимок его tools/list.
 */
class ForgejoRoutesTest {

    private static final ForgejoRoutes REG = ForgejoRoutes.load();

    @Test
    void реестрЗагружаетсяВсе107МаршрутовForgejoMcpПлюсЗаписиLore() {
        List<ForgejoRoutes.Route> all = REG.all();
        long fromMcp = all.stream().filter(r -> !"lore".equals(r.origin())).count();
        assertEquals(107, fromMcp, "из forgejo-mcp переносится ВСЁ — 107 маршрутов (104 авто + 3 ручных)");
        assertTrue(all.size() >= 109, "плюс вложения релизов, названные владельцем: " + all.size());
        assertNotNull(REG.get("list_release_assets"));
        assertNotNull(REG.get("get_release_asset"));
    }

    @Test
    void уКаждогоМаршрутаЕстьГруппаНепустыеРолиИРиск() {
        List<String> bad = new ArrayList<>();
        for (ForgejoRoutes.Route r : REG.all()) {
            if (!ForgejoRoutes.GROUP_ROLES.containsKey(r.group())) bad.add(r.name() + ": группа " + r.group());
            if (r.roles() == null || r.roles().isEmpty()) bad.add(r.name() + ": пустые roles[]");
            if (!Set.of("low", "medium", "high").contains(r.risk())) bad.add(r.name() + ": risk " + r.risk());
            if (r.method() == null) bad.add(r.name() + ": нет method");
        }
        assertTrue(bad.isEmpty(), String.join("\n", bad));
    }

    @Test
    void ролиМаршрута_строкаМатрицыЕгоГруппы_кромеАлиасаМержа() {
        List<String> bad = new ArrayList<>();
        for (ForgejoRoutes.Route r : REG.all()) {
            List<String> expected = r.via() != null ? List.of("full") : ForgejoRoutes.GROUP_ROLES.get(r.group());
            if (!new TreeSet<>(expected).equals(new TreeSet<>(r.roles()))) bad.add(r.name() + ": " + r.roles() + " ≠ " + expected);
        }
        assertTrue(bad.isEmpty(), String.join("\n", bad));
    }

    @Test
    void матрица_7профилей_8групп_плюсРазрушающие() {
        assertEquals(Set.of("read", "issues-write", "PR", "file-write", "actions-read", "dispatch", "notifications", "admin",
            "repo-destructive"), ForgejoRoutes.GROUP_ROLES.keySet());
        assertEquals(List.of("full"), ForgejoRoutes.GROUP_ROLES.get("admin"));
        assertEquals(List.of("full"), ForgejoRoutes.GROUP_ROLES.get("repo-destructive"));
        Set<String> profiles = new TreeSet<>();
        ForgejoRoutes.GROUP_ROLES.values().forEach(profiles::addAll);
        assertEquals(Set.of("full", "architect", "developer", "tester", "pm", "analyst", "marketer"), profiles);
    }

    @Test
    void новаяРольНеВидитНиОдногоМаршрута_allowlist() {
        assertTrue(REG.visibleTo("intern").isEmpty());
        assertTrue(REG.visibleTo(null).isEmpty());
        assertEquals(REG.all().size(), REG.visibleTo("full").size());
        assertTrue(REG.visibleTo("analyst").stream().allMatch(r -> "read".equals(r.group())));
    }

    @Test
    void рискHigh_ровноРазрушающиеИDispatch() {
        for (ForgejoRoutes.Route r : REG.all()) {
            boolean high = "repo-destructive".equals(r.group()) || "dispatch".equals(r.group());
            assertEquals(high, "high".equals(r.risk()), r.name());
        }
        for (String n : List.of("delete_repo", "delete_org", "transfer_repo", "delete_branch", "admin_delete_user"))
            assertEquals("repo-destructive", REG.get(n).group(), n);
        assertEquals("dispatch", REG.get("dispatch_workflow").group());
    }

    @Test
    void мерж_маршрутАлиасШтатногоМоста() {
        ForgejoRoutes.Route m = REG.get("merge_pull_request");
        assertEquals("forgejo_pr_merge", m.via());
        assertEquals(List.of("full"), m.roles());
    }

    @Test
    void паритетИмёнСForgejoMcp() throws IOException {
        JsonObject snap;
        try (InputStream in = getClass().getClassLoader().getResourceAsStream("forgejo/forgejo-mcp-tools.json")) {
            snap = new JsonObject(new String(in.readAllBytes(), StandardCharsets.UTF_8));
        }
        Set<String> tools = new TreeSet<>();
        snap.getJsonArray("tools").forEach(o -> tools.add(String.valueOf(o)));
        Set<String> fromMcp = new TreeSet<>();
        for (ForgejoRoutes.Route r : REG.all()) if (!"lore".equals(r.origin())) fromMcp.add(r.name());
        assertEquals(107, tools.size());
        assertEquals(tools, fromMcp, "имена реестра разошлись с tools/list forgejo-mcp");
    }

    @Test
    void триРучныхМаршрута() {
        ForgejoRoutes.Route diff = REG.get("get_pr_diff");
        assertEquals("/repos/{owner}/{repo}/pulls/{index}.diff", diff.pathTemplate());
        assertEquals("text", diff.response());
        ForgejoRoutes.Route del = REG.get("delete_file");
        assertEquals("DELETE", del.method());
        assertEquals("body", del.params().get("sha").in());
        assertEquals("body", del.params().get("message").in());
        assertEquals("file-write", del.group());
        ForgejoRoutes.Route log = REG.get("get_job_log");
        assertNotNull(log.capability(), "get_job_log — не REST, отдельная capability");
    }

    private static final Pattern VAR = Pattern.compile("\\{(\\w+)}");

    @Test
    void переменныеПутиОписаныКакPath_спискиСЛимитом20ИПотолком50() {
        List<String> bad = new ArrayList<>();
        for (ForgejoRoutes.Route r : REG.all()) {
            if (r.pathTemplate() != null) {
                Matcher m = VAR.matcher(r.pathTemplate());
                while (m.find()) {
                    ForgejoRoutes.Param p = r.params().get(m.group(1));
                    if (p == null || !"path".equals(p.in()) || !p.required()) bad.add(r.name() + ": {" + m.group(1) + "}");
                }
            }
            if (r.list()) {
                ForgejoRoutes.Param lim = r.params().get("limit");
                if (lim == null || !Integer.valueOf(50).equals(lim.max()) || !Integer.valueOf(20).equals(lim.dflt()))
                    bad.add(r.name() + ": limit " + lim);
                if (r.params().get("page") == null) bad.add(r.name() + ": нет page");
            }
        }
        assertTrue(bad.isEmpty(), String.join("\n", bad));
        assertTrue(REG.get("list_issues").list());
        assertFalse(REG.get("get_issue").list());
    }

    @Test
    void видыForgejoДляKnowRegistry() {
        List<Map<String, Object>> kinds = REG.kinds();
        assertEquals(REG.all().size(), kinds.size());
        for (Map<String, Object> k : kinds) {
            assertTrue(String.valueOf(k.get("kind")).startsWith("forgejo:"), String.valueOf(k.get("kind")));
            assertTrue(String.valueOf(k.get("content_hash")).startsWith("sha256:"));
            assertEquals(ForgejoRoutes.SOURCE, k.get("source"));
            assertFalse(((List<?>) k.get("roles")).isEmpty());
        }
        Map<String, Object> issues = REG.kind("list_issues");
        assertEquals("forgejo:list_issues", issues.get("kind"));
        assertTrue(KnowRegistrySync.MANAGED.contains("forgejo:"), "forgejo:* — виды этого импорта (снятые считаются)");
        // карточка describe: роли — identities, гейт подтверждения и мост — в каталоге отказов
        Map<String, Object> card = KnowDescribe.describeFull(REG.kind("dispatch_workflow"), null);
        String errors = String.valueOf(card.get("errors"));
        assertTrue(errors.contains("APPROVAL_REQUIRED"), errors);
        assertTrue(errors.contains("FORBIDDEN_FOR_ROLE"), errors);
        assertTrue(errors.contains("UPSTREAM_4XX"), errors);
        assertTrue(String.valueOf(KnowDescribe.describeFull(REG.kind("merge_pull_request"), null).get("errors")).contains("REFUSED"));
    }
}
