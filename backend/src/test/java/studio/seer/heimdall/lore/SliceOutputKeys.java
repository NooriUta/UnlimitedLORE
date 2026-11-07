package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Ключи строки ответа среза — из ВНЕШНЕГО списка SELECT собранного SQL, без базы.
 *
 * <p>Нужен контрактному тесту miniLORE (SPRINT_UXR_S0_SAFETY/S0-02): форма ответа
 * среза — это имена колонок внешнего SELECT (псевдоним после {@code AS} или голое
 * имя поля). Живой прогон для этого не нужен, а любой прогон против общей базы
 * мигрирует её схему — поэтому форма снимается статически.
 *
 * <p>Честность отказа: если внешний список не разбирается в имена ({@code *},
 * пустой список, выражение без псевдонима), это НЕ «ключей нет», а «не смогли
 * проверить» — {@link #UNVERIFIABLE} в наборе, и тест обязан упасть, а не пройти.
 */
final class SliceOutputKeys {

    /** Маркер «внешний SELECT не разбирается в имена» — проверка не выполнена. */
    static final String UNVERIFIABLE = "<unverifiable>";

    private static final Pattern ALIAS =
        Pattern.compile("(?is).*\\sAS\\s+`?([A-Za-z_@][\\w@]*)`?\\s*$");
    private static final Pattern BARE =
        Pattern.compile("`?([A-Za-z_@][\\w@]*)`?");

    private SliceOutputKeys() {}

    static Set<String> of(String sql) {
        String s = sql.trim();
        int start = indexOfTopLevelWord(s, "SELECT", 0);
        if (start < 0) return Set.of(UNVERIFIABLE);
        int listStart = start + "SELECT".length();
        int from = indexOfTopLevelWord(s, "FROM", listStart);
        if (from < 0) return Set.of(UNVERIFIABLE);
        String list = s.substring(listStart, from).trim();
        if (list.isEmpty()) return Set.of(UNVERIFIABLE);

        Set<String> keys = new LinkedHashSet<>();
        for (String item : splitTopLevel(list)) {
            String it = item.trim();
            if (it.toUpperCase(Locale.ROOT).startsWith("DISTINCT ")) it = it.substring(9).trim();
            Matcher a = ALIAS.matcher(it);
            if (a.matches()) { keys.add(a.group(1)); continue; }
            Matcher b = BARE.matcher(it);
            if (b.matches()) { keys.add(b.group(1)); continue; }
            keys.add(UNVERIFIABLE);
        }
        return keys;
    }

    /** Позиция слова на нулевой глубине скобок и вне кавычек; -1, если нет. */
    private static int indexOfTopLevelWord(String s, String word, int from) {
        int depth = 0;
        char quote = 0;
        for (int i = from; i < s.length(); i++) {
            char c = s.charAt(i);
            if (quote != 0) { if (c == quote) quote = 0; continue; }
            if (c == '\'' || c == '"' || c == '`') { quote = c; continue; }
            if (c == '(' || c == '[') { depth++; continue; }
            if (c == ')' || c == ']') { depth--; continue; }
            if (depth == 0 && s.regionMatches(true, i, word, 0, word.length())
                && (i == 0 || !isWordChar(s.charAt(i - 1)))
                && (i + word.length() >= s.length() || !isWordChar(s.charAt(i + word.length())))) {
                return i;
            }
        }
        return -1;
    }

    private static boolean isWordChar(char c) {
        return Character.isLetterOrDigit(c) || c == '_' || c == '@' || c == '.' || c == '$';
    }

    private static List<String> splitTopLevel(String list) {
        List<String> out = new ArrayList<>();
        int depth = 0;
        char quote = 0;
        int last = 0;
        for (int i = 0; i < list.length(); i++) {
            char c = list.charAt(i);
            if (quote != 0) { if (c == quote) quote = 0; continue; }
            if (c == '\'' || c == '"' || c == '`') { quote = c; continue; }
            if (c == '(' || c == '[') depth++;
            else if (c == ')' || c == ']') depth--;
            else if (c == ',' && depth == 0) { out.add(list.substring(last, i)); last = i + 1; }
        }
        out.add(list.substring(last));
        return out;
    }
}
