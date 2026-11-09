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
        "spec", new Graph("KnowSpec", "KnowSpecHist", "spec_id"),
        // Kit 09.11: вершины без истории SCD2 — hist = null.
        "decision", new Graph("KnowDecision", null, "decision_id"),
        "question", new Graph("KnowQuestion", null, "question_id"));

    /** Ключ поля паспорта → имя свойства в графе, где они расходятся (известное сопоставление LoreRecordValues). */
    static final Map<String, Map<String, String>> ALIASES = Map.of(
        "sprint", Map.of("title", "name", "status", "status_raw", "created", "created_date",
            "no_release", "no_release_required", "track", "track_id", "planned_start", "planned_start_date"),
        "task", Map.of("status", "status_raw", "note", "note_md", "effort", "effort_days", "actual", "actual_days"),
        "adr", Map.of("title", "name", "status", "status"),
        "spec", Map.of("status", "status", "body_md", "content_md"),
        "decision", Map.of("status", "status_raw", "code", "decision_id", "date", "date_created"),
        "question", Map.of("code", "question_id", "opened", "opened_date", "closed", "closed_date"));

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
            if (g.hist() != null) props.addAll(schema.getOrDefault(g.hist(), List.of()));
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
                m.put("display", display(key, f));
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
            type.put("computed", COMPUTED.getOrDefault(t, List.of()));
            type.put("unclassified", unclassified);
            type.put("internal", internal);
            out.put(t, type);
        }
        return out;
    }

    // ── Вид поля: важность и поведение длинного содержимого (владелица 09.11) ──
    // Водораздел: kit знает только ФОРМУ (рисует поле по этим подсказкам), приложение —
    // СМЫСЛ (какое поле важно). Поэтому подсказки — в модели, а не в конфиге kit.

    /** Ширина колонки: от узкой (число) до «тянется» (название). */
    static final List<String> WIDTHS = List.of("xs", "s", "m", "l", "fill");
    /** Длинное содержимое: не режется / многоточие с подсказкой / «ещё N» (многозначное, тексты). */
    static final List<String> OVERFLOWS = List.of("none", "ellipsis", "more");

    /** Уточнения поверх умолчаний по kind: ключ поля → {priority, width, overflow}. */
    private static final Map<String, Object[]> DISPLAY_OVERRIDES = Map.of(
        "title", new Object[]{1, "fill", "ellipsis"},
        "status", new Object[]{1, "s", "none"},
        "code", new Object[]{1, "s", "none"},
        "priority", new Object[]{2, "xs", "none"},
        "effort", new Object[]{2, "xs", "none"},
        "summary", new Object[]{4, "l", "more"});

    /**
     * priority — четыре ступени, как пороги прототипа v4 (kit 09.11): 1 — не скрывается
     * никогда (и на телефоне), 2 — скрывается ≤900, 3 — ≤1100, 4 — ≤1280, первой.
     * Умолчание — по kind; уточнения — DISPLAY_OVERRIDES.
     */
    static Map<String, Object> display(String key, Map<String, Object> f) {
        Object[] d = DISPLAY_OVERRIDES.get(key);
        if (d == null) {
            String kind = String.valueOf(f.get("kind"));
            boolean multi = Boolean.TRUE.equals(f.get("multi"));
            d = switch (kind) {
                case "number" -> new Object[]{3, "xs", "none"};
                case "date" -> new Object[]{3, "s", "none"};
                case "enum" -> new Object[]{2, "s", "ellipsis"};
                case "ref" -> multi ? new Object[]{3, "m", "more"} : new Object[]{2, "m", "ellipsis"};
                case "md" -> new Object[]{4, "l", "more"};
                default -> new Object[]{4, "m", "ellipsis"};
            };
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("priority", d[0]);
        m.put("width", d[1]);
        m.put("overflow", d[2]);
        return m;
    }

    // ── Вычисляемые поля (владелица 09.11: «оценка и размер спринтов суммарно по дням
    // и задач — важный элемент, а его нет»). Считает ТОЛЬКО сервер (kit 09.11: одно
    // число из двух мест — расхождение): срез sprint_totals для списка и /lore/record
    // для паспорта — одна функция LoreSprintTotals. Правила в контракте нет — вторая
    // реализация у клиента не нужна. Форма значения — {value, known, of}.

    private static Map<String, Object> computed(String key, String label, String kind, Object[] display) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("priority", display[0]);
        d.put("width", display[1]);
        d.put("overflow", display[2]);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("key", key);
        m.put("label", label);
        m.put("kind", kind);
        m.put("shape", "value_known_of");
        m.put("source", "server");
        m.put("rule_text", LoreSprintTotals.RULE);
        m.put("display", d);
        return m;
    }

    /** Тип → вычисляемые поля. Нет записи — пустой список («вычисляемых нет»). */
    static final Map<String, List<Map<String, Object>>> COMPUTED = Map.of(
        "sprint", List.of(
            computed("tasks_total", "Задач", "count", new Object[]{1, "xs", "none"}),
            computed("effort_days_total", "Оценка, дн", "days", new Object[]{1, "xs", "none"}),
            computed("actual_days_total", "Факт, дн", "days", new Object[]{2, "xs", "none"})));

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
