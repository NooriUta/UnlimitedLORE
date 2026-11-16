package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Канал 1 QG (опрос прогонов Actions) на проде не записал ни одного прогона:
 * 15.11.2026 журнал — «записано прогонов 0 из 8068» и 8058 раз «прогон … без даты — пропущен».
 *
 * <p>Корень: код читал поля в форме GitHub ({@code updated_at}, {@code created_at},
 * {@code run_started_at}, {@code head_sha}, {@code url}, {@code head_branch}), а Forgejo
 * отдаёт ActionRun иначе — {@code created}, {@code updated}, {@code started}, {@code stopped},
 * {@code commit_sha}, {@code html_url}, {@code prettyref} (swagger git.seidrstudio.pro, схема ActionRun).
 * Фикстура ниже — в форме ответа Forgejo {@code GET /repos/{o}/{r}/actions/runs}, а не forgejo-mcp.
 */
class QgActionsRunFieldsTest {

    /** Готовый прогон PR-события в форме Forgejo (поля из swagger ActionRun). */
    private static JsonObject forgejoRun() {
        return new JsonObject()
            .put("id", 8105)
            .put("status", "success")
            .put("workflow_id", "lore-ci.yml")
            .put("created", "2026-11-15T19:33:10+01:00")
            .put("updated", "2026-11-15T19:43:27+01:00")
            .put("started", "2026-11-15T19:33:12+01:00")
            .put("stopped", "2026-11-15T19:43:27+01:00")
            .put("commit_sha", "78f7a20f195b041ec1ccbc0f99025c3090593038")
            .put("html_url", "https://git.seidrstudio.pro/AIDA/UnlimitedLORE/actions/runs/8105")
            .put("prettyref", "#1460");
    }

    @Test
    void датаИПоляПрогона_изФормыForgejo() {
        var f = LoreQgActionsPoller.runFields(forgejoRun());
        assertEquals("2026-11-15", f.runDate());
        assertEquals("2026-11-15T19:33:12+01:00", f.startedAt());
        assertEquals("2026-11-15T19:43:27+01:00", f.finishedAt());
        assertEquals("https://git.seidrstudio.pro/AIDA/UnlimitedLORE/actions/runs/8105", f.url());
        assertEquals("78f7a20f195b041ec1ccbc0f99025c3090593038", f.sha());
        assertEquals(1460, f.pr());
    }

    @Test
    void датаЗавершения_побеждает_датуОбновления_иСоздания() {
        var run = forgejoRun().put("stopped", "2026-11-16T00:00:01+00:00");
        assertEquals("2026-11-16", LoreQgActionsPoller.runFields(run).runDate());
        run.remove("stopped");
        assertEquals("2026-11-15", LoreQgActionsPoller.runFields(run).runDate(), "без stopped — updated");
        run.remove("updated");
        assertEquals("2026-11-15", LoreQgActionsPoller.runFields(run).runDate(), "без updated — created");
    }

    @Test
    void безВсехДат_датыНет_аНеВыдуманная() {
        var run = new JsonObject().put("id", 1).put("status", "success");
        assertNull(LoreQgActionsPoller.runFields(run).runDate());
    }

    @Test
    void ветка_неPR_номерPrПустой() {
        var run = forgejoRun().put("prettyref", "develop");
        assertNull(LoreQgActionsPoller.runFields(run).pr());
    }

    /**
     * На проде Forgejo вернул 8068 прогонов при limit=30: заход не должен разбирать весь
     * список — берётся не больше страницы (ответ Forgejo — новые первыми).
     */
    @Test
    void заходБерётНеБольшеСтраницы_дажеЕслиСерверВернулВсё() {
        var runs = new JsonArray();
        for (int i = 0; i < 100; i++) runs.add(forgejoRun().put("id", i));
        assertEquals(30, LoreQgActionsPoller.pageOf(runs, 30).size());
        assertEquals(100, LoreQgActionsPoller.pageOf(runs, 0).size(), "страница ≤ 0 — без обрезки");
        assertEquals(5, LoreQgActionsPoller.pageOf(new JsonArray().add(1).add(2).add(3).add(4).add(5), 30).size());
    }
}
