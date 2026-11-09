package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MODEL-TYPES — раздел {@code types} модели LORE
 * (ADR-LORE-048 §1–§4, алгоритм А): граф (свойства из {@code schema:types}) +
 * обогащение (первый источник — {@link LoreRecordRegistry}, без смены поведения).
 *
 * <ul>
 *   <li>Поля типа — те же, что {@code schema.fields} в {@code lore.record/1}
 *       (D-2026-LORE-MODEL-GRAPH-PLUS-ENRICHMENT): у каждого {@code visibility},
 *       {@code property} (имя в графе, если сопоставилось) и {@code source}:
 *       CONFIRMS — есть и в схеме, SUPPLIES — дано обогащением, в схеме не объявлено
 *       (D-2026-LORE-MODEL-SCHEMA-GAPS, D-2026-LORE-MODEL-SEMANTIC-ALIGNED).</li>
 *   <li>Свойства схемы без обогащения — {@code unclassified} (на поверхностях не
 *       показываются); технические — {@code internal}; system — не уходят вовсе
 *       (D-2026-LORE-MODEL-FIELD-VISIBILITY).</li>
 *   <li>Ключ записи — деловой, никогда @rid (D-2026-LORE-MODEL-BUSINESS-KEY).</li>
 * </ul>
 * Чистая функция: схема приходит аргументом (vertex type → имена свойств).
 */
final class LoreModelTypes {

    private LoreModelTypes() {}

    /** Тип записи → (вершина, Hist, деловой ключ). */
    record Graph(String vertex, String hist, String key) {}

    static final Map<String, Graph> GRAPH = Map.of(
        "sprint", new Graph("KnowSprint", "KnowSprintHist", "sprint_id"),
        "task", new Graph("KnowTask", "KnowTaskHist", "task_uid"),
        "adr", new Graph("KnowADR", "KnowADRHist", "adr_id"),
        "spec", new Graph("KnowSpec", "KnowSpecHist", "spec_id"));

    /** Ключ поля паспорта → имя свойства в графе, где они расходятся (известное сопоставление LoreRecordValues). */
    static final Map<String, Map<String, String>> ALIASES = Map.of(
        "sprint", Map.of("title", "name", "status", "status_raw", "created", "created_date",
            "no_release", "no_release_required", "track", "track_id", "planned_start", "planned_start_date"),
        "task", Map.of("status", "status_raw", "note", "note_md", "effort", "effort_days", "actual", "actual_days"),
        "adr", Map.of("title", "name", "status", "status"),
        "spec", Map.of("status", "status", "body_md", "content_md"));

    /** System: с сервера не уходит никогда. */
    static boolean isSystem(String prop) {
        return prop.startsWith("@") || Set.of("valid_to", "state_uid", "content_hash", "secret_ref").contains(prop)
            || prop.contains("embedding") || prop.contains("vector");
    }

    /** Internal: для MCP и админки, на поверхности не выводится. */
    static boolean isInternal(String prop, String key) {
        if (prop.equals(key)) return false;
        return prop.endsWith("_uid") || Set.of("bookkeeping", "kc_sub", "pr_id", "changed_by", "changed_by_kind",
            "status_backfilled", "status_known_from", "status_category", "valid_from", "source_commit",
            "row_version").contains(prop);
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> build(Map<String, List<String>> schema) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (String t : LoreRecordRegistry.TYPES) {
            Graph g = GRAPH.get(t);
            Set<String> props = new LinkedHashSet<>();
            props.addAll(schema.getOrDefault(g.vertex(), List.of()));
            props.addAll(schema.getOrDefault(g.hist(), List.of()));
            Map<String, Object> contract = LoreRecordRegistry.schemaJson(t);
            Map<String, String> aliases = ALIASES.getOrDefault(t, Map.of());
            Set<String> matched = new LinkedHashSet<>();
            List<Map<String, Object>> fields = new ArrayList<>();
            for (Map<String, Object> f : (List<Map<String, Object>>) contract.get("fields")) {
                Map<String, Object> m = new LinkedHashMap<>(f);
                String key = String.valueOf(f.get("key"));
                String property = null;
                for (String cand : candidates(key, f, aliases))
                    if (cand != null && props.contains(cand) && !isSystem(cand)) { property = cand; break; }
                m.put("visibility", "visible");
                m.put("property", property);
                m.put("source", property != null ? "CONFIRMS" : "SUPPLIES");
                if (property != null) matched.add(property);
                fields.add(m);
            }
            List<String> unclassified = new ArrayList<>();
            List<String> internal = new ArrayList<>();
            for (String p : props) {
                if (isSystem(p) || matched.contains(p) || p.equals(g.key())) continue;
                if (isInternal(p, g.key())) internal.add(p); else unclassified.add(p);
            }
            Map<String, Object> type = new LinkedHashMap<>();
            type.put("type", t);
            type.put("label", contract.get("label"));
            type.put("label_key", contract.get("label_key"));
            type.put("icon", contract.get("icon"));
            type.put("key", g.key());
            type.put("vertex", g.vertex());
            type.put("hist", g.hist());
            type.put("fields", fields);
            type.put("relations", contract.get("relations"));
            type.put("unclassified", unclassified);
            type.put("internal", internal);
            out.put(t, type);
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    private static List<String> candidates(String key, Map<String, Object> f, Map<String, String> aliases) {
        List<String> c = new ArrayList<>();
        if (aliases.containsKey(key)) c.add(aliases.get(key));
        Object w = f.get("write");
        if (w instanceof Map<?, ?> wm && wm.get("field") != null) c.add(String.valueOf(wm.get("field")));
        c.add(key);
        return c;
    }
}
