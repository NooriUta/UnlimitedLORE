package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_MD_ARCHIVE/MDA-02 — сборщик выгрузки проекта в папку .md под Obsidian.
 * Чистая функция: записи на входе, карта «путь → текст» на выходе; без БД.
 *
 * <p>Правила раскладки согласованы владелицей 14.11.2026 (MDA-01) и проверены на образце
 * docs/prototypes/mda-01-vault настоящим резолвером Obsidian: задача — отдельный файл в
 * папке спринта, ссылка `[[ID|тип:ID]]`, только текущее состояние, граница владения —
 * `LORE/&lt;owner&gt;__&lt;repo&gt;/`; в таблицах `|` алиаса экранируется; буквальный `[[…]]`,
 * который не ведёт на запись архива, не должен становиться битой ссылкой.
 */
class LoreVaultExportTest {

    private static final String SLUG = "NooriUta/UnlimitedLORE";
    private static final String ROOT = "LORE/NooriUta__UnlimitedLORE/";

    private static LoreVaultExport.Rec rec(String type, String id, String title, String body) {
        return new LoreVaultExport.Rec(type, id, title, "active", body, Map.of());
    }

    private static LoreVaultExport.Input input(List<LoreVaultExport.Rec> recs) {
        return new LoreVaultExport.Input(SLUG, "UnlimitedLORE", recs, Map.of(), 0);
    }

    @Test
    void layoutFollowsAgreedFoldersAndTaskLivesInItsSprintFolder() {
        Map<String, String> files = LoreVaultExport.build(input(List.of(
            rec("sprint", "SPRINT_X", "Спринт", ""),
            rec("task", "SPRINT_X/CO-11", "Задача", ""),
            rec("adr", "ADR-LORE-050", "ADR", ""),
            rec("decision", "D-2026-A", "Решение", ""),
            rec("spec", "SPEC-A", "Спека", ""),
            rec("doc", "DOC-A", "Док", ""),
            rec("runbook", "RUNBOOK-A", "Ранбук", ""),
            rec("release", "v1.17.21", "Релиз", ""),
            rec("question", "OQ-1", "Вопрос", ""),
            rec("component", "OMILORE", "Компонент", ""))));
        for (String p : List.of("index.md", "sprints/SPRINT_X.md", "tasks/SPRINT_X/CO-11.md", "adr/ADR-LORE-050.md",
                "decisions/D-2026-A.md", "specs/SPEC-A.md", "docs/DOC-A.md", "runbooks/RUNBOOK-A.md",
                "releases/v1.17.21.md", "questions/OQ-1.md", "components/OMILORE.md"))
            assertTrue(files.containsKey(ROOT + p), "нет файла " + p + " в " + files.keySet());
        assertTrue(files.keySet().stream().allMatch(p -> p.startsWith(ROOT)), "всё — внутри границы владения");
    }

    @Test
    void windowsIllegalCharactersInIdBecomeUnderscoreButIdStaysInFrontmatter() {
        Map<String, String> files = LoreVaultExport.build(input(List.of(rec("doc", "DOC:A*B?", "Док", ""))));
        String path = ROOT + "docs/DOC_A_B_.md";
        assertTrue(files.containsKey(path), files.keySet().toString());
        assertTrue(files.get(path).contains("id: \"DOC:A*B?\""), files.get(path));
    }

    @Test
    void frontmatterQuotesTitleAndLinksProjectAndSprint() {
        Map<String, String> files = LoreVaultExport.build(input(List.of(
            rec("sprint", "SPRINT_X", "Спринт", ""),
            new LoreVaultExport.Rec("task", "SPRINT_X/CO-11", "Ключ: \"значение\"", "uat", "тело",
                Map.of("effort_days", 0.5, "executor_agent", "Claude Code (full)")))));
        String t = files.get(ROOT + "tasks/SPRINT_X/CO-11.md");
        assertTrue(t.startsWith("---\n"), t);
        assertTrue(t.contains("id: \"SPRINT_X/CO-11\""), t);
        assertTrue(t.contains("type: task"), t);
        assertTrue(t.contains("title: \"Ключ: \\\"значение\\\"\""), "кавычки и двоеточие экранированы: " + t);
        assertTrue(t.contains("status: uat"), t);
        assertTrue(t.contains("project: \"[[NooriUta__UnlimitedLORE/index|NooriUta/UnlimitedLORE]]\""),
            "проект — owner__repo/index, иначе ссылка уходит в несуществующий каталог: " + t);
        assertTrue(t.contains("sprint: \"[[SPRINT_X]]\""), t);
        assertTrue(t.contains("effort_days: 0.5"), t);
        assertTrue(t.contains("executor_agent: \"Claude Code (full)\""), t);
        assertTrue(t.endsWith("тело\n"), "тело — как есть, после frontmatter: " + t);
    }

