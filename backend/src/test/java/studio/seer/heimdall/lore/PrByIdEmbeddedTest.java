package studio.seer.heimdall.lore;

import com.arcadedb.database.Database;
import com.arcadedb.database.DatabaseFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MD-05 · срез паспорта PR {@code pr_by_id} на настоящей ArcadeDB (встроенный движок,
 * без сервера): строка KnowPR по pr_uid, задачи по ребру CLOSED_BY, релизы по SHIPPED_IN, проект — поле git_project
 * и ребро BELONGS_TO_PROJECT без повтора; паспорт собирается из строки и подписывает PR без заголовка ключом.
 */
class PrByIdEmbeddedTest {

    private Path dir;
    private DatabaseFactory factory;
    private Database db;

    @BeforeEach
    void open() throws Exception {
        dir = Files.createTempDirectory("lore-pr-by-id-");
        factory = new DatabaseFactory(dir.resolve("db").toString());
        db = factory.create();
        db.transaction(() -> {
            for (String t : List.of("KnowPR", "KnowTask", "KnowRelease", "KnowGitProject", "KnowSprint", "KnowPhase")) db.command("sql", "CREATE VERTEX TYPE " + t);
            for (String e : List.of("CLOSED_BY", "SHIPPED_IN", "BELONGS_TO_PROJECT", "PART_OF")) db.command("sql", "CREATE EDGE TYPE " + e);
            db.command("sql", "INSERT INTO KnowGitProject SET slug = 'NooriUta/UnlimitedLORE'");
            db.command("sql", "INSERT INTO KnowPR SET pr_uid = 'NooriUta/UnlimitedLORE#1641', pr_number = 1641, "
                + "git_project = 'NooriUta/UnlimitedLORE', title = 'feat: данные PR при мерже', url = 'https://h/AIDA/UnlimitedLORE/pulls/1641', "
                + "state = 'merged', merged_at = '2026-11-20T18:02:11Z', head_ref = 'feat/md05', base_ref = 'develop'");
            // старый PR: только ключ — так их писали мерж и привязка к релизу до #1641
            db.command("sql", "INSERT INTO KnowPR SET pr_uid = 'NooriUta/UnlimitedLORE#700', pr_number = 700, git_project = 'NooriUta/UnlimitedLORE'");
            db.command("sql", "INSERT INTO KnowTask SET task_uid = 'SPRINT_LORE_MODEL_DOCS_TIDY/MD-05'");
            db.command("sql", "INSERT INTO KnowRelease SET release_uid = 'NooriUta/UnlimitedLORE#v1.18.0'");
            db.command("sql", "CREATE EDGE CLOSED_BY FROM (SELECT FROM KnowTask WHERE task_uid = 'SPRINT_LORE_MODEL_DOCS_TIDY/MD-05') "
                + "TO (SELECT FROM KnowPR WHERE pr_uid = 'NooriUta/UnlimitedLORE#1641')");
            db.command("sql", "CREATE EDGE SHIPPED_IN FROM (SELECT FROM KnowPR WHERE pr_uid = 'NooriUta/UnlimitedLORE#1641') "
                + "TO (SELECT FROM KnowRelease WHERE release_uid = 'NooriUta/UnlimitedLORE#v1.18.0')");
            // MD-05: спринт PR — через задачи. Две задачи одного спринта (спринт один раз), задача в фазе (фаза — не спринт).
            db.command("sql", "INSERT INTO KnowSprint SET sprint_id = 'SPRINT_LORE_MODEL_DOCS_TIDY'");
            db.command("sql", "INSERT INTO KnowPhase SET phase_uid = 'SPRINT_LORE_MODEL_DOCS_TIDY/P1'");
            db.command("sql", "INSERT INTO KnowTask SET task_uid = 'SPRINT_LORE_MODEL_DOCS_TIDY/MD-04'");
            for (String t : List.of("SPRINT_LORE_MODEL_DOCS_TIDY/MD-05", "SPRINT_LORE_MODEL_DOCS_TIDY/MD-04"))
                db.command("sql", "CREATE EDGE PART_OF FROM (SELECT FROM KnowTask WHERE task_uid = '" + t + "') "
                    + "TO (SELECT FROM KnowSprint WHERE sprint_id = 'SPRINT_LORE_MODEL_DOCS_TIDY')");
            db.command("sql", "CREATE EDGE PART_OF FROM (SELECT FROM KnowTask WHERE task_uid = 'SPRINT_LORE_MODEL_DOCS_TIDY/MD-05') "
                + "TO (SELECT FROM KnowPhase WHERE phase_uid = 'SPRINT_LORE_MODEL_DOCS_TIDY/P1')");
            db.command("sql", "CREATE EDGE CLOSED_BY FROM (SELECT FROM KnowTask WHERE task_uid = 'SPRINT_LORE_MODEL_DOCS_TIDY/MD-04') "
                + "TO (SELECT FROM KnowPR WHERE pr_uid = 'NooriUta/UnlimitedLORE#1641')");
            db.command("sql", "CREATE EDGE BELONGS_TO_PROJECT FROM (SELECT FROM KnowPR WHERE pr_uid = 'NooriUta/UnlimitedLORE#1641') "
                + "TO (SELECT FROM KnowGitProject WHERE slug = 'NooriUta/UnlimitedLORE')");
        });
    }

