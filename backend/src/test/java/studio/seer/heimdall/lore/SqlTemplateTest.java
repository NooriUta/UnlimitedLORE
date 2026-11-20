package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

/**
 * SPRINT_LORE_OWN_HOST/OH-SLOW-QUERY-LOG · шаблон запроса для журнала медленных запросов.
 *
 * <p>В лог идёт не текст запроса, а шаблон: литералы → {@code ?}. Ни данные, ни секреты (пароль в
 * {@code CREATE USER}, тело заметки в {@code UPDATE … SET note_md='…'}) в лог попасть не должны, а
 * одинаковые по форме запросы должны сводиться к одной строке — иначе «топ шаблонов» не собрать.
 */
class SqlTemplateTest {

    private static String t(String sql) { return SqlTemplate.normalize(sql); }

    @Test
    void stringLiterals() {
        assertEquals("SELECT FROM KnowTask WHERE task_uid = ?",
            t("SELECT FROM KnowTask WHERE task_uid = 'SPRINT_X/CO-11'"));
        assertEquals("SELECT FROM KnowTask WHERE title = ?",
            t("SELECT FROM KnowTask WHERE title = \"журнал\""));
        // экранированная кавычка внутри строки не обрывает литерал
        assertEquals("UPDATE KnowTask SET note_md = ? WHERE task_uid = ?",
            t("UPDATE KnowTask SET note_md = 'it\\'s ''quoted'' secret' WHERE task_uid = 'A/B-1'"));
    }

    @Test
    void secretsNeverSurvive() {
        String out = t("CREATE USER bob IDENTIFIED BY 'p@ss-W0rd!' ; UPDATE Cfg SET token = \"ghp_abc123\"");
        assertFalse(out.contains("p@ss"), out);
        assertFalse(out.contains("ghp_abc123"), out);
    }

    @Test
    void numbers() {
        assertEquals("SELECT FROM KnowPR WHERE pr_number = ? LIMIT ?",
            t("SELECT FROM KnowPR WHERE pr_number = 1636 LIMIT 10"));
        assertEquals("SELECT FROM X WHERE a > ? AND b < ?", t("SELECT FROM X WHERE a > -1.5 AND b < 2e3"));
        // цифры внутри имён — не литералы
        assertEquals("SELECT out_1, ftKnowADR2 FROM KnowTask", t("SELECT out_1, ftKnowADR2 FROM KnowTask"));
    }

    @Test
    void ridsAreLiterals() {
        assertEquals("SELECT FROM KnowTask WHERE SEARCH_INDEX_MORE(?, [?]) = true",
            t("SELECT FROM KnowTask WHERE SEARCH_INDEX_MORE('ftKnowTask', [#12:345]) = true"));
        assertEquals("DELETE FROM CLOSED_BY WHERE @rid = ?", t("DELETE FROM CLOSED_BY WHERE @rid = #44:7"));
    }

    @Test
    void listsCollapseToOnePlaceholder() {
        // список любой длины — один шаблон
        String one = t("SELECT FROM KnowTask WHERE task_uid IN ['a/B-1']");
        String three = t("SELECT FROM KnowTask WHERE task_uid IN ['a/B-1', 'a/B-2', 'c/D-3']");
        assertEquals("SELECT FROM KnowTask WHERE task_uid IN [?]", three);
        assertEquals(one, three);
        assertEquals("SELECT FROM X WHERE n IN (?)", t("SELECT FROM X WHERE n IN (1, 2, 3)"));
        // доступ по индексу — тоже литерал; имя ребра в кавычках — строка, и она уходит (правило одно для всех строк)
        assertEquals("SELECT in(?).title[?] FROM X", t("SELECT in('HAS_STATE').title[0] FROM X"));
    }

    @Test
    void namedParametersStay() {
        // параметры — уже не данные: их имена в шаблоне полезны и безопасны, значения в лог не идут
        assertEquals("SELECT FROM KnowTask WHERE task_uid = :t AND sprint_id = :sid LIMIT ?",
            t("SELECT FROM KnowTask WHERE task_uid = :t AND sprint_id = :sid LIMIT 5"));
        assertEquals("SELECT FROM X WHERE a = ?", t("SELECT FROM X WHERE a = ?"));
        // $-переменные и @-атрибуты движка не трогаем
        assertEquals("SELECT $similarity, @rid FROM X ORDER BY $similarity DESC",
            t("SELECT $similarity, @rid FROM X ORDER BY $similarity DESC"));
    }

    @Test
    void mapsAndJsonMetadata() {
        assertEquals("SELECT FROM X WHERE SEARCH_INDEX_MORE(?, [?], {?: ?, ?: ?}) = true",
            t("SELECT FROM X WHERE SEARCH_INDEX_MORE('ftX', [#1:2], {\"minTermFreq\": 1, \"minDocFreq\": 1}) = true"));
    }

    @Test
    void whitespaceAndCommentsAreFolded() {
        assertEquals("SELECT FROM X WHERE a = ?",
            t("SELECT   FROM X\n  WHERE a = 'v' -- спринт владелицы\n"));
        assertEquals("SELECT FROM X WHERE a = ?", t("SELECT /* секрет */ FROM X WHERE a = 'v'"));
    }

    @Test
    void nullAndBlank() {
        assertEquals("", t(null));
        assertEquals("", t("   "));
    }

    @Test
    void longTemplateIsCapped() {
        String sql = "SELECT " + "a, ".repeat(2000) + "b FROM X";
        assertEquals(SqlTemplate.MAX_LEN + 1, t(sql).length(), "потолок длины + многоточие");
    }

    @Test
    void readOrWrite() {
        assertEquals("read", SqlTemplate.kind("sql", "SELECT FROM X"));
        assertEquals("read", SqlTemplate.kind("sql", "  match {type: X} return x"));
        assertEquals("read", SqlTemplate.kind("sql", "TRAVERSE out() FROM #1:2"));
        assertEquals("write", SqlTemplate.kind("sql", "UPDATE X SET a = 1"));
        assertEquals("write", SqlTemplate.kind("sql", "CREATE EDGE E FROM (SELECT FROM A) TO (SELECT FROM B)"));
        assertEquals("write", SqlTemplate.kind("sqlscript", "LET a = SELECT FROM X; UPDATE X SET b = 1; RETURN $a"));
        assertEquals("read", SqlTemplate.kind("sqlscript", "LET a = SELECT FROM X; RETURN $a"));
        // слово «update» в строке — не запись
        assertEquals("read", SqlTemplate.kind("sql", "SELECT FROM X WHERE title = 'update; delete'"));
    }
}
