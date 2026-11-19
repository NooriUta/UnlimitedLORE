package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 — раздел админки «Перенос на новую модель», сервер.
 *
 * <p>Отчёт последнего прогона конвейера (dry-run.json, transfer.json в каталоге прогонов) → группы
 * расхождений со счётом и ссылками на записи; решение человека — правило формата mig-decisions/1 в
 * decisions.json (принимает только человек super-admin, подтверждая своим логином); отмена последнего
 * правила; журнал decisions.log.jsonl. Три честных состояния: «прогона ещё не было», «источник
 * недоступен», «сверка не сошлась» — разные.
 */
class LoreMigrationResourceTest {

    static final ObjectMapper JSON = new ObjectMapper();

    @TempDir Path dir;

    /** Ресурс без Quarkus: каталог — временный, логин человека задаёт тест. */
    static class Res extends LoreMigrationResource {
        String login = "omiloreadmin";
        @Override String humanLogin() { return login; }
    }

    Res res;

    @BeforeEach
    void setUp() {
        res = new Res();
        res.enabled = true;
        res.dir = Optional.of(dir.toString());
    }

    static final String DRY = """
        { "source": "migration_src_2026_11_15", "types": {
            "KnowSprint": { "records": 542, "held": { "pr_refs": 408 },
              "rejects": { "priority · приоритет вне шкалы": { "n": 5, "samples": { "medium": 3, "🟡 MEDIUM (позже)": 2 },
                           "refs": { "medium": ["SPRINT_A", "SPRINT_B"] } } } },
            "KnowPhaseHist": { "records": 90, "held": {},
              "rejects": { "status_raw · статус вне справочника": { "n": 1, "samples": { "🚫 CANCELLED": 1 } } } } } }
        """;

