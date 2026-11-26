package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_FORGEJO_MINIAPP/FJ-04 — «два пространства слагов»: агент может дать либо owner+repo хоста
 * (AIDA/UnlimitedLORE), либо слаг проекта LORE git_project (NooriUta/UnlimitedLORE). Резолв — в исполнителе,
 * через реестр проектов (ForgejoBridge.resolve), и только на НАШ Forgejo: проект с primary на другом хосте —
 * отказ, а не вызов чужого API нашим токеном.
 */
class ForgejoAppGitProjectTest {

    private static final ForgejoRoutes REG = ForgejoRoutes.load();
    private static final String OUR = "https://git.seidrstudio.pro";

    /** Реестр проектов: NooriUta/UnlimitedLORE → наш хост AIDA/UnlimitedLORE; Foreign/X → чужой хост. */
    private static final ForgejoApp.Projects PROJECTS = slug -> Optional.ofNullable(Map.of(
        "NooriUta/UnlimitedLORE", new ForgejoBridge.Repo(OUR, "AIDA", "UnlimitedLORE"),
        "Foreign/X", new ForgejoBridge.Repo("https://github.com", "someone", "x")).get(slug));

    private static ForgejoApp.Outcome run(String route, JsonObject args, ForgejoAppTest.Stub up) {
        return ForgejoApp.execute(REG, route, args, "developer", null, true, up, OUR, PROJECTS);
    }

    private static JsonObject error(ForgejoApp.Outcome o) { return o.envelope().getJsonObject("error"); }

    @Test
    void слагПроектаLore_резолвитсяВOwnerRepoХоста() {
        ForgejoAppTest.Stub up = new ForgejoAppTest.Stub();
        up.body = "{\"number\":1827}";
        ForgejoApp.Outcome o = run("get_pull_request", new JsonObject().put("git_project", "NooriUta/UnlimitedLORE").put("index", 1827), up);
        assertEquals(200, o.http(), o.envelope().encode());
        assertEquals("GET /repos/AIDA/UnlimitedLORE/pulls/1827", up.calls.get(0));
    }

    @Test
    void ownerRepo_по_прежнему_работают_безGitProject() {
        ForgejoAppTest.Stub up = new ForgejoAppTest.Stub();
        up.body = "{}";
        ForgejoApp.Outcome o = run("get_repo", new JsonObject().put("owner", "AIDA").put("repo", "UnlimitedLORE"), up);
        assertEquals(200, o.http());
        assertEquals("GET /repos/AIDA/UnlimitedLORE", up.calls.get(0));
    }

    @Test
    void gitProject_иOwnerВместе_отказ_апстримНеЗван() {
        ForgejoAppTest.Stub up = new ForgejoAppTest.Stub();
        ForgejoApp.Outcome o = run("get_repo", new JsonObject().put("git_project", "NooriUta/UnlimitedLORE").put("owner", "AIDA"), up);
        assertEquals(400, o.http());
        assertEquals("BAD_PARAMS", error(o).getString("code"));
        assertTrue(error(o).getString("detail").contains("git_project"), error(o).encode());
        assertTrue(up.calls.isEmpty());
    }

    @Test
    void неизвестныйПроект_INVALID_VALUE_сПодсказкой() {
        ForgejoAppTest.Stub up = new ForgejoAppTest.Stub();
        ForgejoApp.Outcome o = run("get_repo", new JsonObject().put("git_project", "Nope/Nope"), up);
        assertEquals(400, o.http());
        assertEquals("INVALID_VALUE", error(o).getString("code"));
        assertTrue(error(o).getString("hint").contains("owner"), error(o).encode());
        assertTrue(up.calls.isEmpty());
    }

    @Test
    void проектНаЧужомХосте_отказ_нашТокенТудаНеИдёт() {
        ForgejoAppTest.Stub up = new ForgejoAppTest.Stub();
        ForgejoApp.Outcome o = run("get_repo", new JsonObject().put("git_project", "Foreign/X"), up);
        assertEquals(400, o.http());
        assertEquals("INVALID_VALUE", error(o).getString("code"));
        assertTrue(error(o).getString("detail").contains("github.com"), error(o).encode());
        assertTrue(up.calls.isEmpty());
    }

    @Test
    void маршрутБезOwnerRepo_gitProject_лишнийАргумент() {
        ForgejoAppTest.Stub up = new ForgejoAppTest.Stub();
        ForgejoApp.Outcome o = run("get_server_version", new JsonObject().put("git_project", "NooriUta/UnlimitedLORE"), up);
        assertEquals(400, o.http());
        assertEquals("BAD_PARAMS", error(o).getString("code"));
        assertTrue(up.calls.isEmpty());
    }

    @Test
    void describe_маршрутаСOwnerRepo_показываетGitProject() {
        JsonObject card = LoreForgejoAppResource.describeBody(REG, "get_repo", null, "developer").getJsonObject("data");
        assertTrue(card.encode().contains("git_project"), "агент должен узнать из карточки, что можно дать слаг проекта");
    }
}
