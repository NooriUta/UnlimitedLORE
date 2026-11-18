package studio.seer.heimdall.lore;

import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MIG-03 · переходник чтения для базы, собранной из модели (MIG-01).
 *
 * <p>В новой схеме поле версии {@code status_raw} называется {@code status} и хранит код справочника
 * (ACTIVE, DONE …), а код сервера и клиенты читают {@code status_raw} в прежнем виде «значок + слово».
 * Вместо правки ~250 мест — один переходник в точке чтения ({@code LoreIngestService.queryRows}):
 * <ol>
 *   <li>SQL: обращение к полю {@code status_raw} → {@code status}; поле без псевдонима в выборке →
 *       {@code status AS status_raw} (ключ ответа прежний); псевдонимы {@code AS status_raw} и текст в
 *       кавычках не трогаются;</li>
 *   <li>ответ: код плана в ключе {@code status_raw} → прежняя строка ({@code ACTIVE} → «🔄 IN PROGRESS»).</li>
 * </ol>
 * Включается только когда схема собрана из модели ({@code LoreSchemaMigrationRunner.SchemaSource.MODEL});
 * на базе со старой схемой (LEDGER) ничего не меняется. Фильтры статуса ({@link LoreStatusVocabulary#anySql})
 * работают на кодах без правки — коды попадают под те же префиксы.
 */
final class ModelSchemaAdapter {

    private ModelSchemaAdapter() {}

    /** Включён ли переходник: ставится при сверке схемы на старте, когда база собрана из модели. */
    private static volatile boolean enabled;

    static boolean enabled() { return enabled; }

    static void enable(boolean on) { enabled = on; }

    /** Коды справочников плана и фаз → строка старого вида; остальные коды не трогаются. */
    private static final Map<String, String> DISPLAY = Map.ofEntries(
        Map.entry("TODO", "⬜ TODO"),
        Map.entry("BACKLOG", "🟣 BACKLOG"),
        Map.entry("PLANNED", "📋 PLANNED"),
        Map.entry("DESIGN", "🔬 DESIGN"),
        Map.entry("ACTIVE", "🔄 IN PROGRESS"),
        Map.entry("WAITING", "⏳ WAITING"),
        Map.entry("PARTIAL", "🟡 PARTIAL"),
        Map.entry("REVIEW", "🔍 REVIEW"),
        Map.entry("READY_FOR_DEPLOY", "🚀 READY FOR DEPLOY"),
        Map.entry("UAT", "🧪 UAT TESTING"),
        Map.entry("DONE", "✅ DONE"),
        Map.entry("FAILED", "❌ FAILED"),
        Map.entry("BLOCKED", "🔴 BLOCKED"),
        Map.entry("CANCELLED", "🚫 CANCELLED"));

    static String display(String code) {
        return DISPLAY.getOrDefault(code, code);
    }

    private static final Pattern WORD = Pattern.compile("(?<![\\w])status_raw(?![\\w])");

    /** SQL под новую схему; текст внутри кавычек остаётся как есть. */
    static String rewriteSql(String sql) {
        if (sql == null || !sql.contains("status_raw")) return sql;
        StringBuilder out = new StringBuilder(sql.length() + 16);
        int i = 0;
        while (i < sql.length()) {
            char c = sql.charAt(i);
            if (c == '\'' || c == '"' || c == '`') {
                int j = sql.indexOf(c, i + 1);
                j = j < 0 ? sql.length() : j + 1;
                out.append(sql, i, j);
                i = j;
                continue;
            }
            int next = nextQuote(sql, i);
            out.append(rewriteUnquoted(sql.substring(i, next), out));
            i = next;
        }
        return out.toString();
    }

    private static int nextQuote(String s, int from) {
        for (int k = from; k < s.length(); k++) {
            char c = s.charAt(k);
            if (c == '\'' || c == '"' || c == '`') return k;
        }
        return s.length();
    }

    private static final Pattern AS_BEFORE = Pattern.compile("(?i)\\bAS\\s+$");
    private static final Pattern ITEM_START = Pattern.compile("(?i)(\\bSELECT|,)\\s*$");
    private static final Pattern ITEM_END = Pattern.compile("(?i)^\\s*(,|\\bFROM\\b|$)");

    private static String rewriteUnquoted(String part, CharSequence before) {
        Matcher m = WORD.matcher(part);
        StringBuilder sb = new StringBuilder();
        int last = 0;
        while (m.find()) {
            String left = before.toString() + sb + part.substring(last, m.start());
            String right = part.substring(m.end());
            sb.append(part, last, m.start());
            if (AS_BEFORE.matcher(left).find()) {
                sb.append("status_raw");                     // псевдоним — имя ключа ответа
            } else if (ITEM_START.matcher(left).find() && ITEM_END.matcher(right).find()) {
                sb.append("status AS status_raw");           // поле без псевдонима в выборке
            } else {
                sb.append("status");
            }
            last = m.end();
        }
        sb.append(part.substring(last));
        return sb.toString();
    }

    private static final Map<String, String> CANON_TO_CODE = Map.ofEntries(
        Map.entry("todo", "TODO"), Map.entry("backlog", "BACKLOG"), Map.entry("planned", "PLANNED"),
        Map.entry("design", "DESIGN"), Map.entry("in_progress", "ACTIVE"), Map.entry("waiting", "WAITING"),
        Map.entry("partial", "PARTIAL"), Map.entry("review", "REVIEW"), Map.entry("ready_for_deploy", "READY_FOR_DEPLOY"),
        Map.entry("uat", "UAT"), Map.entry("done", "DONE"), Map.entry("failed", "FAILED"),
        Map.entry("blocked", "BLOCKED"), Map.entry("cancelled", "CANCELLED"));

    /** Строка статуса старого вида («🔄 IN PROGRESS», «🟡 PARTIAL — …») → код справочника; код остаётся кодом. */
    static String toCode(String raw) {
        if (raw == null) return null;
        String t = raw.strip();
        if (DISPLAY.containsKey(t)) return t;
        String canon = LoreStatusVocabulary.classify(t);
        return CANON_TO_CODE.getOrDefault(canon, raw);
    }

    private static final Pattern STATUS_ASSIGN = Pattern.compile("(?<![\\w])status_raw\\s*=\\s*:(\\w+)");

    /** Запись: параметр, который присваивается полю status_raw, переводится в код справочника. */
    static Map<String, Object> rewriteParams(String sql, Map<String, Object> params) {
        if (sql == null || params == null || params.isEmpty() || !sql.contains("status_raw")) return params;
        Matcher m = STATUS_ASSIGN.matcher(sql);
        Map<String, Object> out = null;
        while (m.find()) {
            String name = m.group(1);
            if (params.get(name) instanceof String s) {
                if (out == null) out = new java.util.HashMap<>(params);
                out.put(name, toCode(s));
            }
        }
        return out == null ? params : out;
    }

    private static final com.fasterxml.jackson.databind.ObjectMapper JSON = new com.fasterxml.jackson.databind.ObjectMapper();

    /** Ответ ArcadeDB целиком: строки в {@code result} приводятся {@link #adaptRows}; иной ответ — как есть. */
    @SuppressWarnings("unchecked")
    static String adaptJson(String json) {
        if (json == null || !json.contains("status_raw")) return json;
        try {
            Map<String, Object> body = JSON.readValue(json, java.util.LinkedHashMap.class);
            if (!(body.get("result") instanceof List<?> l)) return json;
            List<Map<String, Object>> rows = new java.util.ArrayList<>();
            for (Object o : l) if (o instanceof Map<?, ?> mm) rows.add((Map<String, Object>) mm);
            adaptRows(rows);
            return JSON.writeValueAsString(body);
        } catch (java.io.IOException e) {
            return json;
        }
    }

    /** Ответ: код плана в ключе status_raw → строка старого вида. */
    static void adaptRows(List<Map<String, Object>> rows) {
        if (rows == null) return;
        for (Map<String, Object> r : rows) {
            if (r == null) continue;
            Object v = r.get("status_raw");
            try {
                if (v instanceof String s && DISPLAY.containsKey(s)) {
                    r.put("status_raw", DISPLAY.get(s));
                } else if (v == null && !r.containsKey("status_raw") && r.get("status") instanceof String c && DISPLAY.containsKey(c)) {
                    // строка версии целиком (SELECT *): статус плана только в status — прежний ключ рядом
                    r.put("status_raw", DISPLAY.get(c));
                }
            } catch (UnsupportedOperationException ignored) { /* неизменяемая строка ответа */ }
        }
    }
}
