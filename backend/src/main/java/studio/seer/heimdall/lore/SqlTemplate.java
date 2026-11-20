package studio.seer.heimdall.lore;

import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * SPRINT_LORE_OWN_HOST/OH-SLOW-QUERY-LOG · шаблон SQL-запроса ArcadeDB для журнала: литералы → {@code ?}.
 *
 * <p>Зачем шаблон, а не текст: (1) в лог не должны попасть данные и секреты — тело заметки в
 * {@code SET note_md='…'}, пароль в {@code CREATE USER … IDENTIFIED BY '…'}; (2) одинаковые по форме
 * запросы должны давать одну строку, иначе топ шаблонов по суммарному времени не собрать.
 *
 * <p>Что заменяется: строки в одинарных и двойных кавычках (с экранированием {@code \'} и {@code ''}),
 * RID {@code #12:3}, числа (в том числе отрицательные и с экспонентой). Список из одних литералов любой
 * длины сворачивается в {@code [?]} / {@code (?)}. Комментарии вырезаются, пробелы схлопываются.
 * Что остаётся: имена (в том числе с цифрами и в обратных кавычках), именованные параметры {@code :t},
 * переменные {@code $similarity}, атрибуты {@code @rid} — данных в них нет.
 */
final class SqlTemplate {

    /** Потолок длины шаблона в логе: дальше — многоточие. */
    static final int MAX_LEN = 1000;

    private static final Pattern RID = Pattern.compile("#-?\\d+:-?\\d+");
    private static final Pattern NUMBER =
        Pattern.compile("(?<![\\w$@#:.])-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?(?![\\w])");
    private static final Pattern LIST_SQ = Pattern.compile("\\[\\s*\\?(?:\\s*,\\s*\\?)*\\s*\\]");
    private static final Pattern LIST_RB = Pattern.compile("\\(\\s*\\?(?:\\s*,\\s*\\?)+\\s*\\)");
    private static final Pattern SPACES = Pattern.compile("\\s+");

    private static final Set<String> READ = Set.of("SELECT", "MATCH", "TRAVERSE", "EXPLAIN", "PROFILE");
    /** Управляющие слова sqlscript: сами не читают и не пишут. */
    private static final Set<String> NEUTRAL = Set.of("RETURN", "BEGIN", "COMMIT", "ROLLBACK", "SLEEP", "CONSOLE");

    private SqlTemplate() {}

    static String normalize(String sql) {
        if (sql == null || sql.isBlank()) return "";
        String s = stripLiteralsAndComments(sql);
        s = RID.matcher(s).replaceAll("?");
        s = NUMBER.matcher(s).replaceAll("?");
        s = LIST_SQ.matcher(s).replaceAll("[?]");
        s = LIST_RB.matcher(s).replaceAll("(?)");
        s = SPACES.matcher(s).replaceAll(" ").strip();
        return s.length() > MAX_LEN ? s.substring(0, MAX_LEN) + "…" : s;
    }

    /**
     * Чтение или запись: {@code read}, если каждое содержательное предложение начинается с
     * SELECT/MATCH/TRAVERSE (в sqlscript — и после {@code LET x =}); иначе {@code write}.
     * Слова внутри строковых литералов не учитываются.
     */
    static String kind(String language, String command) {
        if (command == null || command.isBlank()) return "read";
        String s = stripLiteralsAndComments(command);
        for (String stmt : s.split(";")) {
            String st = stmt.strip();
            if (st.isEmpty()) continue;
            String up = st.toUpperCase(Locale.ROOT);
            if (up.startsWith("LET ")) {
                int eq = up.indexOf('=');
                if (eq < 0) continue;
                up = up.substring(eq + 1).strip();
            }
            String first = up.split("[\\s({]", 2)[0];
            if (first.isEmpty() || NEUTRAL.contains(first)) continue;
            if (!READ.contains(first)) return "write";
        }
        return "read";
    }

    /** Строки → {@code ?}, комментарии → пробел; имена в обратных кавычках — как есть. */
    private static String stripLiteralsAndComments(String sql) {
        StringBuilder out = new StringBuilder(sql.length());
        int n = sql.length();
        int i = 0;
        while (i < n) {
            char c = sql.charAt(i);
            if (c == '\'' || c == '"') {
                i = skipString(sql, i, c);
                out.append('?');
            } else if (c == '`') {
                int end = sql.indexOf('`', i + 1);
                end = end < 0 ? n : end + 1;
                out.append(sql, i, end);
                i = end;
            } else if (c == '-' && i + 1 < n && sql.charAt(i + 1) == '-') {
                int end = sql.indexOf('\n', i);
                i = end < 0 ? n : end;
                out.append(' ');
            } else if (c == '/' && i + 1 < n && sql.charAt(i + 1) == '*') {
                int end = sql.indexOf("*/", i + 2);
                i = end < 0 ? n : end + 2;
                out.append(' ');
            } else {
                out.append(c);
                i++;
            }
        }
        return out.toString();
    }

    /** Индекс сразу за закрывающей кавычкой; незакрытая строка съедает остаток — данные не утекут. */
    private static int skipString(String sql, int start, char q) {
        int i = start + 1;
        int n = sql.length();
        while (i < n) {
            char c = sql.charAt(i);
            if (c == '\\') { i += 2; continue; }
            if (c == q) {
                if (i + 1 < n && sql.charAt(i + 1) == q) { i += 2; continue; }
                return i + 1;
            }
            i++;
        }
        return n;
    }
}