    @Test
    void loreRefsBecomeObsidianLinksOnlyForRecordsInTheArchive() {
        String body = "Смотри [[adr:ADR-LORE-050]] и [[task:SPRINT_X/CO-11|эту задачу]], "
            + "а [[adr:ADR-OTHER-1]] — в другом проекте; голая [[OMILORE]].";
        Map<String, String> files = LoreVaultExport.build(input(List.of(
            rec("sprint", "SPRINT_X", "Спринт", ""),
            rec("task", "SPRINT_X/CO-11", "Задача", ""),
            rec("adr", "ADR-LORE-050", "ADR", body),
            rec("component", "OMILORE", "Компонент", ""))));
        String a = files.get(ROOT + "adr/ADR-LORE-050.md");
        assertTrue(a.contains("[[ADR-LORE-050|adr:ADR-LORE-050]]"), a);
        assertTrue(a.contains("[[SPRINT_X/CO-11|эту задачу]]"), "подпись автора сохраняется: " + a);
        assertTrue(a.contains("`adr:ADR-OTHER-1`"), "запись вне архива — не битая ссылка, а код: " + a);
        assertFalse(a.contains("[[adr:ADR-OTHER-1"), a);
        assertTrue(a.contains("[[OMILORE]]"), "голая ссылка на запись архива остаётся ссылкой: " + a);
    }

    @Test
    void literalWikiTextThatIsNotARecordBecomesInlineCodeAndCodeIsUntouched() {
        String body = "Формат: папка + frontmatter + [[ссылки]].\n\n```\n[[adr:ADR-LORE-050]] в коде\n```\n"
            + "и `[[x]]` в строке кода.";
        Map<String, String> files = LoreVaultExport.build(input(List.of(
            rec("adr", "ADR-LORE-050", "ADR", ""), rec("spec", "SPEC-A", "Спека", body))));
        String s = files.get(ROOT + "specs/SPEC-A.md");
        assertTrue(s.contains("`[[ссылки]]`"), "буквальный [[…]] — в инлайн-код, иначе Obsidian видит битую ссылку: " + s);
        assertTrue(s.contains("```\n[[adr:ADR-LORE-050]] в коде\n```"), "блок кода не трогается: " + s);
        assertTrue(s.contains("`[[x]]`"), s);
    }

    @Test
    void pipeOfAliasIsEscapedInsideTableRows() {
        String body = "| запись | что |\n|---|---|\n| [[adr:ADR-LORE-050]] | решение |\n";
        Map<String, String> files = LoreVaultExport.build(input(List.of(
            rec("adr", "ADR-LORE-050", "ADR", ""), rec("doc", "DOC-A", "Док", body))));
        String d = files.get(ROOT + "docs/DOC-A.md");
        assertTrue(d.contains("| [[ADR-LORE-050\\|adr:ADR-LORE-050]] | решение |"),
            "в таблице `|` алиаса режет ячейку — экранировать: " + d);
    }

    @Test
    void indexCountsByTypeAndKeepsUnreadableApartFromHiddenAndEmpty() {
        LoreVaultExport.Input in = new LoreVaultExport.Input(SLUG, "UnlimitedLORE",
            List.of(rec("adr", "ADR-1", "a", ""), rec("adr", "ADR-2", "b", ""), rec("spec", "SPEC-1", "c", "")),
            Map.of("runbook", "срез project_runbooks ответил 500"), 4);
        String idx = LoreVaultExport.build(in).get(ROOT + "index.md");
        assertNotNull(idx);
        assertTrue(idx.contains("| ADR | `adr/` | 2 |"), idx);
        assertTrue(idx.contains("| спека | `specs/` | 1 |"), idx);
        assertTrue(idx.contains("| ранбук | `runbooks/` | не прочитано |"),
            "«не смогли прочитать» — не ноль: " + idx);
        assertTrue(idx.contains("| вопрос | `questions/` | 0 |"), "пусто — честный ноль: " + idx);
        assertTrue(idx.contains("срез project_runbooks ответил 500"), idx);
        assertTrue(idx.contains("скрыто правами: 4"), idx);
    }

    @Test
    void twoBuildsOfTheSameStateGiveIdenticalBytesAndZip() throws Exception {
        List<LoreVaultExport.Rec> recs = List.of(
            rec("spec", "SPEC-B", "b", "x"), rec("adr", "ADR-1", "a", "[[spec:SPEC-B]]"),
            rec("sprint", "SPRINT_X", "s", ""), rec("task", "SPRINT_X/T-2", "t2", ""), rec("task", "SPRINT_X/T-1", "t1", ""));
        Map<String, String> a = LoreVaultExport.build(input(recs));
        Map<String, String> b = LoreVaultExport.build(input(List.copyOf(recs).reversed()));
        assertEquals(a, b, "порядок входа не влияет на результат");
        assertEquals(List.copyOf(a.keySet()), a.keySet().stream().sorted().toList(), "файлы — в фиксированном порядке");
        byte[] za = LoreVaultExport.zip(a), zb = LoreVaultExport.zip(b);
        assertArrayEquals(za, zb, "zip двух выгрузок без изменений — те же байты");
        assertEquals(64, HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(za)).length());
        assertFalse(String.join("\n", a.values()).matches("(?s).*20\\d\\d-\\d\\d-\\d\\dT\\d\\d:\\d\\d.*"),
            "внутри файлов нет времени выгрузки");
    }
}
