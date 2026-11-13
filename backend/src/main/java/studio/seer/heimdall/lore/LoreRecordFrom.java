package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MODEL-RECORD — «откуда» у полей паспорта {@code lore.record/1}
 * (ADR-LORE-048 п. 3, D-2026-UXR-OWNER-DELEGATED-ANSWERS-10-11, 2а).
 *
 * <p>Значение поля читается из КОЛОНКИ среза, а не из свойства вершины: колонка часто
 * зовётся иначе ({@code projects ← git_projects}), приходит с ребра (срез уже свёл его в
 * колонку) или требует преобразования. Поэтому у каждого значения есть описание
 * {@code from: {columns, transform, when}} с ЗАКРЫТЫМ набором преобразований
 * {@link Transform}, а {@code values}, строки частей и связи собирает одна общая функция
 * {@link #assemble} по этим описаниям — вместо 14 ручных функций сборки.
 *
 * <p>Описания — данные, не раскладка: в {@code schema} ответа они не уходят (контракт
 * {@code lore.record/1} прежний, новых ключей нет). Порядок записей в списке — порядок
 * ключей в {@code values}.
 */
final class LoreRecordFrom {

    private LoreRecordFrom() {}

    /**
     * Закрытый набор преобразований колонки среза в значение паспорта. Новое преобразование —
     * правка этого перечисления (и сверки снимков), а не новая функция сборки типа.
     */
    enum Transform {
        /** Строка как есть; пустая и из пробелов — null («переименование колонки»). */
        STR,
        /** Значение колонки без преобразования (числа: effort_days, actual_days). */
        RAW,
        /** Список строк; одиночное значение — список из одного, пустые выброшены. */
        LIST,
        /** Строка без краевых пробелов (разделы текста ADR). */
        TRIM,
        /** Дата — первые 10 символов (ISO-время → день). */
        DATE10,
        /** true → «Да», иначе null. */
        BOOL_YES,
        /** Любое значение текстом ({@code String.valueOf}), null — null. */
        TEXT,
        /** Токен плана из свободного status_raw ({@link LoreRecordValues#planToken}). */
        PLAN_TOKEN,
        /** Строчный код словаря документа ({@link LoreRecordValues#docToken}). */
        DOC_TOKEN,
        /** Есть ли непустое значение (true/false). */
        PRESENT,
        /** Первая непустая строка из колонок по порядку: «название, иначе ключ». */
        FIRST_OF,
        /** Первый элемент списка первой колонки, иначе строка второй: «ребро, иначе денормализация». */
        HEAD_OR
    }

    /**
     * Откуда значение: колонки среза (вторая и дальше — запасные у FIRST_OF / HEAD_OR),
     * преобразование и условие присутствия: при {@code when != null} ключ попадает в
     * {@code values} только если колонка {@code when} — true (признак {@code body_redacted}).
     */
    record From(List<String> columns, Transform transform, String when) {}

    /** Значение паспорта: ключ в {@code values} и откуда оно. */
    record Val(String key, From from) {}

    /** Строка ребёнка части: колонка id, колонка подписи и значения строки. */
    record ItemDef(String idColumn, String titleColumn, List<Val> values) {}

    /**
     * Связь из строки главного среза: ребро, сторона, тип цели и колонка-список id.
     * {@code techByPrefix} — цель SPEC-TECH-… открывается паспортом технологии.
     */
    record LinkFrom(String rel, String dir, String type, String column, boolean techByPrefix, String unionColumn) {
        LinkFrom(String rel, String dir, String type, String column, boolean techByPrefix) {
            this(rel, dir, type, column, techByPrefix, null);
        }
    }

    /**
     * Вкладка связей, которую фасад читает отдельным срезом: что читать и как строка становится связью.
     * {@code paged} — в ответ идёт только первая порция, остальное клиент берёт тем же срезом (S4-29).
     */
    record SliceLink(String key, String slice, String param, String rel, String dir, String type,
                     From id, From title, From status, boolean paged) {}

    // ── Общий сборщик ────────────────────────────────────────────────────────

    /** Одна функция на все типы: значения по описаниям «откуда» из строки среза, в их порядке. */
    static Map<String, Object> assemble(List<Val> vals, Map<String, Object> row) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Val v : vals) {
            From f = v.from();
            if (f.when() != null && !Boolean.TRUE.equals(row.get(f.when()))) continue;
            out.put(v.key(), apply(f, row));
        }
        return out;
    }

    /** Одно преобразование колонки (закрытый набор {@link Transform}). */
    static Object apply(From f, Map<String, Object> row) {
        Object first = row.get(f.columns().get(0));
        return switch (f.transform()) {
            case STR -> LoreRecordValues.str(first);
            case RAW -> first;
            case LIST -> LoreRecordValues.arr(first);
            case TRIM -> trim(LoreRecordValues.str(first));
            case DATE10 -> date10(LoreRecordValues.str(first));
            case BOOL_YES -> Boolean.TRUE.equals(first) ? "Да" : null;
            case TEXT -> first == null ? null : String.valueOf(first);
            case PLAN_TOKEN -> LoreRecordValues.planToken(LoreRecordValues.str(first));
            case DOC_TOKEN -> LoreRecordValues.docToken(first);
            case PRESENT -> LoreRecordValues.str(first) != null;
            case FIRST_OF -> firstOf(f.columns(), row);
            case HEAD_OR -> headOr(f.columns(), row);
        };
    }

    private static String trim(String s) { return s == null ? null : s.trim(); }

    private static String date10(String s) { return s == null ? null : s.substring(0, Math.min(10, s.length())); }

    private static String firstOf(List<String> columns, Map<String, Object> row) {
        for (String c : columns) {
            String s = LoreRecordValues.str(row.get(c));
            if (s != null) return s;
        }
        return null;
    }

    private static String headOr(List<String> columns, Map<String, Object> row) {
        List<String> head = LoreRecordValues.arr(row.get(columns.get(0)));
        if (!head.isEmpty()) return head.get(0);
        return columns.size() > 1 ? LoreRecordValues.str(row.get(columns.get(1))) : null;
    }

    /** Строка ребёнка → item части: значения тем же сборщиком; подпись — колонка подписи, иначе id. */
    static Map<String, Object> item(ItemDef d, Map<String, Object> row) {
        Map<String, Object> vals = assemble(d.values(), row);
        String id = LoreRecordValues.str(row.get(d.idColumn()));
        String title = LoreRecordValues.str(row.get(d.titleColumn()));
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("title", title != null ? title : id);
        m.put("status", vals.get("status"));
        m.put("values", vals);
        return m;
    }

    /** Связи из строки главного среза по описаниям типа. */
    static List<Map<String, Object>> rowLinks(String type, Map<String, Object> row) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (LinkFrom l : ROW_LINKS.getOrDefault(type, List.of())) {
            // unionColumn — второе ребро того же факта (спека → компонент BELONGS_TO рядом с
            // компонент → спека DOCUMENTED_IN): один список без повторов.
            java.util.LinkedHashSet<String> ids = new java.util.LinkedHashSet<>(LoreRecordValues.arr(row.get(l.column())));
            if (l.unionColumn() != null) ids.addAll(LoreRecordValues.arr(row.get(l.unionColumn())));
            for (String id : ids) {
                String t = l.techByPrefix() && id.startsWith(LoreRecordValues.TECH_SPEC_PREFIX) ? "tech" : l.type();
                out.add(LoreRecordValues.link(l.rel(), l.dir(), id, t, id, null));
            }
        }
        return out;
    }

    /** Строка отдельного среза вкладки → связь. */
    static Map<String, Object> sliceLink(SliceLink sl, Map<String, Object> row) {
        return LoreRecordValues.link(sl.rel(), sl.dir(), (String) apply(sl.id(), row), sl.type(),
            (String) apply(sl.title(), row), sl.status() == null ? null : (String) apply(sl.status(), row));
    }

    static SliceLink sliceLinkDef(String type, String key) {
        for (SliceLink sl : SLICE_LINKS.getOrDefault(type, List.of())) if (sl.key().equals(key)) return sl;
        return null;
    }

    // ── Описания ─────────────────────────────────────────────────────────────

    private static From from(Transform t, String... columns) { return new From(List.of(columns), t, null); }

    private static Val v(String key, Transform t, String... columns) { return new Val(key, from(t, columns)); }

    /** Переименование колонки: строка как есть. */
    private static Val s(String key, String column) { return v(key, Transform.STR, column); }

    private static Val list(String key, String column) { return v(key, Transform.LIST, column); }

    private static Val when(String key, String column, String when) {
        return new Val(key, new From(List.of(column), Transform.RAW, when));
    }

    private static LinkFrom lf(String rel, String dir, String type, String column) {
        return new LinkFrom(rel, dir, type, column, false);
    }

    /** Значения записи по типу (строка главного среза {@link LoreRecordResource#sourceOf}). */
    static final Map<String, List<Val>> VALUES = Map.ofEntries(
        Map.entry("sprint", List.of(
            v("title", Transform.FIRST_OF, "name", "sprint_id"),
            s("body_md", "context_md"),
            s("context_md", "context_md"),
            s("outcome_md", "outcome_md"),
            s("priority", "priority"),
            list("projects", "git_projects"),
            list("components", "components"),
            list("releases", "release_ids"),
            list("milestones", "milestone_ids"),
            s("planned_start", "planned_start_date"),
            s("planned_end_date", "planned_end_date"),
            v("created", Transform.DATE10, "created_date"),
            v("no_release", Transform.BOOL_YES, "no_release_required"),
            s("track", "track_id"),
            v("status", Transform.PLAN_TOKEN, "status_raw"))),
        Map.entry("task", List.of(
            v("title", Transform.FIRST_OF, "title", "task_uid"),
            s("body_md", "note_md"),
            s("note_md", "note_md"),
            s("code", "task_id"),
            s("sprint", "sprint_id"),
            s("phase", "phase_uid"),
            list("components", "component_ids"),
            v("effort", Transform.RAW, "effort_days"),
            v("actual", Transform.RAW, "actual_days"),
            s("author", "author_agent"),
            s("executor", "executor_agent"),
            s("reviewer", "reviewer_agent"),
            s("task_type", "task_type"),
            s("work_class", "work_class"),
            list("realizes_uc", "realizes_uc"),
            list("prs", "closed_by_prs"),
            v("status", Transform.PLAN_TOKEN, "status_raw"))),
        Map.entry("adr", List.of(
            v("title", Transform.FIRST_OF, "name", "adr_id"),
            v("context_md", Transform.TRIM, "context_md"),
            v("decision_md", Transform.TRIM, "decision_md"),
            v("consequences_md", Transform.TRIM, "consequences_md"),
            s("date", "date_created"),
            list("components", "components"),
            list("projects", "git_projects"),
            list("tags", "tags"),
            list("depends_on", "depends_on_ids"),
            list("supersedes", "supersedes_ids"),
            s("file_path", "file_path"),
            v("status", Transform.DOC_TOKEN, "status"))),
        Map.entry("spec", List.of(
            v("title", Transform.FIRST_OF, "title", "spec_id"),
            s("body_md", "content_md"),
            s("content_md", "content_md"),
            s("version", "version"),
            s("summary", "summary"),
            list("projects", "projects"),
            s("component", "component_id"),
            s("file_path", "file_path"),
            // Тело обнулено скоупом — признак и причина рядом; без признака ключей нет вовсе.
            when("body_redacted", "body_redacted", "body_redacted"),
            when("body_redacted_reason", "body_redacted_reason", "body_redacted"),
            v("status", Transform.DOC_TOKEN, "status"))),
        // S5-DOC-PASSPORT: документ (KnowDoc) — тело ru/en, без статуса и без SCD2-версий.
        Map.entry("doc", List.of(
            v("title", Transform.FIRST_OF, "title", "doc_id"),
            v("body_md", Transform.FIRST_OF, "content_md_ru", "content_md_en"),
            s("content_md_ru", "content_md_ru"),
            s("content_md_en", "content_md_en"),
            s("kind", "kind"),
            s("component", "component_id"),
            list("projects", "projects"),
            s("parent", "parent_doc_id"),
            list("sprints", "sprint_ids"),
            s("file_path", "file_path"),
            when("body_redacted", "body_redacted", "body_redacted"),
            when("body_redacted_reason", "body_redacted_reason", "body_redacted"))),
        Map.entry("decision", List.of(
            v("title", Transform.FIRST_OF, "title", "decision_id"),
            v("status", Transform.DOC_TOKEN, "status_raw"),
            s("code", "decision_id"),
            s("date", "date_created"),
            s("adr", "parent_adr"),
            list("components", "components"),
            list("projects", "projects"),
            list("tags", "tags"),
            s("body_md", "body_md"),
            s("rationale_md", "rationale_md"))),
        Map.entry("question", List.of(
            v("title", Transform.FIRST_OF, "title", "question_id"),
            v("status", Transform.DOC_TOKEN, "status"),
            s("code", "question_id"),
            s("priority", "priority"),
            s("due_date", "due_date"),
            s("owner", "owner"),
            s("raised_by", "raised_by"),
            s("opened", "opened_date"),
            s("closed", "closed_date"),
            list("components", "components"),
            list("projects", "projects"),
            s("body_md", "body_md"))),
        Map.entry("milestone", List.of(
            v("title", Transform.FIRST_OF, "label", "milestone_id"),
            s("code", "milestone_id"),
            s("week", "week"),
            s("date", "date_display"),
            s("priority", "priority"),
            list("products", "products"),
            s("goal_md", "goal_md"),
            s("decisions_md", "decisions_md"),
            v("status", Transform.DOC_TOKEN, "status"))),
        Map.entry("release", List.of(
            // У релиза подпись — версия, иначе тег (release_id, иначе git_tag).
            v("title", Transform.FIRST_OF, "version", "release_id", "git_tag"),
            v("code", Transform.FIRST_OF, "release_id", "git_tag"),
            s("type", "type"),
            s("date", "release_date"),
            v("is_current", Transform.TEXT, "is_current"),
            s("week", "week"),
            list("projects", "projects"),
            s("description_md", "description_md"),
            v("status", Transform.DOC_TOKEN, "status"))),
        Map.entry("component", List.of(
            v("title", Transform.FIRST_OF, "full_name", "component_id"),
            s("code", "component_id"),
            s("area", "area"),
            s("parent", "parent_id"),
            s("owner", "owner"),
            s("team", "team"),
            s("icon", "game_icon"),
            list("children", "sub_components"),
            list("tech", "tech"),
            list("adrs", "adrs"),
            list("specs", "specs"),
            // S4-PRODUCTS-NODE: продукты компонента (IN_PRODUCT) — чипами в паспорт продукта.
            list("products", "products"),
            v("status", Transform.DOC_TOKEN, "status"))),
        Map.entry("tech", List.of(
            v("title", Transform.FIRST_OF, "tech_name", "spec_id"),
            s("code", "spec_id"),
            s("version", "version"),
            s("checked_at", "checked_at"),
            s("component", "component_id"),
            s("body_md", "content_md"),
            s("content_md", "content_md"),
            v("status", Transform.DOC_TOKEN, "status"))),
        Map.entry("feature", List.of(
            v("title", Transform.FIRST_OF, "title", "uc_id"),
            s("code", "uc_id"),
            s("goal_level", "goal_level"),
            s("rigor", "rigor"),
            s("priority", "priority"),
            s("date", "date_created"),
            s("shipped_at", "shipped_at"),
            // Источник истины — ребро DECOMPOSES_INTO; parent_uc_id — денормализация (на случай без ребра).
            v("parent", Transform.HEAD_OR, "parent_uc_ids", "parent_uc_id"),
            list("children", "child_uc_ids"),
            list("components", "component_ids"),
            list("projects", "projects"),
            list("tasks", "task_uids"),
            s("body_md", "body_md"),
            s("context_md", "context_md"),
            s("scenario_md", "scenario_md"),
            s("acceptance_md", "acceptance_md"),
            v("status", Transform.DOC_TOKEN, "status"))),
        // S4-29 (53а): проект — справочная вершина KnowGitProject; статуса у проекта нет.
        Map.entry("project", List.of(
            v("title", Transform.FIRST_OF, "name", "slug"),
            s("code", "slug"),
            s("default_branch", "default_branch"),
            v("is_private", Transform.BOOL_YES, "is_private"))),
        // S4-PRODUCTS-NODE: продукт — статья словаря (ключ code); подпись — label_ru, иначе код.
        // Цвет — колонка color статьи как есть: нет её — null, цвет не выдумывается.
        Map.entry("product", List.of(
            v("title", Transform.FIRST_OF, "label_ru", "code"),
            s("code", "code"),
            s("color", "color"),
            s("label_en", "label_en"),
            s("icon", "icon"),
            v("sort_order", Transform.RAW, "sort_order"),
            v("is_active", Transform.BOOL_YES, "is_active"),
            v("parent", Transform.HEAD_OR, "parent_code"),
            list("projects", "git_projects"),
            list("components", "components"))));

    /** Строки детей частей по типу ребёнка (фаза — не здесь: её «x/y» считается по задачам). */
    static final Map<String, ItemDef> ITEMS = Map.of(
        "task", new ItemDef("task_uid", "title", List.of(
            v("status", Transform.PLAN_TOKEN, "status_raw"),
            s("task_type", "task_type"),
            s("code", "task_id"),
            s("title", "title"),
            s("executor", "executor_agent"),
            v("effort", Transform.RAW, "effort_days"),
            s("work_class", "work_class"),
            s("author", "author_agent"),
            s("reviewer", "reviewer_agent"),
            v("actual", Transform.RAW, "actual_days"),
            list("realizes_uc", "realizes_uc"),
            list("prs", "closed_by_prs"),
            s("phase_uid", "phase_uid"),
            v("has_note", Transform.PRESENT, "note_md"))),
        "question", new ItemDef("question_id", "title", List.of(
            v("status", Transform.DOC_TOKEN, "status"),
            s("code", "question_id"),
            s("title", "title"),
            s("priority", "priority"),
            s("due_date", "due_date"))),
        "decision", new ItemDef("decision_id", "title", List.of(
            v("status", Transform.DOC_TOKEN, "status_raw"),
            s("code", "decision_id"),
            s("title", "title"),
            s("date", "date_created"))));

    /** Связи из строки главного среза (S4-29 v3); пустой список — «проверено, связей нет». */
    static final Map<String, List<LinkFrom>> ROW_LINKS = Map.ofEntries(
        Map.entry("sprint", List.of(
            lf("DEPENDS_ON", "out", "sprint", "depends_on"),
            lf("DEPENDS_ON", "in", "sprint", "blocks"),
            lf("IMPLEMENTED_IN", "in", "adr", "adr_ids"),
            // 11.11 (полнота модели рёбер): документы, реализованные в спринте.
            lf("IMPLEMENTED_IN", "in", "doc", "doc_ids"))),
        Map.entry("task", List.of(
            lf("CLOSED_BY", "out", "pr", "closed_by_prs"),
            lf("REALIZES", "out", "use_case", "realizes_uc"))),
        Map.entry("adr", List.of(
            lf("DEPENDS_ON", "out", "adr", "depends_on_ids"),
            lf("DEPENDS_ON", "in", "adr", "blocks_ids"),
            lf("SUPERSEDES", "out", "adr", "supersedes_ids"),
            lf("SUPERSEDES", "in", "adr", "superseded_by_ids"),
            lf("IMPLEMENTED_IN", "out", "sprint", "implemented_in_ids"),
            lf("IMPLEMENTED_IN_RELEASE", "out", "release", "release_ids"),
            lf("JUSTIFIED_BY", "in", "task", "justified_task_uids"),
            lf("TRACED_TO", "in", "use_case", "traced_by_ucs"))),
        Map.entry("decision", List.of(
            lf("SUPERSEDES", "out", "decision", "supersedes_ids"),
            lf("ANSWERS", "out", "question", "answers_ids"),
            // 11.11: кем заменено и какие сценарии ссылаются на решение как на обоснование.
            lf("SUPERSEDES", "in", "decision", "superseded_by_ids"),
            lf("TRACED_TO", "in", "feature", "traced_by_ucs"))),
        Map.entry("question", List.of(
            lf("ANSWERS", "in", "decision", "answered_by"),
            lf("GATES", "out", "task", "gating_tasks"))),
        Map.entry("milestone", List.of(
            lf("TARGETS_MILESTONE", "in", "sprint", "direct_sprint_ids"),
            // 11.11: фичи, целящие в веху (то же ребро, другой тип источника).
            lf("TARGETS_MILESTONE", "in", "feature", "feature_ids"))),
        // 11.11: ADR, выпущенные релизом; спринты и PR — отдельными срезами (SLICE_LINKS).
        Map.entry("release", List.of(
            lf("IMPLEMENTED_IN_RELEASE", "in", "adr", "adr_ids"))),
        Map.entry("component", List.of(
            // Технология — это спека SPEC-TECH-…: тип tech, чтобы щелчок открыл паспорт технологии.
            // Слово владелицы 11.11: + спеки, привязанные только ребром спека → компонент (BELONGS_TO).
            new LinkFrom("DOCUMENTED_IN", "out", "spec", "specs", true, "belonging_specs"),
            lf("BELONGS_TO", "in", "adr", "adrs"),
            // out('USES').tech_id — НЕ ключ паспорта (тот — spec_id SPEC-TECH-…): тип tech_ref.
            lf("USES", "out", "tech_ref", "tech"),
            lf("PARENT_OF", "in", "component", "sub_components"),
            // Как v1 (QG · Знания · Сценарии) и по путям записи: всё, что ставит BELONGS_TO к компоненту.
            lf("BELONGS_TO", "in", "decision", "decisions"),
            lf("BELONGS_TO", "in", "question", "questions"),
            lf("BELONGS_TO", "in", "feature", "features"),
            lf("BELONGS_TO", "in", "doc", "docs"),
            lf("BELONGS_TO", "in", "qg", "qgs"),
            lf("IN_PRODUCT", "out", "product", "products"))),
        // S4-PRODUCTS-NODE: компоненты продукта и подпродукты — из строки product_by_id.
        Map.entry("product", List.of(
            lf("IN_PRODUCT", "in", "component", "components"),
            lf("PARENT_PRODUCT", "in", "product", "sub_products"),
            lf("SERVES", "out", "product", "serves"),
            lf("SERVES", "in", "product", "served_by"),
            lf("TARGETS_PRODUCT", "in", "milestone", "milestone_ids"))),
        Map.entry("feature", List.of(
            lf("DECOMPOSES_INTO", "out", "feature", "child_uc_ids"),
            lf("REALIZES", "in", "task", "task_uids"),
            lf("HAS_ACTOR", "out", "actor", "actor_ids"),
            lf("ADDRESSES", "out", "pain", "pain_ids"),
            lf("PROMISES", "out", "gain", "gain_ids"),
            lf("HELPS_WITH", "out", "job", "job_ids"),
            // 11.11 (полнота модели рёбер): что сценарий делает, обоснование, вехи, граф сценариев.
            lf("RELIEVES", "out", "pain", "relieved_pain_ids"),
            lf("DELIVERS", "out", "gain", "delivered_gain_ids"),
            lf("PERFORMS", "out", "job", "performed_job_ids"),
            lf("TRACED_TO", "out", "adr", "traced_adrs"),
            lf("TRACED_TO", "out", "decision", "traced_decisions"),
            lf("TARGETS_MILESTONE", "out", "milestone", "milestone_ids"),
            lf("BUILDS_ON", "out", "feature", "builds_on_ids"),
            lf("BUILDS_ON", "in", "feature", "built_on_by_ids"),
            lf("UC_INCLUDES", "out", "feature", "includes_ids"),
            lf("UC_INCLUDES", "in", "feature", "included_by_ids"),
            lf("UC_EXTENDS", "out", "feature", "extends_ids"),
            lf("UC_EXTENDS", "in", "feature", "extended_by_ids"))));

    /** Вкладки связей, которые фасад читает отдельным срезом, — в порядке чтения. */
    static final Map<String, List<SliceLink>> SLICE_LINKS = Map.of(
        "task", List.of(
            new SliceLink("adrs", "adrs_of_task", "id", "JUSTIFIED_BY", "out", "adr",
                from(Transform.STR, "adr_id"), from(Transform.STR, "name"), from(Transform.DOC_TOKEN, "status"), false),
            // S4-29 v3: блокирующие вопросы — блоком в конце заметки.
            new SliceLink("gates", "gating_questions_of_task", "id", "GATES", "in", "question",
                from(Transform.STR, "question_id"), from(Transform.STR, "title"), from(Transform.DOC_TOKEN, "status"), false)),
        // S4-29 v3 (44а): Спринты · PR релиза. Ключ записи — release_uid, его и ждут срезы.
        "release", List.of(
            new SliceLink("sprints", "release_sprints", "ruid", "IMPLEMENTED_IN_RELEASE", "in", "sprint",
                from(Transform.STR, "sprint_id"), from(Transform.STR, "name"), from(Transform.PLAN_TOKEN, "status_raw"), true),
            new SliceLink("prs", "release_prs", "ruid", "SHIPPED_IN", "in", "pr",
                from(Transform.FIRST_OF, "pr_uid", "pr_number"), from(Transform.STR, "title"), null, false)),
        // S4-29: Задачи · Спринты компонента — по рёбрам, срезами с пагинацией.
        "component", List.of(
            new SliceLink("tasks", "component_tasks", "cid", "TAGGED_WITH", "in", "task",
                from(Transform.STR, "task_uid"), from(Transform.STR, "title"), from(Transform.PLAN_TOKEN, "status_raw"), true),
            new SliceLink("sprints", "component_sprints", "cid", "BELONGS_TO", "in", "sprint",
                from(Transform.STR, "sprint_id"), from(Transform.STR, "name"), from(Transform.PLAN_TOKEN, "status_raw"), true)),
        // S4-29 (53а): вкладки паспорта проекта — каждая своим срезом project_*, постранично.
        // Компоненты — через спринты проекта; агенты — через роль владельца (своего ребра к
        // проекту у них нет), поэтому rel у них тот же, что у людей, а различает тип цели.
        "project", List.of(
            new SliceLink("sprints", "project_sprints", "project", "BELONGS_TO_PROJECT", "in", "sprint",
                from(Transform.STR, "sprint_id"), from(Transform.FIRST_OF, "name", "sprint_id"), from(Transform.PLAN_TOKEN, "status_raw"), true),
            new SliceLink("components", "project_components", "project", "BELONGS_TO_PROJECT", "in", "component",
                from(Transform.STR, "component_id"), from(Transform.FIRST_OF, "full_name", "component_id"), null, true),
            new SliceLink("adrs", "project_adrs", "project", "BELONGS_TO_PROJECT", "in", "adr",
                from(Transform.STR, "adr_id"), from(Transform.FIRST_OF, "name", "adr_id"), from(Transform.DOC_TOKEN, "status"), true),
            new SliceLink("releases", "project_releases", "project", "BELONGS_TO_PROJECT", "in", "release",
                from(Transform.STR, "release_uid"), from(Transform.FIRST_OF, "version", "release_id", "git_tag", "release_uid"), null, true),
            new SliceLink("people", "project_people", "project", "HAS_PROJECT_ROLE", "in", "user",
                from(Transform.STR, "kc_sub"), from(Transform.FIRST_OF, "display_name", "kc_sub"), null, true),
            new SliceLink("agents", "project_agents", "project", "HAS_PROJECT_ROLE", "in", "agent",
                from(Transform.STR, "actor_id"), from(Transform.FIRST_OF, "name", "actor_id"), null, true),
            // Слово владелицы 11.11: «у проекта всё показывать, что связано напрямую» — каждый конец
            // BELONGS_TO_PROJECT своим срезом project_*, постранично, как вкладки 53а.
            new SliceLink("specs", "project_specs", "project", "BELONGS_TO_PROJECT", "in", "spec",
                from(Transform.STR, "spec_id"), from(Transform.FIRST_OF, "title", "spec_id"), from(Transform.DOC_TOKEN, "status"), true),
            new SliceLink("decisions", "project_decisions", "project", "BELONGS_TO_PROJECT", "in", "decision",
                from(Transform.STR, "decision_id"), from(Transform.FIRST_OF, "title", "decision_id"), from(Transform.DOC_TOKEN, "status_raw"), true),
            new SliceLink("questions", "project_questions", "project", "BELONGS_TO_PROJECT", "in", "question",
                from(Transform.STR, "question_id"), from(Transform.FIRST_OF, "title", "question_id"), from(Transform.DOC_TOKEN, "status"), true),
            new SliceLink("features", "project_features", "project", "BELONGS_TO_PROJECT", "in", "feature",
                from(Transform.STR, "uc_id"), from(Transform.FIRST_OF, "title", "uc_id"), from(Transform.DOC_TOKEN, "status"), true),
            new SliceLink("docs", "project_docs", "project", "BELONGS_TO_PROJECT", "in", "doc",
                from(Transform.STR, "doc_id"), from(Transform.FIRST_OF, "title", "doc_id"), null, true),
            new SliceLink("runbooks", "project_runbooks", "project", "BELONGS_TO_PROJECT", "in", "runbook",
                from(Transform.STR, "runbook_id"), from(Transform.FIRST_OF, "name", "runbook_id"), null, true),
            new SliceLink("actors", "project_actors", "project", "BELONGS_TO_PROJECT", "in", "actor",
                from(Transform.STR, "actor_id"), from(Transform.FIRST_OF, "name", "actor_id"), null, true),
            new SliceLink("boundAgents", "project_bound_agents", "project", "BELONGS_TO_PROJECT", "in", "agent",
                from(Transform.STR, "actor_id"), from(Transform.FIRST_OF, "name", "actor_id"), null, true),
            new SliceLink("files", "project_files", "project", "BELONGS_TO_PROJECT", "in", "file",
                from(Transform.STR, "file_path"), from(Transform.STR, "file_path"), null, true),
            new SliceLink("prs", "project_prs", "project", "BELONGS_TO_PROJECT", "in", "pr",
                from(Transform.FIRST_OF, "pr_uid", "pr_number"), from(Transform.FIRST_OF, "title", "pr_uid"), null, true)),
        // S4-PRODUCTS-NODE: сценарии и профиль клиента продукта — через его компоненты, постранично.
        "product", List.of(
            new SliceLink("features", "product_features", "code", "IN_PRODUCT", "in", "feature",
                from(Transform.STR, "uc_id"), from(Transform.FIRST_OF, "title", "uc_id"), from(Transform.DOC_TOKEN, "status"), true),
            new SliceLink("pains", "product_pains", "code", "ADDRESSES", "out", "pain",
                from(Transform.STR, "pain_id"), from(Transform.FIRST_OF, "title", "pain_id"), null, true),
            new SliceLink("gains", "product_gains", "code", "PROMISES", "out", "gain",
                from(Transform.STR, "gain_id"), from(Transform.FIRST_OF, "title", "gain_id"), null, true),
            new SliceLink("jobs", "product_jobs", "code", "HELPS_WITH", "out", "job",
                from(Transform.STR, "job_id"), from(Transform.FIRST_OF, "title", "job_id"), null, true),
            new SliceLink("actors", "product_actors", "code", "HAS_ACTOR", "out", "actor",
                from(Transform.STR, "actor_id"), from(Transform.FIRST_OF, "name", "actor_id"), null, true)));
}
