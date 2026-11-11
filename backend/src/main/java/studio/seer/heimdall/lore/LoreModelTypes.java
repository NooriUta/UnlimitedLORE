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

    /** Цвет типа — имя токена канона v1. ЗАГЛУШКА до правки. */
    static final Map<String, String> TYPE_COLOR = Map.of();

    /** Типы без канона цвета в v1. ЗАГЛУШКА до правки. */
    static final Set<String> NO_TYPE_COLOR = Set.of();

    /** Тип записи → (вершина, Hist, деловой ключ). */
    record Graph(String vertex, String hist, String key) {}

    // Map.ofEntries, а не Map.of: у Map.of предел — десять пар, типов уже одиннадцать.
    static final Map<String, Graph> GRAPH = Map.ofEntries(
        Map.entry("sprint", new Graph("KnowSprint", "KnowSprintHist", "sprint_id")),
        Map.entry("task", new Graph("KnowTask", "KnowTaskHist", "task_uid")),
        Map.entry("adr", new Graph("KnowADR", "KnowADRHist", "adr_id")),
        Map.entry("spec", new Graph("KnowSpec", "KnowSpecHist", "spec_id")),
        // Аудит времени (владелица 10.11): hist — цепочка SCD2 в ГРАФЕ. Kit 09.11 считал, что у
        // решения, вехи и релиза истории нет, — в БД она есть (LoreSlices.HIST_PARENT): статус
        // решения, цель вехи, заведение и правка релиза пишутся версиями. null — только у
        // вершин, у которых Hist-типа нет совсем (вопрос, компонент, фича).
        Map.entry("decision", new Graph("KnowDecision", "KnowDecisionHist", "decision_id")),
        Map.entry("question", new Graph("KnowQuestion", null, "question_id")),
        Map.entry("milestone", new Graph("KnowMilestone", "KnowMilestoneHist", "milestone_id")),
        Map.entry("release", new Graph("KnowRelease", "KnowReleaseHist", "release_uid")),
        // Технология — спека SPEC-TECH-*: её Hist тот же KnowSpecHist (смена номера открывает
        // версию). Что паспорт только для чтения, на факт графа не влияет.
        Map.entry("component", new Graph("LoreComponent", null, "component_id")),
        Map.entry("tech", new Graph("KnowSpec", "KnowSpecHist", "spec_id")),
        Map.entry("feature", new Graph("KnowUseCase", null, "uc_id")),
        // S4-29 (53а): проект — справочная вершина без истории.
        Map.entry("project", new Graph("KnowGitProject", null, "slug")));

    /** Ключ поля паспорта → имя свойства в графе, где они расходятся (известное сопоставление LoreRecordValues). */
    static final Map<String, Map<String, String>> ALIASES = Map.ofEntries(
        Map.entry("sprint", Map.of("title", "name", "status", "status_raw", "created", "created_date",
            "no_release", "no_release_required", "track", "track_id", "planned_start", "planned_start_date")),
        Map.entry("task", Map.of("status", "status_raw", "note", "note_md", "effort", "effort_days", "actual", "actual_days")),
        Map.entry("adr", Map.of("title", "name", "status", "status")),
        Map.entry("spec", Map.of("status", "status", "body_md", "content_md")),
        Map.entry("decision", Map.of("status", "status_raw", "code", "decision_id", "date", "date_created")),
        Map.entry("question", Map.of("code", "question_id", "opened", "opened_date", "closed", "closed_date")),
        Map.entry("milestone", Map.of("title", "label", "code", "milestone_id", "date", "date_display")),
        Map.entry("release", Map.of("code", "release_id", "date", "release_date", "description_md", "description_md")),
        Map.entry("component", Map.of("title", "full_name", "code", "component_id", "parent", "parent_id", "icon", "game_icon")),
        Map.entry("tech", Map.of("code", "spec_id")),
        Map.entry("feature", Map.of("code", "uc_id", "date", "date_created", "parent", "parent_uc_id")),
        Map.entry("project", Map.of("title", "name", "code", "slug")));

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

    /** ЗАГЛУШКА до правки (MD-REQUIRED): mandatory пока не читается. */
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
                m.put("property_type", property == null ? null : declaredType(decl, g, property));
                if ("date".equals(f.get("kind"))) m.put("precision", PRECISION.get(t + "." + key));
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
            type.put("time", TIME.get(t));
            type.put("fields", fields);
            type.put("relations", contract.get("relations"));
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
    static final Map<String, String> PRECISION = Map.ofEntries(
        // created_date ставит заведение спринта (LoreIngestService) — Instant.now(), ISO-момент.
        Map.entry("sprint.created", "datetime"),
        Map.entry("sprint.planned_start", "date"),
        Map.entry("sprint.planned_end_date", "date"),
        Map.entry("adr.date", "date"),
        Map.entry("decision.date", "date"),
        Map.entry("question.due_date", "date"),
        Map.entry("question.opened", "date"),
        Map.entry("question.closed", "date"),
        Map.entry("release.date", "date"),
        // «Проверено» = valid_from открытой версии спеки-технологии (срез tech_registry).
        Map.entry("tech.checked_at", "datetime"),
        Map.entry("feature.date", "date"),
        // shipped_at при поставке ставит UcReadinessCalculator — LocalDate.now(): день, хоть и «_at».
        Map.entry("feature.shipped_at", "date"));

    private static Map<String, Object> src(String source, String precision, String note) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("source", source);
        m.put("precision", precision);
        if (note != null) m.put("note", note);
        return m;
    }

    private static Map<String, Object> time(String history, List<Map<String, Object>> created,
                                            List<Map<String, Object>> changed) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("history", history);
        m.put("created", created);
        m.put("changed", changed);
        return m;
    }

    private static final String VER = "version.valid_from";
    private static final String VER_FIRST = "version.first_valid_from";
    private static final String TOUCHED = "updated_at";
    private static final String TOUCHED_NOTE =
        "отметка правки на месте (ISO-строка); у записей, не правленных после её введения, её нет";
    /** S4-MODEL-TYPES: у вопроса, фичи/сценария и компонента истории нет — отметку ставит КАЖДЫЙ путь записи. */
    private static final String TOUCHED_EVERY =
        "момент заведения или последней правки (ISO-строка), ставит каждый путь записи; бэкфилла нет — у записей, не правленных после её введения, её нет, и правка падает на следующий источник";

    /**
     * Тип → время записи. {@code history}: scd2 — есть цепочка версий (valid_from у
     * каждой — DATETIME), none — нет. {@code created} / {@code changed}: источники по
     * старшинству; changed — те же, из которых срез списка собирает {@code changed_at}
     * (максимум из открытой версии и updated_at, иначе следующий по списку). Пустой
     * список — источника нет (честное «нет времени»), а не «не смотрели».
     */
    static final Map<String, Map<String, Object>> TIME = Map.ofEntries(
        Map.entry("sprint", time("scd2",
            List.of(src("created_date", "datetime",
                "пусто у спринтов, заведённых до отметки; у части — момент массового импорта 03.07.2026, а не заведения")),
            List.of(src(VER, "datetime", null), src(TOUCHED, "datetime", TOUCHED_NOTE), src("created_date", "datetime", null)))),
        Map.entry("task", time("scd2",
            List.of(src(VER_FIRST, "datetime", null)),
            List.of(src(VER, "datetime", null), src(TOUCHED, "datetime", TOUCHED_NOTE)))),
        Map.entry("adr", time("scd2",
            List.of(src("created_at", "datetime", "момент — у ADR, заведённых после S2-10"), src("date_created", "date", null)),
            List.of(src(VER, "datetime", null), src(TOUCHED, "datetime", TOUCHED_NOTE),
                src("created_at", "datetime", null), src("date_created", "date", null)))),
        Map.entry("spec", time("scd2",
            List.of(src(VER_FIRST, "datetime", null)),
            List.of(src(VER, "datetime", null), src(TOUCHED, "datetime", TOUCHED_NOTE)))),
        Map.entry("decision", time("scd2",
            List.of(src("created_at", "datetime", "момент — у решений, заведённых после S2-10"), src("date_created", "date", null)),
            List.of(src(VER, "datetime", "версию открывает смена статуса"), src(TOUCHED, "datetime", TOUCHED_NOTE),
                src("created_at", "datetime", null), src("date_created", "date", null)))),
        Map.entry("question", time("none",
            List.of(src("opened_date", "date", null)),
            List.of(src(TOUCHED, "datetime", TOUCHED_EVERY), src("closed_date", "date", null), src("opened_date", "date", null)))),
        Map.entry("milestone", time("scd2",
            List.of(),
            List.of(src(VER, "datetime", "версию открывает цель вехи"), src(TOUCHED, "datetime", TOUCHED_NOTE)))),
        Map.entry("release", time("scd2",
            List.of(src("released_at", "datetime", "момент — если известен при заведении"), src("release_date", "date", null)),
            List.of(src(VER, "datetime", null), src(TOUCHED, "datetime", TOUCHED_NOTE),
                src("released_at", "datetime", null), src("release_date", "date", null)))),
        Map.entry("component", time("none", List.of(), List.of(src(TOUCHED, "datetime", TOUCHED_EVERY)))),
        Map.entry("tech", time("scd2",
            List.of(src(VER_FIRST, "datetime", null)),
            List.of(src(VER, "datetime", null), src(TOUCHED, "datetime", TOUCHED_NOTE)))),
        Map.entry("feature", time("none",
            List.of(src("date_created", "date", null)),
            List.of(src(TOUCHED, "datetime", TOUCHED_EVERY), src("shipped_at", "date", null), src("date_created", "date", null)))),
        // S4-29 (53а): у проекта ни истории, ни дат заведения и правки — честные пустые списки
        // («источника нет»), а не отсутствие раздела.
        Map.entry("project", time("none", List.of(), List.of())));

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
        m.put("rule_text", RULE_TEXT.getOrDefault(key, LoreSprintTotals.RULE));
        m.put("display", d);
        return m;
    }

    /** Правило словами для счётчиков, которые считаются не по задачам спринта. */
    private static final Map<String, String> RULE_TEXT = Map.of(
        "sprints_total", "Спринты, связанные с записью ребром (TARGETS_MILESTONE у вехи, IMPLEMENTED_IN_RELEASE у релиза); у счёта known = of.",
        "prs_total", "PR, привязанные к релизу ребром SHIPPED_IN; у счёта known = of.");

    /** Тип → вычисляемые поля. Нет записи — пустой список («вычисляемых нет»). */
    static final Map<String, List<Map<String, Object>>> COMPUTED = Map.of(
        "sprint", List.of(
            computed("tasks_total", "Задач", "count", new Object[]{1, "xs", "none"}),
            computed("effort_days_total", "Оценка, дн", "days", new Object[]{1, "xs", "none"}),
            computed("actual_days_total", "Факт, дн", "days", new Object[]{2, "xs", "none"})),
        // Kit 09.11: у вехи и релиза нужны вычисляемые поля, а не статусы.
        "milestone", List.of(
            computed("sprints_total", "Спринтов", "count", new Object[]{1, "xs", "none"})),
        "release", List.of(
            computed("sprints_total", "Спринтов", "count", new Object[]{1, "xs", "none"}),
            computed("prs_total", "PR", "count", new Object[]{2, "xs", "none"})));

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
