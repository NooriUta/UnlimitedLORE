package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-06, патч 1.18.1 · каждый {@code :param} запроса — в карте параметров, и при null.
 *
 * <p>Повод (препрод 21.11.2026): запись плана спринта без статуса — 400, ArcadeDB «Expected parameter(s): status».
 * На базе 1.18 переходник схемы ({@link ModelSchemaAdapter}) переименовывает в SQL поле и параметр
 * ({@code status_raw = :status_raw} → {@code status = :status}), а ключ карты оставался прежним. Правило общее:
 * перед отправкой запроса недостающий параметр берётся под прежним именем (RENAMES), иначе — null; движок не падает на
 * пропуске, а пустое значение пишется пустым.
 */
final class SqlParams {

    private SqlParams() {}

    /** Имена {@code :param} запроса вне строк и обратных кавычек, по порядку, без повторов. */
    static List<String> names(String sql) {
        List<String> out = new ArrayList<>();
        if (sql == null) return out;
        int n = sql.length();
        for (int i = 0; i < n; i++) {
            char c = sql.charAt(i);
            if (c == '\'' || c == '"' || c == '`') {
                int j = sql.indexOf(c, i + 1);
                if (j < 0) break;
                i = j;
                continue;
            }
            if (c != ':' || (i > 0 && (sql.charAt(i - 1) == ':' || Character.isLetterOrDigit(sql.charAt(i - 1))))) continue;
            int j = i + 1;
            while (j < n && (Character.isLetterOrDigit(sql.charAt(j)) || sql.charAt(j) == '_')) j++;
            if (j > i + 1 && (j >= n || sql.charAt(j) != ':')) {
                String name = sql.substring(i + 1, j);
                if (!Character.isDigit(name.charAt(0)) && !out.contains(name)) out.add(name);
            }
            i = j - 1;
        }
        return out;
    }

    /** Параметры запроса, которых нет в карте (ключа нет вовсе). */
    static List<String> missing(String sql, Map<String, Object> params) {
        List<String> out = new ArrayList<>();
        for (String name : names(sql)) if (params == null || !params.containsKey(name)) out.add(name);
        return out;
    }

    /**
     * Карта, в которой есть каждый параметр {@code sql}: недостающий — значение под прежним именем (переименование
     * переходника схемы), иначе null. Исходная карта не меняется; ничего не пропало — та же карта.
     */
    static Map<String, Object> complete(String sql, Map<String, Object> params) {
        List<String> miss = missing(sql, params);
        if (miss.isEmpty()) return params;
        Map<String, Object> out = params == null ? new HashMap<>() : new HashMap<>(params);
        for (String name : miss) {
            String old = null;
            for (Map.Entry<String, String> r : ModelSchemaAdapter.RENAMES.entrySet())
                if (name.equals(r.getValue()) || name.startsWith(r.getValue() + "_") || name.endsWith("_" + r.getValue())) {
                    String candidate = name.replace(r.getValue(), r.getKey());
                    if (out.containsKey(candidate)) { old = candidate; break; }
                }
            out.put(name, old != null ? out.get(old) : null);
        }
        return out;
    }
}
