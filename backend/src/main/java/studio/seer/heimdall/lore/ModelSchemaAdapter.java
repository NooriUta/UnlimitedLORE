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

    /**
     * Однозначные переименования полей новой схемы (старое → новое): старое имя не живёт ни в одном типе новой схемы.
     * Сверено со schema/*.json установщика 18.11.2026. Неоднозначные (name → title, priority → priority_note: старое
     * имя живёт в других типах) — не здесь: их правит код по типу.
     */
    static final Map<String, String> RENAMES = Map.of(
        "status_raw", "status",
        "date_created", "created_at",
        "created_date", "created_at");

    private static final Pattern WORD = Pattern.compile("(?<![\\w])(status_raw|date_created|created_date)(?![\\w])");

    /** SQL под новую схему; текст внутри кавычек остаётся как есть. */
    static String rewriteSql(String sql) {
        if (sql == null) return null;
        return upperStatusLiterals(renameFields(sql));
    }

    private static final Pattern STATUS_CMP = Pattern.compile("(?<![\\w])(status\\s*(?:=|<>|!=)\\s*)'([a-z][a-z_]*)'");
    private static final Pattern STATUS_IN = Pattern.compile("(?i)(?<![\\w])(status\\s+(?:NOT\\s+)?IN\\s*\\[)([^\\]]*)(\\])");
    private static final Pattern LOWER_LIT = Pattern.compile("'([a-z][a-z_]*)'");

    /**
     * Коды статусов в новой схеме — заглавными (слово владелицы 16.11.2026: «статусная модель uppercase остальные в
     * lower»): строчный литерал, с которым сравнивается поле status, — заглавными.
     */
    /** Типы, у которых status — свободный текст, а не код справочника (schema/all-objects.json, kind=text). */
    static final java.util.Set<String> TEXT_STATUS_TYPES = java.util.Set.of(
        "QGRecommendation", "QGJobTask", "ClRoutineRun", "ClRoutineMetric", "BragiIntegration", "BragiVariant");
    private static final Pattern FROM_TYPE = Pattern.compile("(?i)\\b(?:FROM|INTO|UPDATE)\\s+(\\w+)");

    private static boolean touchesTextStatus(String sql) {
        Matcher m = FROM_TYPE.matcher(sql);
        while (m.find()) if (TEXT_STATUS_TYPES.contains(m.group(1))) return true;
        return false;
    }

    static String upperStatusLiterals(String sql) {
        if (!sql.contains("status") || touchesTextStatus(sql)) return sql;
        String s = STATUS_CMP.matcher(sql).replaceAll(m -> Matcher.quoteReplacement(m.group(1) + "'" + m.group(2).toUpperCase(java.util.Locale.ROOT) + "'"));
        return STATUS_IN.matcher(s).replaceAll(m -> Matcher.quoteReplacement(m.group(1)
            + LOWER_LIT.matcher(m.group(2)).replaceAll(x -> Matcher.quoteReplacement("'" + x.group(1).toUpperCase(java.util.Locale.ROOT) + "'"))
            + m.group(3)));
    }

    private static String renameFields(String sql) {
        if (RENAMES.keySet().stream().noneMatch(sql::contains)) return sql;
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
    private static final Pattern LAST_SELECT = Pattern.compile("(?is).*\\bSELECT\\b(.*)$");
    private static final Pattern CLAUSE = Pattern.compile("(?i)\\b(FROM|WHERE|ORDER|GROUP|LET|SET)\\b");

    /** Позиция в списке выборки: после последнего SELECT ещё не было FROM/WHERE/ORDER … */
    private static boolean inProjection(String left) {
        Matcher m = LAST_SELECT.matcher(left);
        if (!m.matches() || CLAUSE.matcher(m.group(1)).find()) return false;
        // только верхний уровень выборки: внутри скобок функции (coalesce(a, status_raw, …)) псевдоним — синтаксическая ошибка
        int depth = 0;
        for (char c : m.group(1).toCharArray()) { if (c == '(' || c == '[') depth++; else if (c == ')' || c == ']') depth--; }
        return depth == 0;
    }

    private static String rewriteUnquoted(String part, CharSequence before) {
        Matcher m = WORD.matcher(part);
        StringBuilder sb = new StringBuilder();
        int last = 0;
        while (m.find()) {
            String left = before.toString() + sb + part.substring(last, m.start());
            String right = part.substring(m.end());
            sb.append(part, last, m.start());
            String old = m.group(1), now = RENAMES.get(old);
            if (AS_BEFORE.matcher(left).find()) {
                sb.append(old);                              // псевдоним — имя ключа ответа
            } else if (ITEM_START.matcher(left).find() && ITEM_END.matcher(right).find() && inProjection(left)) {
                sb.append(now).append(" AS ").append(old);   // поле без псевдонима в выборке — ключ ответа прежний
            } else {
                sb.append(now);
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

    /**
     * Статус для ответа клиенту (двери записи: old_status/new_status): на базе из модели код плана — прежняя строка
     * («🔄 IN PROGRESS»), код другого справочника — строчными («accepted»), как до переноса. Старая схема — как есть.
     */
    static String forClient(String v) {
        if (v == null || !enabled) return v;
        if (DISPLAY.containsKey(v)) return DISPLAY.get(v);
        return v.matches("[A-Z][A-Z_]*") ? v.toLowerCase(java.util.Locale.ROOT) : v;
    }

    /**
     * Запись названия спринта/фазы (D-2026-MIG-SPRINT-PHASE-TITLE): на базе из модели — title; в старой схеме ещё и
     * name — по нему построен FT-индекс ftKnowSprint и читают старые клиенты (полный прогон 19.11: новый спринт не искался).
     */
    static String titleSet(String param) {
        return enabled ? "title=:" + param : "title=:" + param + ", name=:" + param;
    }

    /** Узнаётся ли строка словарём плана: значок или слово в начале (без отката на «todo»). */
    static boolean looksLikePlan(String t) {
        String up = t.stripLeading().toUpperCase(java.util.Locale.ROOT);
        for (LoreStatusVocabulary.Entry e : LoreStatusVocabulary.ENTRIES) {
            if (t.stripLeading().startsWith(e.marker())) return true;
            for (String w : e.words()) if (up.startsWith(w)) return true;
        }
        return false;
    }

    /** Строка статуса старого вида («🔄 IN PROGRESS», «🟡 PARTIAL — …») → код справочника; код остаётся кодом. */
    static String toCode(String raw) {
        if (raw == null) return null;
        String t = raw.strip();
        if (DISPLAY.containsKey(t)) return t;
        // строка плана узнаётся значком или словом; иначе это код другого справочника (ADR, решение …) —
        // заглавными, как хранит новая схема. classify() откатывается на «todo» для незнакомого слова —
        // без этой проверки «accepted» у ADR становился бы TODO.
        if (!looksLikePlan(t)) return t.matches("[A-Za-z][A-Za-z_]*") ? t.toUpperCase(java.util.Locale.ROOT) : raw;
        String canon = LoreStatusVocabulary.classify(t);
        return CANON_TO_CODE.getOrDefault(canon, raw);
    }

    private static final Pattern STATUS_ASSIGN = Pattern.compile("(?<![\\w])status_raw\\s*=\\s*:(\\w+)");

    /** Запись: параметр, который присваивается полю status_raw, переводится в код справочника. */
    private static final Pattern STATUS_PARAM = Pattern.compile("(?<![\\w])status\\s*(?:=|<>|!=)\\s*:(\\w+)");

    static Map<String, Object> rewriteParams(String sql, Map<String, Object> params) {
        if (sql == null || params == null || params.isEmpty() || !sql.contains("status")) return params;
        Map<String, Object> out = null;
        Matcher m = STATUS_ASSIGN.matcher(sql);
        while (m.find()) {
            String name = m.group(1);
            if (params.get(name) instanceof String s) {
                if (out == null) out = new java.util.HashMap<>(params);
                out.put(name, toCode(s));
            }
        }
        // поле status (вопрос, ADR, спека …): строчный код — заглавными, как хранит новая схема
        Matcher p = STATUS_PARAM.matcher(sql);
        while (!touchesTextStatus(sql) && p.find()) {
            String name = p.group(1);
            if (params.get(name) instanceof String s && s.matches("[a-z][a-z_]*")) {
                if (out == null) out = new java.util.HashMap<>(params);
                out.put(name, s.toUpperCase(java.util.Locale.ROOT));
            }
        }
        return out == null ? params : out;
    }

    private static final com.fasterxml.jackson.databind.ObjectMapper JSON = new com.fasterxml.jackson.databind.ObjectMapper();

    /** Ответ ArcadeDB целиком: строки в {@code result} приводятся {@link #adaptRows}; иной ответ — как есть. */
    @SuppressWarnings("unchecked")
    static String adaptJson(String json) {
        if (json == null || !json.contains("\"status")) return json;
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
    /** Строка версии (SCD2): у неё есть ключ версии или начало действия. */
    private static boolean isVersionRow(Map<String, Object> r) {
        return r.containsKey("state_uid") || r.containsKey("valid_from");
    }

    static void adaptRows(List<Map<String, Object>> rows) {
        if (rows == null) return;
        for (Map<String, Object> r : rows) {
            if (r == null) continue;
            Object v = r.get("status_raw");
            try {
                if (v instanceof String s && DISPLAY.containsKey(s)) {
                    r.put("status_raw", DISPLAY.get(s));
                } else if (v == null && !r.containsKey("status_raw") && isVersionRow(r)
                        && r.get("status") instanceof String c && DISPLAY.containsKey(c)) {
                    // строка версии целиком (SELECT *): статус плана только в status — прежний ключ рядом
                    r.put("status_raw", DISPLAY.get(c));
                }
                // статус не плана (вопрос, ADR, сценарий …): клиенты знают его строчным — как до переноса
                if (!r.containsKey("status_raw") && r.get("status") instanceof String c2 && c2.matches("[A-Z][A-Z_]*")) {
                    r.put("status", c2.toLowerCase(java.util.Locale.ROOT));
                }
            } catch (UnsupportedOperationException ignored) { /* неизменяемая строка ответа */ }
        }
    }
}
