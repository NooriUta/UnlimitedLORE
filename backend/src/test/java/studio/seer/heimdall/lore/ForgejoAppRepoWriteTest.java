package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_FORGEJO_MINIAPP/FJ-06 — запись в репозиторий через миниапп: правила маршрута по значению аргумента
 * (rules в реестре) — защищённые ветки не удаляются никогда, тег релиза v* — только full и с подтверждением;
 * новые маршруты тегов и вложений релиза; загрузка вложения (multipart) честно не исполняется.
 */
class ForgejoAppRepoWriteTest {

    private static final ForgejoRoutes REG = ForgejoRoutes.load();

    private static JsonObject repo() { return new JsonObject().put("owner", "AIDA").put("repo", "UnlimitedLORE"); }

    private static ForgejoApp.Outcome run(String route, JsonObject args, String role, String approval, ForgejoAppTest.Stub up) {
        return ForgejoApp.execute(REG, route, args, role, approval, true, up);
    }

    private static JsonObject error(ForgejoApp.Outcome o) { return o.envelope().getJsonObject("error"); }

    @Test
    void защищённаяВетка_неУдаляетсяНикогда_дажеСПодтверждением() {
        for (String b : new String[]{"develop", "preprod", "main"}) {
            ForgejoAppTest.Stub up = new ForgejoAppTest.Stub();
            ForgejoApp.Outcome o = run("delete_branch", repo().put("branch", b), "full", "{\"message_ref\":\"x\"}", up);
            assertEquals(409, o.http(), b);
            assertEquals("REFUSED", error(o).getString("code"), b);
            assertTrue(error(o).getString("detail").contains("защищ"), error(o).encode());
            assertTrue(up.calls.isEmpty(), b + ": апстрим не зван");
        }
    }

    @Test
    void обычнаяВетка_удаляетсяТолькоСПодтверждением() {
        ForgejoAppTest.Stub up = new ForgejoAppTest.Stub();
        ForgejoApp.Outcome o = run("delete_branch", repo().put("branch", "feat/old"), "full", null, up);
        assertEquals(428, o.http());
        assertEquals("APPROVAL_REQUIRED", error(o).getString("code"));
        assertTrue(up.calls.isEmpty());
    }

    @Test
    void createTag_обычныйТег_developer_исполняется() {
        assertNotNull(REG.get("create_tag"), "маршрут create_tag заведён записью");
        ForgejoAppTest.Stub up = new ForgejoAppTest.Stub();
        up.body = "{\"name\":\"probe-1\"}";
        ForgejoApp.Outcome o = run("create_tag", repo().put("tag_name", "probe-1").put("target", "develop"), "developer", null, up);
        assertEquals(200, o.http(), o.envelope().encode());
        assertEquals("POST /repos/AIDA/UnlimitedLORE/tags", up.calls.get(0));
        assertEquals("probe-1", new JsonObject(up.bodies.get(0)).getString("tag_name"));
    }

    @Test
    void тегРелизаV_толькоFull_иСПодтверждением() {
        ForgejoAppTest.Stub dev = new ForgejoAppTest.Stub();
        ForgejoApp.Outcome o = run("create_tag", repo().put("tag_name", "v1.20.0").put("target", "main"), "developer", null, dev);
        assertEquals(403, o.http());
        assertEquals("FORBIDDEN_FOR_ROLE", error(o).getString("code"));
        assertTrue(error(o).getString("detail").contains("v"), error(o).encode());
        ForgejoAppTest.Stub full = new ForgejoAppTest.Stub();
        ForgejoApp.Outcome f = run("create_tag", repo().put("tag_name", "v1.20.0").put("target", "main"), "full", null, full);
        assertEquals(428, f.http());
        assertEquals("APPROVAL_REQUIRED", error(f).getString("code"));
        assertTrue(dev.calls.isEmpty() && full.calls.isEmpty());
    }

    @Test
    void deleteTag_разрушающий_сПодтверждением() {
        ForgejoRoutes.Route r = REG.get("delete_tag");
        assertNotNull(r);
        assertEquals("high", r.risk());
        assertEquals(java.util.List.of("full"), r.roles());
    }

    @Test
    void вложенияРелиза_удаление_и_честныйОтказЗагрузки() {
        ForgejoAppTest.Stub up = new ForgejoAppTest.Stub();
        up.status = 204;
        up.body = "";
        ForgejoApp.Outcome d = run("delete_release_asset", repo().put("id", 10).put("attachment_id", 20), "developer", null, up);
        assertEquals(200, d.http(), d.envelope().encode());
        assertEquals("DELETE /repos/AIDA/UnlimitedLORE/releases/10/assets/20", up.calls.get(0));

        ForgejoAppTest.Stub up2 = new ForgejoAppTest.Stub();
        ForgejoApp.Outcome u = run("upload_release_asset", repo().put("id", 10).put("name", "a.zip"), "developer", null, up2);
        assertEquals(501, u.http());
        assertEquals("REFUSED", error(u).getString("code"));
        assertTrue(up2.calls.isEmpty(), "multipart не поддержан — без похода в Forgejo");
    }

    @Test
    void tester_createFile_403() {
        ForgejoAppTest.Stub up = new ForgejoAppTest.Stub();
        ForgejoApp.Outcome o = run("create_file", repo().put("filepath", "a.txt").put("content", "YQ==").put("message", "m"), "tester", null, up);
        assertEquals(403, o.http());
        assertTrue(up.calls.isEmpty());
    }
}