    @AfterEach
    void close() {
        if (db != null) db.drop();
        if (factory != null) factory.close();
    }

    private List<Map<String, Object>> prById(String id) {
        LoreSlices.Composed c = LoreSlices.compose("pr_by_id", Map.of("id", id));
        List<Map<String, Object>> out = new ArrayList<>();
        db.query("sql", c.sql(), c.params()).stream().forEach(r -> out.add(r.toMap()));
        return out;
    }

    @Test
    void строка_pr_с_задачами_релизами_и_проектом() {
        List<Map<String, Object>> rows = prById("NooriUta/UnlimitedLORE#1641");
        assertEquals(1, rows.size());
        Map<String, Object> row = rows.get(0);
        Map<String, Object> v = LoreRecordValues.values("pr", row);
        assertEquals("feat: данные PR при мерже", v.get("title"));
        assertEquals("https://h/AIDA/UnlimitedLORE/pulls/1641", v.get("url"));
        assertEquals("merged", v.get("state"));
        assertEquals(List.of("NooriUta/UnlimitedLORE", "NooriUta/UnlimitedLORE"), v.get("projects"), "поле и ребро — один проект дважды");
        assertEquals(List.of("NooriUta/UnlimitedLORE"), LoreRecordChips.chips(LoreRecordChips.ownProjects(v), List.of(), Map.of())
            .stream().map(c -> c.get("id")).toList(), "в паспорте чип проекта один — повтор снимают чипы");
        // порядок задач — порядок рёбер в движке, не контракт: сравниваем набором
        List<String> links = LoreRecordValues.rowLinks("pr", row).stream()
            .map(m -> m.get("rel") + ":" + m.get("dir") + ":" + m.get("id")).sorted().toList();
        assertEquals(List.of("CLOSED_BY:in:SPRINT_LORE_MODEL_DOCS_TIDY/MD-04", "CLOSED_BY:in:SPRINT_LORE_MODEL_DOCS_TIDY/MD-05",
            "SHIPPED_IN:out:NooriUta/UnlimitedLORE#v1.18.0"), links);
        assertEquals(List.of("SPRINT_LORE_MODEL_DOCS_TIDY"), v.get("sprints"),
            "спринт PR — через задачи: две задачи одного спринта — один раз, фаза задачи — не спринт");
    }

    @Test
    void старый_pr_без_заголовка_и_рёбер_подписан_ключом_проект_из_поля() {
        Map<String, Object> row = prById("NooriUta/UnlimitedLORE#700").get(0);
        Map<String, Object> v = LoreRecordValues.values("pr", row);
        assertEquals("NooriUta/UnlimitedLORE#700", v.get("title"));
        assertNull(v.get("url"), "адреса нет — пусто, а не выдуманный");
        assertEquals(List.of("NooriUta/UnlimitedLORE"), v.get("projects"), "ребра нет — проект из поля git_project");
        assertEquals(List.of(), LoreRecordValues.rowLinks("pr", row));
        assertEquals(List.of(), v.get("sprints"), "задач нет — спринтов нет, пустой список, а не null");
    }

    @Test
    void чужой_ключ_пусто() {
        assertEquals(List.of(), prById("NooriUta/UnlimitedLORE#1"));
    }
}