    void write(String name, String text) throws Exception {
        Files.writeString(dir.resolve(name), text, StandardCharsets.UTF_8);
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> body(Response r) {
        return (Map<String, Object>) r.getEntity();
    }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> list(Object o) {
        return (List<Map<String, Object>>) o;
    }

    // ── Честные состояния ────────────────────────────────────────────────

    @Test
    void notConfiguredAndNoReportAreNoRun() throws Exception {
        res.dir = Optional.empty();
        Map<String, Object> a = body(res.get("superadmin"));
        assertEquals("no_run", a.get("state"));
        assertEquals("not_configured", a.get("reason"));

        res.dir = Optional.of(dir.toString());
        a = body(res.get("superadmin"));
        assertEquals("no_run", a.get("state"));
        assertEquals("no_report", a.get("reason"));
    }

    @Test
    void unreadSourceIsSourceUnavailable() throws Exception {
        write("dry-run.json", "{ \"source\": \"src\", \"unread\": [\"KnowTask\"], \"types\": {} }");
        Map<String, Object> a = body(res.get("superadmin"));
        assertEquals("source_unavailable", a.get("state"));
        assertEquals(List.of("KnowTask"), a.get("unread"));
    }

    @Test
    void failedVerifyIsVerifyFailedAndDiffersFromReady() throws Exception {
        write("dry-run.json", DRY);
        assertEquals("ready", body(res.get("superadmin")).get("state"));
        write("transfer.json", "{ \"target\": \"migration_dst_uat\", \"stages\": { \"read\": { \"KnowSprint\": 542 },"
            + " \"write\": { \"records\": { \"KnowSprint\": 542 }, \"leftovers\": 3 }, \"verify\": { \"ok\": false } } }");
        Map<String, Object> a = body(res.get("superadmin"));
        assertEquals("verify_failed", a.get("state"));
        Map<String, Object> verify = list(a.get("stages")).stream().filter(s -> "verify".equals(s.get("key"))).findFirst().orElseThrow();
        assertEquals("failed", verify.get("state"));
    }

    @Test
    void brokenReportIsAnErrorNotAnEmptyRun() throws Exception {
        write("dry-run.json", "{ не json");
        Response r = res.get("superadmin");
        assertEquals(502, r.getStatus(), "битый отчёт — «не смогли прочитать», а не «прогона не было»");
    }

    // ── Группы, строки, счётчик ──────────────────────────────────────────

    @Test
    void groupsByKindWithCountsAndRecordLinks() throws Exception {
        write("dry-run.json", DRY);
        Map<String, Object> a = body(res.get("superadmin"));
        List<String> stages = list(a.get("stages")).stream().map(s -> String.valueOf(s.get("key"))).toList();
        assertEquals(List.of("read", "calc", "merge", "write", "verify"), stages);
        assertEquals(632, ((Number) list(a.get("stages")).get(0).get("n")).intValue(), "прочитано записей — сумма по типам");

        List<Map<String, Object>> groups = list(a.get("groups"));
        Map<String, Object> prio = groups.stream().filter(g -> "приоритет вне шкалы".equals(g.get("why"))).findFirst().orElseThrow();
        assertEquals("reject", prio.get("kind"));
        assertEquals(5, ((Number) prio.get("n")).intValue());
        Map<String, Object> medium = list(prio.get("rows")).get(0);
        assertEquals("KnowSprint", medium.get("type"));
        assertEquals("priority", medium.get("field"));
        assertEquals("medium", medium.get("value"));
        assertEquals(3, ((Number) medium.get("n")).intValue());
        assertEquals(List.of(Map.of("type", "sprint", "id", "SPRINT_A"), Map.of("type", "sprint", "id", "SPRINT_B")), medium.get("refs"));

        Map<String, Object> held = groups.stream().filter(g -> "held".equals(g.get("kind"))).findFirst().orElseThrow();
        assertEquals("pr_refs", list(held.get("rows")).get(0).get("field"));
        assertEquals(408, ((Number) list(held.get("rows")).get(0).get("n")).intValue());

        assertEquals(3, ((Number) a.get("waiting")).intValue(), "строк без решения: medium, MEDIUM(…), CANCELLED");
        assertEquals(1, ((Number) a.get("held_waiting")).intValue(), "удержанное поле pr_refs — отдельно: решается картой, не строкой");
        assertEquals("omiloreadmin", a.get("login"));
    }

    // ── Решение — правило ────────────────────────────────────────────────

    LoreMigrationResource.DecideRequest medium(String confirm) {
        return new LoreMigrationResource.DecideRequest(
            new LoreMigrationResource.Scope("KnowSprint", "priority", "medium", null), "map_to", "normal", null, null, confirm);
    }

    @Test
    void humanSuperAdminAcceptsRuleAndCounterDrops() throws Exception {
        write("dry-run.json", DRY);
        Response r = res.decide(medium("omiloreadmin"), "superadmin");
        assertEquals(200, r.getStatus(), String.valueOf(r.getEntity()));
        Map<String, Object> a = body(r);
        assertEquals(2, ((Number) a.get("waiting")).intValue(), "счётчик убыл на одну строку");

        Map<?, ?> doc = JSON.readValue(dir.resolve("decisions.json").toFile(), Map.class);
        assertEquals("mig-decisions/1", doc.get("format"));
        Map<?, ?> d = (Map<?, ?>) ((List<?>) doc.get("decisions")).get(0);
        assertEquals("ST-01", d.get("id"));
        assertEquals("omiloreadmin", d.get("by"));
        assertEquals("map_to", d.get("action"));
        assertEquals("normal", d.get("to"));
        assertEquals(Map.of("type", "KnowSprint", "field", "priority", "value", "medium"), d.get("scope"));

        Map<String, Object> row = list(list(a.get("groups")).get(0).get("rows")).get(0);
        assertEquals("ST-01", ((Map<?, ?>) row.get("decision")).get("id"));

        List<String> log = Files.readAllLines(dir.resolve("decisions.log.jsonl"));
        assertEquals(1, log.size());
        assertTrue(log.get(0).contains("\"op\":\"add\"") && log.get(0).contains("omiloreadmin"), log.get(0));
    }

    @Test
    void onlyHumanSuperAdminWithOwnLogin() throws Exception {
        write("dry-run.json", DRY);
        assertThrows(LoreExceptions.Forbidden.class, () -> res.decide(medium("omiloreadmin"), "admin"));
        assertThrows(LoreExceptions.Forbidden.class, () -> res.get("admin"));
        assertEquals(400, res.decide(medium("someone-else"), "superadmin").getStatus(), "подтверждение — свой логин");
        res.login = null; // агент или вход без человека
        Response r = res.decide(medium(null), "superadmin");
        assertEquals(403, r.getStatus());
        assertEquals("HUMAN_ONLY", ((LoreResourceBase.LoreError) r.getEntity()).error());
        assertFalse(Files.exists(dir.resolve("decisions.json")), "ничего не записано");
    }

    @Test
    void invalidRuleIsRejectedBeforeWriting() throws Exception {
        write("dry-run.json", DRY);
        Response r = res.decide(new LoreMigrationResource.DecideRequest(
            new LoreMigrationResource.Scope("KnowSprint", "priority", "medium", null), "map_to", "", null, null, "omiloreadmin"), "superadmin");
        assertEquals(400, r.getStatus());
        r = res.decide(new LoreMigrationResource.DecideRequest(
            new LoreMigrationResource.Scope("KnowSprint", "priority", "medium", "x"), "drop", null, null, null, "omiloreadmin"), "superadmin");
        assertEquals(400, r.getStatus(), "в области одно из двух — значение или причина");
        r = res.decide(new LoreMigrationResource.DecideRequest(
            new LoreMigrationResource.Scope("KnowSprint", "priority", "medium", null), "erase", null, null, null, "omiloreadmin"), "superadmin");
        assertEquals(400, r.getStatus());
        assertFalse(Files.exists(dir.resolve("decisions.json")));
    }

    @Test
    void undoLastRuleRestoresReplacedOne() throws Exception {
        write("dry-run.json", DRY);
        assertEquals(200, res.decide(medium("omiloreadmin"), "superadmin").getStatus());
        // повторное решение по той же области заменяет прежнее
        assertEquals(200, res.decide(new LoreMigrationResource.DecideRequest(
            new LoreMigrationResource.Scope("KnowSprint", "priority", "medium", null), "to_note", null, null, null, "omiloreadmin"), "superadmin").getStatus());
        Map<?, ?> doc = JSON.readValue(dir.resolve("decisions.json").toFile(), Map.class);
        assertEquals(1, ((List<?>) doc.get("decisions")).size());

        Response u = res.undo(new LoreMigrationResource.UndoRequest("omiloreadmin"), "superadmin");
        assertEquals(200, u.getStatus(), String.valueOf(u.getEntity()));
        doc = JSON.readValue(dir.resolve("decisions.json").toFile(), Map.class);
        Map<?, ?> back = (Map<?, ?>) ((List<?>) doc.get("decisions")).get(0);
        assertEquals("map_to", back.get("action"), "вернулось прежнее правило");

        assertEquals(200, res.undo(new LoreMigrationResource.UndoRequest("omiloreadmin"), "superadmin").getStatus());
        doc = JSON.readValue(dir.resolve("decisions.json").toFile(), Map.class);
        assertEquals(0, ((List<?>) doc.get("decisions")).size());
        assertEquals(400, res.undo(new LoreMigrationResource.UndoRequest("omiloreadmin"), "superadmin").getStatus(), "отменять больше нечего");
        assertEquals(4, Files.readAllLines(dir.resolve("decisions.log.jsonl")).size(), "журнал: два правила и две отмены");
    }

    @Test
    void existingDecisionFileOfOtherFormatIsNotOverwritten() throws Exception {
        write("dry-run.json", DRY);
        write("decisions.json", "{ \"format\": \"other\", \"decisions\": [] }");
        assertEquals(502, res.decide(medium("omiloreadmin"), "superadmin").getStatus());
        assertTrue(Files.readString(dir.resolve("decisions.json")).contains("other"));
    }

    // ── Копия с выключенным входом: логин-заглушка (как lore.dev.mock-sub) ──

    @Test
    void mockLoginOnlyWithAuthOffAndMockSub() {
        assertEquals("alice", LoreMigrationResource.resolveLogin("alice", true, null, "rehearsal"), "логин токена — всегда он");
        assertNull(LoreMigrationResource.resolveLogin(null, true, "sub-1", "rehearsal"), "вход включён — заглушки нет");
        assertNull(LoreMigrationResource.resolveLogin(null, false, null, "rehearsal"), "без mock-sub — заглушки нет");
        assertNull(LoreMigrationResource.resolveLogin(null, false, "sub-1", " "), "логин-заглушка не задана");
        assertEquals("rehearsal", LoreMigrationResource.resolveLogin(null, false, "sub-1", "rehearsal"));
    }

    // ── Запуск конвейера — точка расширения ──────────────────────────────

    @Test
    void runIsHonestlyNotConnected() {
        Response r = res.run(new LoreMigrationResource.RunRequest("recheck"), "superadmin");
        assertEquals(501, r.getStatus());
        assertEquals("RUN_NOT_CONNECTED", ((LoreResourceBase.LoreError) r.getEntity()).error());
        assertEquals(400, res.run(new LoreMigrationResource.RunRequest("format-disk"), "superadmin").getStatus());
        assertThrows(LoreExceptions.Forbidden.class, () -> res.run(new LoreMigrationResource.RunRequest("trial"), "admin"));
    }
}
