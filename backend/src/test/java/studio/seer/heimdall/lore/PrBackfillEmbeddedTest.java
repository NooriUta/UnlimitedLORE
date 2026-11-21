package studio.seer.heimdall.lore;

import com.arcadedb.database.Database;
import com.arcadedb.database.DatabaseFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MD-05 · дотяжка данных PR на настоящей ArcadeDB (встроенный движок): SQL отбора
 * кандидатов и записи — те же, что у серверной операции; git-хост — заглушка Forgejo.
 */
class PrBackfillEmbeddedTest {

    private Path dir;
    private DatabaseFactory factory;
    private Database db;

    @BeforeEach
    void open() throws Exception {
        dir = Files.createTempDirectory("lore-pr-backfill-");
        factory = new DatabaseFactory(dir.resolve("db").toString());
        db = factory.create();
        db.transaction(() -> {
            db.command("sql", "CREATE VERTEX TYPE KnowPR");
            db.command("sql", "CREATE PROPERTY KnowPR.pr_uid STRING");
            db.command("sql", "CREATE PROPERTY KnowPR.merged_at DATETIME");
            db.command("sql", "CREATE INDEX ON KnowPR (pr_uid) UNIQUE");
            // полный PR — не кандидат
            db.command("sql", "INSERT INTO KnowPR SET pr_uid='NooriUta/UnlimitedLORE#1683', pr_number=1683, git_project='NooriUta/UnlimitedLORE', "
                + "title='ci(migrate): …', url='https://git.seidrstudio.pro/AIDA/UnlimitedLORE/pulls/1683', state='merged', merged_at='2026-11-21 06:43:14'");
            // только ключ — как писали мерж до #1641 и task_link rel=pr
            db.command("sql", "INSERT INTO KnowPR SET pr_uid='NooriUta/UnlimitedLORE#1681', pr_number=1681, git_project='NooriUta/UnlimitedLORE', "
                + "url='https://git.seidrstudio.pro/AIDA/UnlimitedLORE/pulls/1681'");
            // чужой репозиторий (github.com)
            db.command("sql", "INSERT INTO KnowPR SET pr_uid='NooriUta/aida-documentation#3', pr_number=3, git_project='NooriUta/aida-documentation'");
        });
    }

    @AfterEach
    void close() {
        if (db != null) db.drop();
        if (factory != null) factory.close();
    }

    private PrBackfill.Store store() {
        return new PrBackfill.Store() {
            @Override public List<Map<String, Object>> candidates(String after, int limit) {
                List<Map<String, Object>> out = new ArrayList<>();
                db.query("sql", PrBackfill.candidatesSql(limit), Map.of("cursor", after == null ? "" : after))
                    .stream().forEach(r -> out.add(r.toMap()));
                return out;
            }
            @Override public Map<String, Object> row(String prUid) {
                var rs = db.query("sql", PrBackfill.ROW_SQL, Map.of("uid", prUid));
                return rs.hasNext() ? rs.next().toMap() : null;
            }
            @Override public void write(String prUid, Map<String, Object> fields) {
                Map<String, Object> p = new LinkedHashMap<>(fields);
                p.put("uid", prUid);
                db.transaction(() -> db.command("sql", PrBackfill.writeSql(fields.keySet()), p));
            }
        };
    }

    private final PrBackfill.GitHost forgejo = (gp, n, url) -> {
        if (gp.equals("NooriUta/aida-documentation"))
            return PrBackfill.Fetch.skip(PrBackfill.FOREIGN_REPO, "чужой git-хост github.com — токен моста туда не отправляется");
        return PrBackfill.fromForgejo("AIDA/UnlimitedLORE", n, 200,
            "{\"title\":\"fix(x): y (SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01)\",\"html_url\":\"https://git.seidrstudio.pro/AIDA/UnlimitedLORE/pulls/" + n
                + "\",\"merged\":true,\"merged_at\":\"2026-11-21T06:00:00Z\",\"state\":\"closed\",\"head\":{\"ref\":\"fix/x\"},\"base\":{\"ref\":\"develop\"}}");
    };

    private Map<String, Object> row(String uid) {
        return db.query("sql", "SELECT FROM KnowPR WHERE pr_uid=:u", Map.of("u", uid)).next().toMap();
    }

    @Test
    void дотянут_пропуск_с_причиной_повтор_ноль() {
        Map<String, Object> r1 = PrBackfill.run(store(), forgejo, null, 100, false);
        assertEquals(2, r1.get("scanned"), "полный PR не кандидат");
        assertEquals(1, r1.get("updated"));
        assertEquals(1, r1.get("skipped"));
        Map<String, Object> pr = row("NooriUta/UnlimitedLORE#1681");
        assertEquals("fix(x): y (SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01)", pr.get("title"));
        assertEquals("merged", pr.get("state"));
        assertNotNull(pr.get("merged_at"), "дата мержа записана в DATETIME-поле");
        assertEquals("develop", pr.get("base_ref"));
        assertNull(row("NooriUta/aida-documentation#3").get("title"), "чужой — без пустой подписи");

        Map<String, Object> r2 = PrBackfill.run(store(), forgejo, null, 100, false);
        assertEquals(0, r2.get("updated"), "повтор — 0 изменений");
        assertEquals(1, r2.get("skipped"), "чужой снова пропущен с той же причиной");
        assertEquals(LoreOutcome.UNCHANGED, r2.get("outcome"));
    }
}
