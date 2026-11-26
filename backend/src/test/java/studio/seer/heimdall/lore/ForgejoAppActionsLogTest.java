package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_FORGEJO_MINIAPP/FJ-08 — журналы CI через миниапп по REST Forgejo ≥ 17
 * ({@code GET /repos/{o}/{r}/actions/jobs/{job_id}/logs}, text/plain): без тома .log.zst и без сайдкара.
 * Журнал в диалог — хвост + строки с ошибками; полный — только truncate=false (file/pipe).
 */
class ForgejoAppActionsLogTest {

    private static final ForgejoRoutes REG = ForgejoRoutes.load();

    private static JsonObject repo() { return new JsonObject().put("owner", "AIDA").put("repo", "UnlimitedLORE"); }

    @Test
    void маршрутыДжобИЖурнала_вРеестре_группаActionsRead() {
        for (String[] r : new String[][]{
                {"list_run_jobs", "/repos/{owner}/{repo}/actions/runs/{run_id}/jobs"},
                {"get_job", "/repos/{owner}/{repo}/actions/jobs/{job_id}"},
                {"get_job_logs", "/repos/{owner}/{repo}/actions/jobs/{job_id}/logs"},
                {"list_runs", "/repos/{owner}/{repo}/actions/runs"}}) {
            ForgejoRoutes.Route x = REG.get(r[0]);
            assertNotNull(x, r[0]);
            assertEquals("GET", x.method(), r[0]);
            assertEquals(r[1], x.pathTemplate(), r[0]);
            assertEquals("actions-read", x.group(), r[0]);
        }
    }

    private static String log(int lines, int errorAt) {
        StringBuilder sb = new StringBuilder();
        for (int i = 1; i <= lines; i++)
            sb.append(i == errorAt ? "::error::тест упал: expected 403 but was 200" : "строка " + i).append('\n');
        return sb.toString();
    }

    @Test
    void журнал_вДиалог_хвостИОшибки_сметой() {
        ForgejoAppTest.Stub up = new ForgejoAppTest.Stub();
        up.body = log(5000, 120);
        up.type = "text/plain";
        ForgejoApp.Outcome o = ForgejoApp.execute(REG, "get_job_logs", repo().put("job_id", 41146), "developer", null, true, up);
        assertEquals(200, o.http(), o.envelope().encode());
        assertEquals("GET /repos/AIDA/UnlimitedLORE/actions/jobs/41146/logs", up.calls.get(0));
        String data = o.envelope().getString("data");
        assertTrue(data.contains("строка 5000"), "последняя строка в хвосте");
        assertTrue(data.contains("::error::тест упал"), "строка с ошибкой из начала журнала сохранена");
        assertTrue(!data.contains("строка 2000\n"), "середина без ошибок вырезана");
        JsonObject meta = o.envelope().getJsonObject("meta").getJsonObject("log");
        assertEquals(5000, meta.getInteger("lines_total"));
        assertTrue(meta.getInteger("lines_kept") < 5000);
        assertEquals(1, meta.getInteger("error_lines"));
    }

    @Test
    void журнал_truncateFalse_целиком() {
        ForgejoAppTest.Stub up = new ForgejoAppTest.Stub();
        up.body = log(5000, 120);
        up.type = "text/plain";
        ForgejoApp.Outcome o = ForgejoApp.execute(REG, "get_job_logs", repo().put("job_id", 1), "developer", null, false, up);
        assertEquals(up.body, o.envelope().getString("data"));
    }

    @Test
    void короткийЖурнал_неРежется() {
        ForgejoAppTest.Stub up = new ForgejoAppTest.Stub();
        up.body = log(50, 0);
        up.type = "text/plain";
        ForgejoApp.Outcome o = ForgejoApp.execute(REG, "get_job_logs", repo().put("job_id", 1), "developer", null, true, up);
        assertEquals(up.body, o.envelope().getString("data"));
        assertEquals(50, o.envelope().getJsonObject("meta").getJsonObject("log").getInteger("lines_kept"));
    }

    @Test
    void старыйGetJobLog_подсказываетНовыйМаршрут() {
        ForgejoRoutes.Route r = REG.get("get_job_log");
        assertNotNull(r);
        assertTrue(String.valueOf(r.note()).contains("get_job_logs"), "капабилити-маршрут ведёт на REST get_job_logs");
    }
}
