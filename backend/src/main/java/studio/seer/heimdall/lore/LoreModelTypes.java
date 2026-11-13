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

    /**
     * Цвет типа — ИМЯ токена канона v1 ({@code --section-*}), не hex: значение решает
     * тема, светлая и тёмная совпадают (поручение владелицы 11.11: упоминание чужого
     * объекта — с иконкой и цветом его канонического объекта). Каждый токен обязан
     * быть объявлен в src/styles (сторож — LoreModelTypeColorTest).
     */
    static final Map<String, String> TYPE_COLOR = LoreModelFile.content().typeColor();

    /** Типы без канона цвета в v1: color = null честно, цвет не выдумываем. */
    static final Set<String> NO_TYPE_COLOR = LoreModelFile.content().noTypeColor();

    /** Тип записи → (вершина, Hist, деловой ключ). */
    record Graph(String vertex, String hist, String key) {}

    static final Map<String, Graph> GRAPH = LoreModelFile.content().graph();

    /** Ключ поля паспорта → имя свойства в графе, где они расходятся (известное сопоставление LoreRecordValues). */
    static final Map<String, Map<String, String>> ALIASES = LoreModelFile.content().aliases();

    /**
     * SPRINT_UXR_POLISH_UAT_1113/PU-17: поля, значение которых — ребро, а не свойство вершины
     * (тип.ключ → ребро). Роли задачи с TR-05 — рёбра ROLE_HELD_BY; строки author/executor/reviewer_agent
     * не пишутся, и сопоставлять с ними поле значило бы назвать источником пустую строку.
     */
    static final Map<String, String> EDGE_FIELDS = LoreModelFile.content().edgeFields();

    /** Легаси-строки ролей задачи (до TR-05) — в схеме ещё есть, на поверхности не выводятся: internal. */
    static final Set<String> LEGACY_ROLE_STRINGS = LoreModelFile.content().legacyRoleStrings();

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

    /**
     * Чья схема нужна модели: вершины и Hist-типы из {@link #GRAPH}. Раньше
     * LoreModelResource брал только имена на «Know» — у компонента (LoreComponent)
     * схемы не было вовсе, и все его поля выходили SUPPLIES.
     */
    static boolean wantsSchemaOf(String name) {
        if (name == null) return false;
        for (Graph g : GRAPH.values())
            if (name.equals(g.vertex()) || name.equals(g.hist())) return true;
        return false;
    }

    static Map<String, Object> build(Map<String, List<String>> schema) {
        return build(schema, Map.of());
    }

    /**
     * @param declared объявленные типы свойств: vertex type → (свойство → тип схемы,
     *                 DATETIME / DATE / STRING …). Свойство не объявлено (ArcadeDB
     *                 schemaless) — у поля {@code property_type: null}: тип неизвестен,
     *                 а не «строка».
     */
    static Map<String, Object> build(Map<String, List<String>> schema, Map<String, Map<String, String>> declared) {
        return build(schema, declared, null);
    }

    /**
     * @param mandatory MD-REQUIRED: обязательные свойства схемы (mandatory / notNull) по типам
     *                  вершин, {@link LoreFieldRequirement#mandatoryOf}; {@code null} — не читались
     *                  (у типа {@code requirements_block: unknown}).
     */
    @SuppressWarnings("unchecked")
    static Map<String, Object> build(Map<String, List<String>> schema, Map<String, Map<String, String>> declared,
                                     Map<String, Set<String>> mandatory) {
        Map<String, Map<String, String>> decl = declared == null ? Map.of() : declared;
        Map<String, Object> out = new LinkedHashMap<>();
        for (String t : LoreRecordRegistry.TYPES) {
            Graph g = GRAPH.get(t);
            Set<String> props = new LinkedHashSet<>();
            props.addAll(schema.getOrDefault(g.vertex(), List.of()));
            if (g.hist() != null) props.addAll(schema.getOrDefault(g.hist(), List.of()));
            Set<String> req = null;
            if (mandatory != null) {
                req = new LinkedHashSet<>(mandatory.getOrDefault(g.vertex(), Set.of()));
                if (g.hist() != null) req.addAll(mandatory.getOrDefault(g.hist(), Set.of()));
            }
            Map<String, Object> contract = LoreRecordRegistry.schemaJson(t, props, req);
            Map<String, String> aliases = ALIASES.getOrDefault(t, Map.of());
            Set<String> matched = new LinkedHashSet<>();
            List<Map<String, Object>> fields = new ArrayList<>();
            for (Map<String, Object> f : (List<Map<String, Object>>) contract.get("fields")) {
                Map<String, Object> m = new LinkedHashMap<>(f);
                String key = String.valueOf(f.get("key"));
                String property = null;
                String edge = EDGE_FIELDS.get(t + "." + key);
                if (edge == null)
                    for (String cand : candidates(key, f, aliases))
                        if (cand != null && props.contains(cand) && !isSystem(cand)) { property = cand; break; }
                m.put("visibility", "visible");
                m.put("display", display(key, f));
                m.put("property", property);
                m.put("property_type", property == null ? null : declaredType(decl, g, property));
                if ("date".equals(f.get("kind"))) m.put("precision", PRECISION.get(t + "." + key));
                m.put("source", edge != null ? "EDGE" : property != null ? "CONFIRMS" : "SUPPLIES");
                if (edge != null) m.put("edge", edge);
                if (property != null) matched.add(property);
                fields.add(m);
            }
            List<String> unclassified = new ArrayList<>();
            List<String> internal = new ArrayList<>();
            for (String p : props) {
                if (isSystem(p) || matched.contains(p) || p.equals(g.key())) continue;
                if (LEGACY_ROLE_STRINGS.contains(p) && "task".equals(t)) { internal.add(p); continue; }
                if (isInternal(p, g.key())) internal.add(p); else unclassified.add(p);
            }
            Map<String, Object> type = new LinkedHashMap<>();
            type.put("type", t);
            type.put("label", contract.get("label"));
            type.put("label_key", contract.get("label_key"));
            type.put("icon", contract.get("icon"));
            type.put("color", TYPE_COLOR.get(t));
            type.put("key", g.key());
            type.put("vertex", g.vertex());
            type.put("hist", g.hist());
            type.put("time", TIME.get(t));
            type.put("fields", fields);
            type.put("relations", contract.get("relations"));
            type.put("requirements", contract.get("requirements"));
            type.put("requirements_block", contract.get("requirements_block"));
            type.put("computed", COMPUTED.getOrDefault(t, List.of()));
            type.put("unclassified", unclassified);
            type.put("internal", internal);
            out.put(t, type);
        }
        return out;
    }

    private static String declaredType(Map<String, Map<String, String>> decl, Graph g, String property) {
        String v = decl.getOrDefault(g.vertex(), Map.of()).get(property);
        if (v == null && g.hist() != null) v = decl.getOrDefault(g.hist(), Map.of()).get(property);
        return v;
    }

    // ── Время записи (аудит владелицы 10.11) ─────────────────────────────────
    // Модель называет, ГДЕ у типа время и какой оно точности: «день» (строка YYYY-MM-DD)
    // или «момент» (DATETIME valid_from версии / ISO-строка с часами). Без этого kit не
    // отличал «времени дня нет» от «время не пришло». Сверено по коду записи и по проду
    // (срезы decisions, decision_history_all, sprints, releases, questions, use_cases — 10.11).

    /** Точность полей вида date: тип.ключ → date | datetime. */
    static final Map<String, String> PRECISION = LoreModelFile.content().precision();



    /** S4-MODEL-TYPES: у вопроса, фичи/сценария и компонента истории нет — отметку ставит КАЖДЫЙ путь записи. */

    /**
     * Тип → время записи. {@code history}: scd2 — есть цепочка версий (valid_from у
     * каждой — DATETIME), none — нет. {@code created} / {@code changed}: источники по
     * старшинству; changed — те же, из которых срез списка собирает {@code changed_at}
     * (максимум из открытой версии и updated_at, иначе следующий по списку). Пустой
     * список — источника нет (честное «нет времени»), а не «не смотрели».
     */
    static final Map<String, Map<String, Object>> TIME = LoreModelFile.content().time();

    // ── Вид поля: важность и поведение длинного содержимого (владелица 09.11) ──
    // Водораздел: kit знает только ФОРМУ (рисует поле по этим подсказкам), приложение —
    // СМЫСЛ (какое поле важно). Поэтому подсказки — в модели, а не в конфиге kit.

    /** Ширина колонки: от узкой (число) до «тянется» (название). */
    static final List<String> WIDTHS = List.of("xs", "s", "m", "l", "fill");
    /** Длинное содержимое: не режется / многоточие с подсказкой / «ещё N» (многозначное, тексты). */
    static final List<String> OVERFLOWS = List.of("none", "ellipsis", "more");

    /** Уточнения поверх умолчаний по kind: ключ поля → {priority, width, overflow}. */
    static final Map<String, Object[]> DISPLAY_OVERRIDES = LoreModelFile.content().displayOverrides();

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


    /** Правило словами для счётчиков, которые считаются не по задачам спринта. */

    /** Тип → вычисляемые поля. Нет записи — пустой список («вычисляемых нет»). */
    static final Map<String, List<Map<String, Object>>> COMPUTED = LoreModelFile.content().computed();

    /** Свойство графа, которым подтверждено поле (то же сопоставление, что у build): первый кандидат из props, не system. */
    static String propertyOf(String type, Map<String, Object> f, Set<String> props) {
        if (props == null) return null;
        for (String cand : candidates(String.valueOf(f.get("key")), f, ALIASES.getOrDefault(type, Map.of())))
            if (cand != null && props.contains(cand) && !isSystem(cand)) return cand;
        return null;
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
