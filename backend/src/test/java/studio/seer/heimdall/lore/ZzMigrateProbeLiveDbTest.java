package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * ВРЕМЕННЫЙ ПРОБНИК (не коммитить) — разбор падения CI «LORE migrate live check»
 * на PR #1797. Воспроизводит накатку V94+V95 на БД с легаси-данными KnowTag:
 * встроенная ArcadeDB, ручной прогон SQL шагов из реестра через тот же HTTP
 * /command, повтор для идемпотентности.
 */
class ZzMigrateProbeLiveDbTest {

    static final String PW = "playwithdata";
    static HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    static String post(String url, String json) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
            .header("Content-Type", "application/json")
            .header("Authorization", "Basic " + java.util.Base64.getEncoder().encodeToString(("root:" + PW).getBytes()))
            .POST(HttpRequest.BodyPublishers.ofString(json))
            .build();
        HttpResponse<String> r = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
        return r.statusCode() + " " + r.body();
    }

    static String cmd(String api, String db, String sql) throws Exception {
        return post(api + "/command/" + db, "{\"language\":\"sql\",\"command\":"
            + new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(sql) + "}");
    }

    @Test
    void v94v95OnLegacyKnowTagData() throws Exception {
        String api = LoreEmbeddedArcadeDb.url(PW);
        String db = "zz_probe_" + System.currentTimeMillis();
        String created = post(api + "/server", "{\"command\":\"create database " + db + "\"}");
        System.out.println("[PROBE] create db → " + created);
        assertTrue(created.contains("\"ok\"") || created.contains("\"OK\""), "create db: " + created);

        // ── легаси-сид, похожий на прод: KnowTag только с tag_id, свободные токены ──
        List<String> seed = List.of(
            "CREATE VERTEX TYPE KnowTag IF NOT EXISTS EXTENDS V",
            "CREATE PROPERTY KnowTag.tag_id IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowTag (tag_id) UNIQUE",
            "CREATE VERTEX TYPE KnowADR IF NOT EXISTS EXTENDS V",
            "CREATE PROPERTY KnowADR.adr_id IF NOT EXISTS STRING",
            "CREATE INDEX IF NOT EXISTS ON KnowADR (adr_id) UNIQUE",
            "CREATE EDGE TYPE TAGGED_WITH IF NOT EXISTS",
            "INSERT INTO KnowTag SET tag_id='security'",
            "INSERT INTO KnowTag SET tag_id='линияжизни'",
            "INSERT INTO KnowTag SET tag_id='a.b-c_d.'",
            "INSERT INTO KnowTag SET tag_id='" + "x".repeat(64) + "'",
            "INSERT INTO KnowADR SET adr_id='ADR-PROBE-1'",
            "CREATE EDGE TAGGED_WITH FROM (SELECT FROM KnowADR WHERE adr_id='ADR-PROBE-1') TO (SELECT FROM KnowTag WHERE tag_id='security')"
        );
        List<String> failures = new ArrayList<>();
        for (String sql : seed) {
            String out = cmd(api, db, sql);
            if (!out.startsWith("200")) failures.add("SEED «" + sql + "» → " + out);
        }
        assertTrue(failures.isEmpty(), "сид: " + failures);

        // ── прогон V94 и V95 из реестра (SQL строки — как в раннере) ──
        List<String> report = new ArrayList<>();
        for (int pass = 1; pass <= 2; pass++) {
            for (LoreSchemaMigrations.Step s : LoreSchemaMigrations.STEPS) {
                if (s.version() != 94 && s.version() != 95) continue;
                for (String sql : s.sql()) {
                    String out = cmd(api, db, sql);
                    boolean ok = out.startsWith("200");
                    report.add("pass" + pass + " V" + s.version() + " «" + sql + "» → " + (ok ? "OK" : out));
                    if (!ok) failures.add("pass" + pass + " V" + s.version() + ": " + out);
                }
            }
        }
        report.forEach(r -> System.out.println("[PROBE] " + r));

        // ── контроль: записи KnowTag не тронуты, новые поля читаются ──
        String rows = cmd(api, db, "SELECT tag_id, name, title, source, synonyms, field_schema, owner FROM KnowTag ORDER BY tag_id");
        System.out.println("[PROBE] KnowTag после: " + rows);
        assertTrue(failures.isEmpty(), "V94/V95 на легаси-данных: " + failures);
        String dropped = post(api + "/server", "{\"command\":\"drop database " + db + "\"}");
        System.out.println("[PROBE] drop db → " + (dropped.length() > 120 ? dropped.substring(0, 120) : dropped));
    }
}
