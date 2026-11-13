package studio.seer.heimdall.lore;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;
import org.junit.jupiter.api.Assumptions;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_ROADMAP_PER_PROJECT/RM-P13 — проба двух ASSUMED до кода миграции.
 *
 * <p>Решение владельца 04.11: время в корпусе — DATETIME «как в мануалах ArcadeDB».
 * План требует, чтобы выдача осталась однозначным UTC (ISO-8601 с {@code Z}), иначе
 * браузер читает «2026-04-13 00:00:00» как МЕСТНОЕ время. Перед миграцией 11 354
 * строк нужно знать факт, а не предположение:</p>
 * <ol>
 *   <li>JSON-выдача {@code /api/v1/query} печатает DATETIME по {@code dateTimeFormat}
 *       БАЗЫ, и {@code ALTER DATABASE `arcadedb.dateTimeFormat`} это меняет;</li>
 *   <li>ALTER действует только на свою базу — на прод-сервере рядом пять чужих.</li>
 * </ol>
 * <p>Плюс контроль: ISO-строка с {@code Z} пишется в DATETIME без формата, и
 * min()/max() по DATETIME работают (по строке-дате они давали 500).</p>
 *
 * <p>Идёт в CI против тестового сервера (LORE_TEST_DB_URL), в СВОИХ двух базах,
 * которые создаёт и удаляет сам. system_aida_lore и lore_ci_test не трогает.
 * Каждое наблюдение печатается — при провале видно фактическую выдачу.</p>
 */
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class DateTimeFormatProbeLiveDbTest {

    // Имена пробных баз — от базы ПРОГОНА (LORE_TEST_DB_NAME: lore_ci_pr_859,
    // lore_ci_push_develop…), а не общие на весь CI-сервер. С общими именами два
    // параллельных прогона (push в develop + PR develop→preprod, 07.11.2026)
    // сносили базы друг друга: один падал на create, другой ловил 404
    // «Database not found» посреди теста.
    static final String RUN = System.getenv().getOrDefault("LORE_TEST_DB_NAME", "lore");
    static final String A = RUN + "_rmp13_probe_a";
    static final String B = RUN + "_rmp13_probe_b";
    static final String ISO_FMT = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'";
    static String url;
    static String auth;

    static String post(String path, String json) throws Exception {
        HttpResponse<String> r = LiveDbHttp.client().send(HttpRequest.newBuilder(URI.create(url + path))
                .header("Authorization", auth).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8)).build(),
            HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        System.out.println("[RM-P13 probe] POST " + path + " " + json + " → " + r.statusCode() + " " + r.body());
        return r.statusCode() + " " + r.body();
    }

    static String sql(String db, String command) throws Exception {
        return post("/api/v1/command/" + db,
            "{\"language\":\"sql\",\"command\":" + jsonStr(command) + "}");
    }

    static String query(String db, String q) throws Exception {
        return post("/api/v1/query/" + db, "{\"language\":\"sql\",\"command\":" + jsonStr(q) + "}");
    }

    /** Значение ts первой строки ответа "200 {json}" — точно, а не подстрокой. */
    static String tsOf(String resp) {
        String json = resp.substring(resp.indexOf(' ') + 1);
        io.vertx.core.json.JsonArray rows = new io.vertx.core.json.JsonObject(json).getJsonArray("result");
        assertNotNull(rows, "нет result в ответе: " + resp);
        assertFalse(rows.isEmpty(), "пустой result: " + resp);
        return String.valueOf(rows.getJsonObject(0).getValue("ts"));
    }

    static String jsonStr(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    @BeforeAll
    static void setUp() throws Exception {
        // Fail-closed в CI: Gradle печатает только упавшие тесты, и пропущенная проба
        // была бы неотличима от прошедшей — «зелёный» ничего не доказывал бы. В CI
        // LORE_TEST_DB_URL задаётся всегда; нет его там — это поломка, а не повод молчать.
        String raw = System.getenv("LORE_TEST_DB_URL");
        boolean ci = "true".equals(System.getenv("GITHUB_ACTIONS")) || "true".equals(System.getenv("CI"));
        if (raw == null || raw.isBlank()) {
            if (ci) fail("RM-P13 probe: в CI нет LORE_TEST_DB_URL — проба не выполнилась бы, а зелёный выглядел бы подтверждением");
            Assumptions.abort("локально без LORE_TEST_DB_URL проба не запускается");
        }
        url = raw.replaceAll("/+$", "");
        String pw = System.getenv().getOrDefault("LORE_TEST_DB_PASSWORD", "playwithdata");
        auth = "Basic " + Base64.getEncoder().encodeToString(("root:" + pw).getBytes(StandardCharsets.UTF_8));
        for (String db : new String[]{A, B}) {
            post("/api/v1/server", "{\"command\":\"drop database " + db + "\"}");   // хвост прошлого прогона
            assertTrue(post("/api/v1/server", "{\"command\":\"create database " + db + "\"}").startsWith("200"),
                "создать пробную базу " + db);
            sql(db, "CREATE DOCUMENT TYPE Probe");
            sql(db, "CREATE PROPERTY Probe.ts DATETIME");
        }
    }

    @AfterAll
    static void tearDown() throws Exception {
        if (url == null) return;
        for (String db : new String[]{A, B}) post("/api/v1/server", "{\"command\":\"drop database " + db + "\"}");
    }

    @Test
    void isoZStringIsAcceptedIntoDatetimeAndFormatIsPerDatabase() throws Exception {
        // контроль: ISO-8601 с Z пишется в DATETIME без dateTimeFormat
        for (String db : new String[]{A, B}) {
            String ins = sql(db, "INSERT INTO Probe SET ts = '2026-11-04T19:56:10.171Z'");
            assertTrue(ins.startsWith("200"), "ISO-Z строка в DATETIME принята (" + db + "): " + ins);
        }
        String before = query(A, "SELECT ts FROM Probe");
        String defVal = tsOf(before);
        // Вид выдачи ПО УМОЛЧАНИЮ — на него опирается нормализация на бэкенде (вариант
        // «база в формате по умолчанию, ISO-Z формирует бэкенд»). Точная форма, не подстрока.
        assertTrue(defVal.matches("\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}(\\.\\d{1,9})?"),
            "формат по умолчанию — «yyyy-MM-dd HH:mm:ss[.fraction]». Факт: " + defVal);

        // допущение 1: ALTER DATABASE меняет вид выдачи
        // двойные кавычки SQL-строки: в формате сами одинарные ('T', 'Z')
        String alter = sql(A, "ALTER DATABASE `arcadedb.dateTimeFormat` \"" + ISO_FMT + "\"");
        assertTrue(alter.startsWith("200"), "ALTER DATABASE dateTimeFormat принят: " + alter);
        String afterA = query(A, "SELECT ts FROM Probe");
        // ЗАМЕР 05.11.2026 (CI, ArcadeDB 26.10.2): после ALTER выдача —
        // «2026-11-04T19:56:10.171Z.171», не ISO: expandFormatToPrecision дописывает .SSS к
        // формату, не кончающемуся на S. Поэтому V56 (RM-P13) формат базы НЕ трогает, а ISO-Z
        // дописывает бэкенд (LoreTimeFormatResponseFilter). Этот тест фиксирует ПРИЧИНУ
        // решения: если новая версия движка отдаст ровно ISO — он упадёт и скажет, что
        // решение можно пересмотреть. Точное значение, не contains (contains пропускал хвост).
        assertEquals("2026-11-04T19:56:10.171Z.171", tsOf(afterA),
            "поведение ALTER dateTimeFormat изменилось — пересмотреть решение RM-P13 «формат базы не трогаем». "
            + "По умолчанию было: " + defVal);

        // допущение 2: соседняя база не задета
        String afterB = query(B, "SELECT ts FROM Probe");
        assertEquals(defVal, tsOf(afterB), "ALTER базы A НЕ должен менять выдачу базы B");

        // контроль: min()/max() по DATETIME работают (по строке-дате — 500)
        String mm = query(A, "SELECT min(ts) AS mn, max(ts) AS mx FROM Probe");
        assertTrue(mm.startsWith("200"), "min/max по DATETIME: " + mm);
    }
}
