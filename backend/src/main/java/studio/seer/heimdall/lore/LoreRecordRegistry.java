package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Реестр раскладок типов паспорта {@code lore.record/1} (ADR-LORE-047 п. 1,
 * SPEC-LORE-UXR-RECORD-CONTRACT 0.3, D-2026-LORE-RECORD-LAYOUT-V03).
 *
 * <p><b>Один источник на тип.</b> Поля, разделы «Свойств», разделы текста,
 * подчинённые списки ({@code parts}), вкладки связей ({@code link_tabs}) и дерево
 * описаны здесь, а не в клиенте: kit рисует то, что пришло, и новый тип или поле
 * не требуют правки kit. До этого реестра раскладку эмулировал web-next
 * ({@code loreRecordContract.ts}, {@code passportAdapters.ts}); ключи значений
 * совпадают с той эмуляцией, чтобы переход на сервер не менял потребителя.
 *
 * <p><b>Вид связи у ребра</b> — ровно из DOC-LORE-RECORD-RELATIONS-ADR-SPEC-TASK
 * (D-2026-LORE-RECORD-RELATION-UML): composition — дочки (спринт → задачи),
 * aggregation — лёгкие дочки (решения и вопросы ADR), association — зависимости,
 * attribute — поле-ссылка в «Свойствах», realization — реализация/обоснование,
 * generalization — фичи и UC. Вид задаётся на ребро в контексте типа.
 *
 * <p><b>Подписи</b> — русские, как у адаптеров web-next; {@code label_key} — ключ
 * той же подписи в локалях web-next, где он есть (английский берётся оттуда).
 *
 * <p>Типы сейчас — спринт, задача, ADR, спека (A6). Решение, вопрос, релиз,
 * веха — позже (D-2026-LORE-RECORD-LAYOUT-V03, «Порядок» п. 2).
 */
final class LoreRecordRegistry {

    private LoreRecordRegistry() {}

    /** Типы паспорта v2 — в порядке показа. */
    static final List<String> TYPES = List.of("sprint", "task", "adr", "spec", "decision", "question", "milestone", "release",
        // S4-V2-SECTIONS (kit 09.11): последние три раздела v2 — компонент, технология, фича.
        "component", "tech", "feature");

    /**
     * Kit 09.11: типы с паспортом только на чтение — путей записи в фасаде у них пока нет.
     * Поля не правятся, perms ничего не обещают: кнопка без пути сохранения хуже её отсутствия.
     */
    static final java.util.Set<String> READ_ONLY = java.util.Set.of("decision", "question", "milestone", "release",
        "component", "tech", "feature");

    /** Куда пишется поле: эндпоинт существующего пути записи и имя поля в его теле. */
    record Write(String endpoint, String field) {}

    /**
     * Поле записи. {@code group}: head | body | props. {@code relation} — вид связи,
     * если поле показывает ребро (attribute/composition), иначе null.
     */
    record Field(String key, String label, String labelKey, String kind, String group, String dict,
                 boolean editable, Write write, boolean multi, boolean required,
                 String refType, String rel, String dir, String relation) {}

    /** Раздел текста записи; каждый пишется своим полем (у ADR — три поля adr_set). */
    record Body(String key, String label, String labelKey, boolean editable, Write write) {}

    /** Раздел «Свойств»; {@code section == null} — общий блок сверху. */
    record PropSection(String section, List<String> fields) {}

    /** Подчинённый список (вкладка в зоне записи). Колонки — ключи полей типа ребёнка. */
    record Part(String key, String label, String type, String rel, String dir, String owned,
                String relation, List<String> columns, List<String> optionalColumns,
                String orderBy, String slice) {}

    /** Ребро во вкладке связей; {@code edgeProps} — свойства самого ребра (kind, reason). */
    record TabRel(String rel, String dir, String label, String relation, List<String> edgeProps) {}

    record LinkTab(String key, String label, List<TabRel> rels) {}

    /** Узел дерева раскрытия: часть, группировка детей по полю, колонки. */
    record TreeNode(String part, String label, String groupBy, List<String> columns,
                    List<String> optionalColumns, List<TreeNode> children) {}

    /**
     * Ребро типа с видом UML и местом в паспорте. {@code place}: part | link_tab |
     * prop | head | history | body | links. {@code manageable} — у ребра есть путь
     * привязки через {@code POST /lore/record/{type}/{id}/relation}.
     */
    record Relation(String key, String label, String rel, String dir, String targetType,
                    String relation, String place, boolean manageable) {}

    record TypeDef(String type, String label, String labelKey, String icon,
                   List<Field> fields, List<Body> body, List<PropSection> props,
                   List<Part> parts, List<LinkTab> linkTabs, List<TreeNode> tree,
                   List<Relation> relations) {
        Field field(String key) {
            for (Field f : fields) if (f.key().equals(key)) return f;
            return null;
        }
    }

    // ── Конструкторы описаний (короткие, чтобы таблица типов читалась) ──────

    private static Write w(String endpoint, String field) { return new Write(endpoint, field); }

    private static Field head(String key, String label, String labelKey, String kind, String dict, Write write) {
        return new Field(key, label, labelKey, kind, "head", dict, write != null, write, false,
            "title".equals(key), null, null, null, null);
    }

    private static Field prop(String key, String label, String labelKey, String kind, String dict, Write write) {
        return new Field(key, label, labelKey, kind, "props", dict, write != null, write, false, false,
            null, null, null, null);
    }

    /** Поле-ссылка: ребро в «Свойствах». editable — правится через путь привязки. */
    private static Field ref(String key, String label, String labelKey, String refType, String rel, String dir,
                             String relation, boolean multi, boolean editable) {
        return new Field(key, label, labelKey, "ref", "props", null, editable,
            editable ? w("/lore/record/{type}/{id}/relation", rel) : null, multi, false,
            refType, rel, dir, relation);
    }

    private static Relation rel(String key, String label, String rel, String dir, String target,
                                String relation, String place, boolean manageable) {
        return new Relation(key, label, rel, dir, target, relation, place, manageable);
    }

    /** HAS_STATE и ATTACHED_TO — общие для всех типов паспорта (документ, «Общее для всех трёх»). */
    private static List<Relation> common(List<Relation> own) {
        List<Relation> all = new ArrayList<>(own);
        all.add(rel("history", "История", "HAS_STATE", "out", "hist", "composition", "history", false));
        all.add(rel("assets", "Вложения", "ATTACHED_TO", "in", "asset", "composition", "body", false));
        return List.copyOf(all);
    }

    // ── Колонки строки задачи (дерево спринта, D-2026-LORE-RECORD-LAYOUT-V03) ──
    static final List<String> TASK_NODE_COLUMNS =
        List.of("status", "task_type", "code", "title", "executor", "effort");
    static final List<String> TASK_NODE_OPTIONAL =
        List.of("work_class", "author", "reviewer", "actual", "realizes_uc", "prs");
    static final List<String> PHASE_NODE_COLUMNS = List.of("status", "title", "progress", "valid_from");

    private static final Map<String, TypeDef> TYPE_DEFS = new LinkedHashMap<>();
    /** Описания типов, которые бывают только детьми (фаза) — для колонок parts. */
    private static final Map<String, TypeDef> CHILD_ONLY = new LinkedHashMap<>();

    static {
        // ── Спринт ──────────────────────────────────────────────────────────
        final String plan = "Планирование";
        final String modules = "Модули";
        TYPE_DEFS.put("sprint", new TypeDef("sprint", "Спринт", "pp.kind.sprint", "sprint",
            List.of(
                head("title", "Название", "pp.field.title", "text", null, w("/lore/sprint/update", "name")),
                head("status", "Статус", null, "enum", "sprint_status", w("/lore/status", "status")),
                prop("priority", "Приоритет", "pp.field.priority", "enum", "priority", w("/lore/sprint/plan", "priority")),
                ref("projects", "Проекты", "pp.field.projects", "project", "BELONGS_TO_PROJECT", "out", "attribute", true, true),
                // release_link требует git_project и номера PR — через путь привязки не ведётся.
                ref("releases", "Релизы", "pp.field.releases", "release", "IMPLEMENTED_IN_RELEASE", "out", "attribute", true, false),
                prop("created", "Создан", "pp.field.created", "date", null, null),
                ref("milestones", "Вехи", "pp.field.milestones", "milestone", "TARGETS_MILESTONE", "out", "attribute", true, true),
                prop("planned_start", "Начало по плану", "pp.field.plannedStart", "date", null, w("/lore/sprint/plan", "planned_start_date")),
                prop("planned_end_date", "Конец по плану", "pp.field.plannedEnd", "date", null, w("/lore/sprint/plan", "planned_end_date")),
                prop("no_release", "Не требует релиза", "pp.field.noRelease", "text", null, null),
                prop("track", "Трек", null, "text", null, w("/lore/sprint/plan", "track_id")),
                ref("components", "Компоненты", "pp.field.components", "component", "BELONGS_TO", "out", "attribute", true, true)),
            List.of(
                new Body("context_md", "Контекст", "pp.adr.context", true, w("/lore/sprint/update", "context_md")),
                new Body("outcome_md", "Итог", null, true, w("/lore/sprint/update", "outcome_md"))),
            List.of(
                new PropSection(null, List.of("priority", "projects", "releases")),
                new PropSection(plan, List.of("created", "milestones", "planned_start", "planned_end_date", "no_release", "track")),
                new PropSection(modules, List.of("components"))),
            List.of(
                new Part("phases", "Фазы", "phase", "PART_OF", "in", "strict", "composition",
                    PHASE_NODE_COLUMNS, List.of(), "order_index", "phases_of_sprint"),
                new Part("tasks", "Задачи", "task", "PART_OF", "in", "strict", "composition",
                    TASK_NODE_COLUMNS, TASK_NODE_OPTIONAL, "order_index", "tasks_of_sprint")),
            List.of(new LinkTab("deps", "Зависимости", List.of(
                new TabRel("DEPENDS_ON", "out", "зависит от", "association", List.of("kind", "reason")),
                new TabRel("DEPENDS_ON", "in", "блокирует", "association", List.of("kind", "reason"))))),
            List.of(
                new TreeNode("phases", "Фазы", null, PHASE_NODE_COLUMNS, List.of(),
                    List.of(new TreeNode("tasks", "Задачи", "phase_uid", TASK_NODE_COLUMNS, TASK_NODE_OPTIONAL, List.of()))),
                new TreeNode("tasks", "вне фаз", "phase_uid", TASK_NODE_COLUMNS, TASK_NODE_OPTIONAL, List.of())),
            common(List.of(
                rel("tasks", "Задачи", "PART_OF", "in", "task", "composition", "part", false),
                rel("phases", "Фазы", "PART_OF", "in", "phase", "composition", "part", false),
                rel("dependsOn", "Зависит от", "DEPENDS_ON", "out", "sprint", "association", "link_tab", true),
                rel("blocks", "Блокирует", "DEPENDS_ON", "in", "sprint", "association", "link_tab", true),
                rel("components", "Компоненты", "BELONGS_TO", "out", "component", "attribute", "prop", true),
                rel("projects", "Проекты", "BELONGS_TO_PROJECT", "out", "project", "attribute", "prop", true),
                rel("releases", "Релизы", "IMPLEMENTED_IN_RELEASE", "out", "release", "attribute", "prop", false),
                rel("milestones", "Вехи", "TARGETS_MILESTONE", "out", "milestone", "attribute", "prop", true),
                // Вне таблицы документа (он покрывает задачу, ADR, спеку): обратная
                // сторона ADR → спринт и вопросы спринта — в «Связи / Граф».
                rel("adrs", "Реализует ADR", "IMPLEMENTED_IN", "in", "adr", "realization", "links", true),
                rel("questions", "Вопросы", "RAISED_IN", "in", "question", "aggregation", "links", true)))));

        // ── Задача ──────────────────────────────────────────────────────────
        final String roles = "Роли";
        final String estimate = "Оценка";
        final String classes = "Классы";
        final String edit = "/lore/task/edit";
        TYPE_DEFS.put("task", new TypeDef("task", "Задача", "pp.kind.task", "checkbox-tree",
            List.of(
                head("title", "Название", "pp.field.title", "text", null, w(edit, "title")),
                head("status", "Статус", null, "enum", "task_status", w("/lore/status", "status")),
                head("code", "Код", null, "text", null, null),
                // Спринт — родитель-композиция: в шапке (крошки), правка — только переносом (task_mv).
                new Field("sprint", "Спринт", "pp.field.sprint", "ref", "props", null, false, null, false, true,
                    "sprint", "PART_OF", "out", "composition"),
                ref("phase", "Фаза", null, "phase", "IN_PHASE", "out", "attribute", false, true),
                ref("components", "Компоненты", "pp.field.components", "component", "TAGGED_WITH", "out", "attribute", true, true),
                prop("author", "Автор", "pp.field.author", "text", null, w(edit, "author_agent")),
                prop("executor", "Исполнитель", "pp.field.executor", "text", null, w(edit, "executor_agent")),
                prop("reviewer", "Принимающий", "pp.field.reviewer", "text", null, w(edit, "reviewer_agent")),
                prop("effort", "Оценка, чел.-дн", "pp.field.effort", "number", null, w(edit, "effort_days")),
                prop("actual", "Факт, чел.-дн", "pp.field.actual", "number", null, w(edit, "actual_days")),
                prop("task_type", "Тип задачи", "pp.field.taskType", "enum", "task_type", w(edit, "task_type")),
                prop("work_class", "Класс работы", "pp.field.workClass", "enum", "work_class", w(edit, "work_class")),
                new Field("realizes_uc", "Сценарий (UC)", null, "ref", "props", null, true, w(edit, "uc_id"), true, false,
                    "use_case", "REALIZES", "out", "realization"),
                ref("prs", "PR", "pp.field.prs", "pr", "CLOSED_BY", "out", "realization", true, true),
                ref("files", "Файлы", null, "file", "EDITED_IN", "in", "attribute", true, false)),
            List.of(new Body("note_md", "Заметка", "pp.field.body", true, w(edit, "note_md"))),
            List.of(
                new PropSection(null, List.of("sprint", "phase", "components", "prs", "files")),
                new PropSection(roles, List.of("author", "executor", "reviewer")),
                new PropSection(estimate, List.of("effort", "actual")),
                new PropSection(classes, List.of("task_type", "work_class", "realizes_uc"))),
            List.of(new Part("questions", "Вопросы", "question", "RAISED_IN", "in", "shared", "aggregation",
                List.of("status", "code", "title", "priority"), List.of("due_date"), "question_id", "questions_of_task")),
            List.of(
                new LinkTab("realization", "Реализация", List.of(
                    new TabRel("CLOSED_BY", "out", "закрыта PR", "realization", List.of()),
                    new TabRel("REALIZES", "out", "реализует сценарий", "realization", List.of()))),
                new LinkTab("justification", "Обоснование", List.of(
                    new TabRel("JUSTIFIED_BY", "out", "обоснована ADR", "realization", List.of()),
                    new TabRel("PROMOTED_TO", "in", "из рекомендации QG", "realization", List.of()),
                    new TabRel("LED_TO", "in", "из инсайта BRAGI", "realization", List.of()))),
                new LinkTab("deps", "Зависимости", List.of(
                    new TabRel("GATES", "in", "блокирующие вопросы", "association", List.of("solved_at")),
                    new TabRel("REFERENCES", "out", "ссылается", "association", List.of()),
                    new TabRel("REFERENCES", "in", "на неё ссылаются", "association", List.of()),
                    new TabRel("PRODUCED_BY", "in", "публикации", "association", List.of())))),
            List.of(),
            common(List.of(
                rel("sprint", "Спринт", "PART_OF", "out", "sprint", "composition", "head", false),
                rel("phase", "Фаза", "IN_PHASE", "out", "phase", "attribute", "prop", true),
                rel("components", "Компоненты", "TAGGED_WITH", "out", "component", "attribute", "prop", true),
                rel("roles", "Роли", "ROLE_HELD_BY", "out", "actor", "attribute", "prop", false),
                rel("files", "Файлы", "EDITED_IN", "in", "file", "attribute", "prop", false),
                rel("prs", "PR", "CLOSED_BY", "out", "pr", "realization", "link_tab", true),
                rel("useCases", "Сценарии", "REALIZES", "out", "use_case", "realization", "link_tab", false),
                rel("adrs", "Обоснована ADR", "JUSTIFIED_BY", "out", "adr", "realization", "link_tab", true),
                rel("qgRecs", "Рекомендации QG", "PROMOTED_TO", "in", "qg_recommendation", "realization", "link_tab", false),
                rel("insights", "Инсайты BRAGI", "LED_TO", "in", "insight", "realization", "link_tab", false),
                rel("gates", "Блокирующие вопросы", "GATES", "in", "question", "association", "link_tab", true),
                rel("refsOut", "Ссылается", "REFERENCES", "out", "any", "association", "link_tab", false),
                rel("refsIn", "На неё ссылаются", "REFERENCES", "in", "any", "association", "link_tab", false),
                rel("publications", "Публикации", "PRODUCED_BY", "in", "publication", "association", "link_tab", false),
                rel("questions", "Вопросы", "RAISED_IN", "in", "question", "aggregation", "part", true)))));

        // ── ADR ─────────────────────────────────────────────────────────────
        final String adr = "/lore/adr";
        TYPE_DEFS.put("adr", new TypeDef("adr", "ADR", "pp.kind.adr", "scroll-quill",
            List.of(
                head("title", "Название", "pp.field.title", "text", null, w(adr, "name")),
                head("status", "Статус", null, "enum", "adr_status", w("/lore/status", "status")),
                prop("date", "Дата", "pp.field.date", "date", null, w(adr, "date_created")),
                ref("components", "Компоненты", "pp.field.components", "component", "BELONGS_TO", "out", "attribute", true, true),
                ref("projects", "Проекты", "pp.field.projects", "project", "BELONGS_TO_PROJECT", "out", "attribute", true, true),
                ref("tags", "Теги", "pp.field.tags", "tag", "TAGGED_WITH", "out", "attribute", true, true),
                prop("file_path", "Файл", "pp.field.file", "text", null, w(adr, "file_path"))),
            List.of(
                new Body("context_md", "Контекст", "pp.adr.context", true, w(adr, "context_md")),
                new Body("decision_md", "Решение", "pp.adr.decision", true, w(adr, "decision_md")),
                new Body("consequences_md", "Следствия", "pp.adr.consequences", true, w(adr, "consequences_md"))),
            List.of(new PropSection(null, List.of("date", "components", "projects", "tags", "file_path"))),
            List.of(
                new Part("decisions", "Решения", "decision", "DECIDED_IN", "in", "shared", "aggregation",
                    List.of("status", "code", "title"), List.of("date"), "decision_id", "decisions_of_adr"),
                new Part("questions", "Вопросы", "question", "RAISED_IN", "in", "shared", "aggregation",
                    List.of("status", "code", "title", "priority"), List.of("due_date"), "question_id", "questions_of_adr")),
            List.of(
                new LinkTab("deps", "Зависимости", List.of(
                    new TabRel("DEPENDS_ON", "out", "зависит от", "association", List.of()),
                    new TabRel("DEPENDS_ON", "in", "блокирует", "association", List.of()),
                    new TabRel("SUPERSEDES", "out", "заменяет", "association", List.of()),
                    new TabRel("SUPERSEDES", "in", "заменён", "association", List.of()),
                    new TabRel("REFERENCES_ADR", "in", "ранбуки", "association", List.of()),
                    new TabRel("REFERENCES", "out", "ссылается", "association", List.of()),
                    new TabRel("REFERENCES", "in", "на него ссылаются", "association", List.of()))),
                new LinkTab("realization", "Реализация", List.of(
                    new TabRel("IMPLEMENTED_IN", "out", "спринты", "realization", List.of()),
                    new TabRel("IMPLEMENTED_IN_RELEASE", "out", "релизы", "realization", List.of()),
                    new TabRel("JUSTIFIED_BY", "in", "задачи по этому ADR", "realization", List.of()),
                    new TabRel("TRACED_TO", "in", "сценарии", "realization", List.of()))),
                new LinkTab("justification", "Обоснование", List.of(
                    new TabRel("LED_TO", "in", "из инсайта BRAGI", "realization", List.of())))),
            List.of(),
            common(List.of(
                rel("decisions", "Решения", "DECIDED_IN", "in", "decision", "aggregation", "part", false),
                rel("questions", "Вопросы", "RAISED_IN", "in", "question", "aggregation", "part", true),
                rel("dependsOn", "Зависит от", "DEPENDS_ON", "out", "adr", "association", "link_tab", true),
                rel("blocks", "Блокирует", "DEPENDS_ON", "in", "adr", "association", "link_tab", true),
                rel("supersedes", "Заменяет", "SUPERSEDES", "out", "adr", "association", "link_tab", true),
                rel("supersededBy", "Заменён", "SUPERSEDES", "in", "adr", "association", "link_tab", true),
                rel("runbooks", "Ранбуки", "REFERENCES_ADR", "in", "runbook", "association", "link_tab", false),
                rel("refsOut", "Ссылается", "REFERENCES", "out", "any", "association", "link_tab", false),
                rel("refsIn", "На него ссылаются", "REFERENCES", "in", "any", "association", "link_tab", false),
                rel("components", "Компоненты", "BELONGS_TO", "out", "component", "attribute", "prop", true),
                rel("projects", "Проекты", "BELONGS_TO_PROJECT", "out", "project", "attribute", "prop", true),
                rel("tags", "Теги", "TAGGED_WITH", "out", "tag", "attribute", "prop", true),
                rel("sprints", "Спринты", "IMPLEMENTED_IN", "out", "sprint", "realization", "link_tab", true),
                rel("releases", "Релизы", "IMPLEMENTED_IN_RELEASE", "out", "release", "realization", "link_tab", false),
                rel("justifies", "Обосновывает задачи", "JUSTIFIED_BY", "in", "task", "realization", "link_tab", true),
                rel("useCases", "Сценарии", "TRACED_TO", "in", "use_case", "realization", "link_tab", false),
                rel("insights", "Инсайты BRAGI", "LED_TO", "in", "insight", "realization", "link_tab", false)))));

        // ── Спека ───────────────────────────────────────────────────────────
        final String spec = "/lore/spec";
        TYPE_DEFS.put("spec", new TypeDef("spec", "Спека", "pp.kind.spec", "spell-book",
            List.of(
                head("title", "Название", "pp.field.title", "text", null, w(spec, "title")),
                head("status", "Статус", null, "enum", "spec_status", w(spec, "status")),
                prop("version", "Версия", "pp.field.version", "text", null, w(spec, "version")),
                prop("summary", "Кратко", "pp.field.summary", "md", null, w(spec, "summary")),
                // Компонент спеки: DOCUMENTED_IN (компонент → спека) в приоритете, затем
                // BELONGS_TO — так читает spec_by_id (COALESCE); пишется spec_link(rel:component).
                ref("component", "Компонент", "pp.field.component", "component", "BELONGS_TO", "out", "attribute", false, true),
                ref("projects", "Проекты", "pp.field.projects", "project", "BELONGS_TO_PROJECT", "out", "attribute", true, true),
                prop("file_path", "Файл", "pp.field.file", "text", null, w(spec, "file_path"))),
            List.of(new Body("content_md", "Текст", "pp.field.body", true, w(spec, "content_md"))),
            List.of(new PropSection(null, List.of("version", "summary", "component", "projects", "file_path"))),
            List.of(),
            List.of(new LinkTab("deps", "Зависимости", List.of(
                new TabRel("REFERENCES", "out", "ссылается", "association", List.of()),
                new TabRel("REFERENCES", "in", "на неё ссылаются", "association", List.of())))),
            List.of(),
            common(List.of(
                rel("documentedFor", "Компонент", "DOCUMENTED_IN", "in", "component", "attribute", "prop", false),
                rel("components", "Компонент", "BELONGS_TO", "out", "component", "attribute", "prop", true),
                rel("projects", "Проекты", "BELONGS_TO_PROJECT", "out", "project", "attribute", "prop", true),
                rel("refsOut", "Ссылается", "REFERENCES", "out", "any", "association", "link_tab", false),
                rel("refsIn", "На неё ссылаются", "REFERENCES", "in", "any", "association", "link_tab", false)))));

        // ── Решение (только чтение, kit 09.11) ───────────────────────────────
        // Ключи status/code/title/date — те же, что у колонок parts «Решения» в ADR.
        TYPE_DEFS.put("decision", new TypeDef("decision", "Решение", "pp.kind.decision", "scales",
            List.of(
                head("title", "Название", "pp.field.title", "text", null, null),
                head("status", "Статус", null, "enum", "decision_status", null),
                head("code", "Код", null, "text", null, null),
                prop("date", "Дата", "pp.field.date", "date", null, null),
                ref("adr", "ADR", null, "adr", "DECIDED_IN", "out", "aggregation", false, false),
                ref("components", "Компоненты", "pp.field.components", "component", "BELONGS_TO", "out", "attribute", true, false),
                ref("projects", "Проекты", "pp.field.projects", "project", "BELONGS_TO_PROJECT", "out", "attribute", true, false),
                ref("tags", "Теги", "pp.field.tags", "tag", "TAGGED_WITH", "out", "attribute", true, false)),
            List.of(
                new Body("body_md", "Решение", "pp.field.body", false, null),
                new Body("rationale_md", "Обоснование", null, false, null)),
            List.of(new PropSection(null, List.of("date", "adr", "components", "projects", "tags"))),
            List.of(), List.of(), List.of(),
            List.of(
                rel("adr", "ADR", "DECIDED_IN", "out", "adr", "aggregation", "head", false),
                rel("supersedes", "Заменяет", "SUPERSEDES", "out", "decision", "association", "links", false),
                rel("answers", "Отвечает на вопросы", "ANSWERS", "out", "question", "association", "links", false),
                rel("components", "Компоненты", "BELONGS_TO", "out", "component", "attribute", "prop", false),
                rel("projects", "Проекты", "BELONGS_TO_PROJECT", "out", "project", "attribute", "prop", false),
                rel("tags", "Теги", "TAGGED_WITH", "out", "tag", "attribute", "prop", false))));

        // ── Вопрос (только чтение, kit 09.11) ────────────────────────────────
        // Ключи status/code/title/priority/due_date — те же, что у колонок parts «Вопросы».
        TYPE_DEFS.put("question", new TypeDef("question", "Вопрос", "pp.kind.question", "help",
            List.of(
                head("title", "Название", "pp.field.title", "text", null, null),
                head("status", "Статус", null, "enum", null, null),
                head("code", "Код", null, "text", null, null),
                prop("priority", "Приоритет", "pp.field.priority", "enum", "priority", null),
                prop("due_date", "Срок", null, "date", null, null),
                prop("owner", "Ответственный", null, "text", null, null),
                prop("raised_by", "Поднял", null, "text", null, null),
                prop("opened", "Открыт", null, "date", null, null),
                prop("closed", "Закрыт", null, "date", null, null),
                ref("components", "Компоненты", "pp.field.components", "component", "BELONGS_TO", "out", "attribute", true, false),
                ref("projects", "Проекты", "pp.field.projects", "project", "BELONGS_TO_PROJECT", "out", "attribute", true, false)),
            List.of(new Body("body_md", "Суть", "pp.field.body", false, null)),
            List.of(new PropSection(null, List.of("priority", "due_date", "owner", "raised_by", "opened", "closed", "components", "projects"))),
            List.of(), List.of(), List.of(),
            List.of(
                rel("raisedIn", "Поднят в", "RAISED_IN", "out", "any", "aggregation", "head", false),
                rel("gates", "Блокирует задачи", "GATES", "out", "task", "association", "links", false),
                rel("answeredBy", "Ответ — решения", "ANSWERS", "in", "decision", "association", "links", false),
                rel("components", "Компоненты", "BELONGS_TO", "out", "component", "attribute", "prop", false),
                rel("projects", "Проекты", "BELONGS_TO_PROJECT", "out", "project", "attribute", "prop", false))));

        // ── Веха (только чтение, kit 09.11) ───────────────────────────────────
        TYPE_DEFS.put("milestone", new TypeDef("milestone", "Веха", "pp.kind.milestone", "flag-objective",
            List.of(
                head("title", "Название", "pp.field.title", "text", null, null),
                head("code", "Код", null, "text", null, null),
                prop("week", "Неделя", null, "text", null, null),
                prop("date", "Срок", "pp.field.date", "text", null, null),
                prop("priority", "Приоритет", "pp.field.priority", "enum", "priority", null),
                prop("products", "Продукты", null, "text", null, null)),
            List.of(
                new Body("goal_md", "Цель", null, false, null),
                new Body("decisions_md", "Решения", null, false, null)),
            List.of(new PropSection(null, List.of("week", "date", "priority", "products"))),
            List.of(), List.of(), List.of(),
            List.of(rel("sprints", "Спринты", "TARGETS_MILESTONE", "in", "sprint", "aggregation", "links", false))));

        // ── Релиз (только чтение, kit 09.11) ─────────────────────────────────
        TYPE_DEFS.put("release", new TypeDef("release", "Релиз", "pp.kind.release", "rocket",
            List.of(
                head("title", "Название", "pp.field.title", "text", null, null),
                head("code", "Тег", null, "text", null, null),
                prop("type", "Вид", null, "enum", null, null),
                prop("date", "Дата", "pp.field.date", "date", null, null),
                prop("is_current", "Текущий", null, "text", null, null),
                prop("week", "Неделя", null, "text", null, null),
                ref("projects", "Проекты", "pp.field.projects", "project", "BELONGS_TO_PROJECT", "out", "attribute", true, false)),
            List.of(new Body("description_md", "Описание", "pp.field.body", false, null)),
            List.of(new PropSection(null, List.of("type", "date", "is_current", "week", "projects"))),
            List.of(), List.of(), List.of(),
            List.of(
                rel("sprints", "Спринты", "IMPLEMENTED_IN_RELEASE", "in", "sprint", "realization", "links", false),
                rel("prs", "PR", "SHIPPED_IN", "in", "pr", "realization", "links", false),
                rel("projects", "Проекты", "BELONGS_TO_PROJECT", "out", "project", "attribute", "prop", false))));

        // ── Компонент (только чтение, S4-V2-SECTIONS) ────────────────────────
        // Срез `component`. Тела у компонента нет. Технологии — out('USES').tech_id: это
        // НЕ ключ паспорта технологии (тот — spec_id SPEC-TECH-…), поэтому поле текстовое,
        // а не ссылка: щелчок по нему открыл бы чужую запись.
        TYPE_DEFS.put("component", new TypeDef("component", "Компонент", "pp.kind.component", "cog",
            List.of(
                head("title", "Название", "pp.field.title", "text", null, null),
                head("code", "Код", null, "text", null, null),
                prop("area", "Область", null, "text", null, null),
                ref("parent", "Родитель", null, "component", "PARENT_OF", "out", "composition", false, false),
                prop("owner", "Владелец", null, "text", null, null),
                prop("team", "Команда", null, "text", null, null),
                prop("icon", "Иконка", null, "text", null, null),
                ref("children", "Подкомпоненты", null, "component", "PARENT_OF", "in", "composition", true, false),
                new Field("tech", "Технологии", null, "text", "props", null, false, null, true, false,
                    null, null, null, null),
                ref("adrs", "ADR", null, "adr", "BELONGS_TO", "in", "attribute", true, false),
                ref("specs", "Спеки", null, "spec", "DOCUMENTED_IN", "out", "attribute", true, false)),
            List.of(),
            List.of(
                new PropSection(null, List.of("area", "parent", "owner", "team", "icon")),
                new PropSection(modules, List.of("children", "tech", "adrs", "specs"))),
            List.of(), List.of(), List.of(),
            List.of(
                rel("parent", "Родитель", "PARENT_OF", "out", "component", "composition", "prop", false),
                rel("children", "Подкомпоненты", "PARENT_OF", "in", "component", "composition", "prop", false),
                rel("tech", "Технологии", "USES", "out", "tech", "attribute", "prop", false),
                rel("adrs", "ADR", "BELONGS_TO", "in", "adr", "attribute", "prop", false),
                rel("specs", "Спеки", "DOCUMENTED_IN", "out", "spec", "attribute", "prop", false))));

        // ── Технология (только чтение, S4-V2-SECTIONS) ───────────────────────
        // Технология — спека SPEC-TECH-<КОМПОНЕНТ>-<ТЕХ> (SPRINT_TECH_REGISTRY), срез tech_by_id.
        TYPE_DEFS.put("tech", new TypeDef("tech", "Технология", "pp.kind.tech", "gears",
            List.of(
                head("title", "Название", "pp.field.title", "text", null, null),
                head("code", "Код", null, "text", null, null),
                prop("version", "Версия", "pp.field.version", "text", null, null),
                prop("checked_at", "Проверено", null, "date", null, null),
                ref("component", "Компонент", "pp.field.component", "component", "BELONGS_TO", "out", "attribute", false, false)),
            List.of(new Body("content_md", "Сведения", "pp.field.body", false, null)),
            List.of(new PropSection(null, List.of("version", "checked_at", "component"))),
            List.of(), List.of(), List.of(),
            List.of(
                rel("documentedFor", "Компонент", "DOCUMENTED_IN", "in", "component", "attribute", "prop", false),
                rel("component", "Компонент", "BELONGS_TO", "out", "component", "attribute", "prop", false))));

        // ── Фича / сценарий (только чтение, S4-V2-SECTIONS) ──────────────────
        // Один тип KnowUseCase на все уровни шкалы Коберна (PL-28): паспорт открывает и
        // корень (cloud|kite), и сценарий внутри — раздел US щёлкается в тот же паспорт.
        TYPE_DEFS.put("feature", new TypeDef("feature", "Фича", "pp.kind.feature", "gift-of-knowledge",
            List.of(
                head("title", "Название", "pp.field.title", "text", null, null),
                head("status", "Статус", null, "enum", null, null),
                head("code", "Код", null, "text", null, null),
                prop("goal_level", "Уровень цели", null, "enum", "uc_goal_level", null),
                prop("rigor", "Оформление", null, "enum", null, null),
                prop("priority", "Приоритет", "pp.field.priority", "enum", null, null),
                prop("date", "Создан", "pp.field.date", "date", null, null),
                prop("shipped_at", "Выпущен", null, "date", null, null),
                ref("parent", "Родитель", null, "feature", "DECOMPOSES_INTO", "in", "composition", false, false),
                ref("children", "Сценарии", null, "feature", "DECOMPOSES_INTO", "out", "composition", true, false),
                ref("components", "Компоненты", "pp.field.components", "component", "BELONGS_TO", "out", "attribute", true, false),
                ref("projects", "Проекты", "pp.field.projects", "project", "BELONGS_TO_PROJECT", "out", "attribute", true, false),
                ref("tasks", "Задачи", null, "task", "REALIZES", "in", "realization", true, false)),
            List.of(
                new Body("body_md", "Описание", "pp.field.body", false, null),
                new Body("context_md", "Контекст", "pp.adr.context", false, null),
                new Body("scenario_md", "Сценарий", null, false, null),
                new Body("acceptance_md", "Критерии приёмки", null, false, null)),
            List.of(
                new PropSection(null, List.of("goal_level", "rigor", "priority", "date", "shipped_at", "parent",
                    "components", "projects")),
                new PropSection(modules, List.of("children", "tasks"))),
            List.of(), List.of(), List.of(),
            List.of(
                rel("parent", "Родитель", "DECOMPOSES_INTO", "in", "feature", "composition", "head", false),
                rel("children", "Сценарии", "DECOMPOSES_INTO", "out", "feature", "composition", "prop", false),
                rel("components", "Компоненты", "BELONGS_TO", "out", "component", "attribute", "prop", false),
                rel("projects", "Проекты", "BELONGS_TO_PROJECT", "out", "project", "attribute", "prop", false),
                rel("tasks", "Задачи", "REALIZES", "in", "task", "realization", "prop", false),
                rel("actors", "Акторы", "HAS_ACTOR", "out", "actor", "association", "links", false),
                rel("pains", "Боли", "ADDRESSES", "out", "pain", "association", "links", false),
                rel("gains", "Выгоды", "PROMISES", "out", "gain", "association", "links", false),
                rel("jobs", "Работы", "HELPS_WITH", "out", "job", "association", "links", false))));

        // ── Дети без своего паспорта: фаза, вопрос, решение — поля для колонок parts ──
        CHILD_ONLY.put("phase", childOnly("phase", "Фаза", List.of(
            head("status", "Статус", null, "enum", "task_status", null),
            head("title", "Название", "pp.field.title", "text", null, null),
            prop("progress", "Готово", null, "text", null, null),
            prop("valid_from", "Дата", "pp.field.date", "date", null, null))));
        CHILD_ONLY.put("question", childOnly("question", "Вопрос", List.of(
            head("status", "Статус", null, "enum", null, null),
            head("code", "Код", null, "text", null, null),
            head("title", "Название", "pp.field.title", "text", null, null),
            prop("priority", "Приоритет", "pp.field.priority", "enum", "priority", null),
            prop("due_date", "Срок", null, "date", null, null))));
        CHILD_ONLY.put("decision", childOnly("decision", "Решение", List.of(
            head("status", "Статус", null, "enum", "decision_status", null),
            head("code", "Код", null, "text", null, null),
            head("title", "Название", "pp.field.title", "text", null, null),
            prop("date", "Дата", "pp.field.date", "date", null, null))));
    }

    private static TypeDef childOnly(String type, String label, List<Field> fields) {
        return new TypeDef(type, label, null, null, fields, List.of(), List.of(), List.of(), List.of(), List.of(), List.of());
    }

    /** Описание типа паспорта или {@code null}, если тип ещё не заведён. */
    static TypeDef get(String type) {
        return type == null ? null : TYPE_DEFS.get(type);
    }

    /** Описание типа ребёнка для колонок parts: тип паспорта или «только ребёнок» (фаза, вопрос, решение). */
    static TypeDef childDef(String type) {
        TypeDef d = get(type);
        return d != null ? d : CHILD_ONLY.get(type);
    }

    // ── JSON-форма (schema в lore.record/1) ─────────────────────────────────

    /** {@code schema} ответа: подпись, поля, раскладка, связи. {@code null} — тип не заведён. */
    static Map<String, Object> schemaJson(String type) {
        TypeDef d = get(type);
        if (d == null) return null;
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("type", d.type());
        out.put("label", d.label());
        out.put("label_key", d.labelKey());
        out.put("icon", d.icon());
        List<Map<String, Object>> fields = new ArrayList<>();
        for (Field f : d.fields()) fields.add(fieldJson(d, f));
        for (Body b : d.body()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("key", b.key());
            m.put("label", b.label());
            m.put("label_key", b.labelKey());
            m.put("kind", "md");
            m.put("group", "body");
            m.put("required", false);
            m.put("editable", b.editable());
            m.put("write", writeJson(b.write()));
            fields.add(m);
        }
        out.put("fields", fields);
        out.put("layout", layoutJson(d));
        List<Map<String, Object>> rels = new ArrayList<>();
        for (Relation r : d.relations()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("key", r.key());
            m.put("label", r.label());
            m.put("relation", r.relation());
            m.put("rel", r.rel());
            m.put("dir", r.dir());
            m.put("target_type", r.targetType());
            m.put("place", r.place());
            m.put("manageable", r.manageable());
            rels.add(m);
        }
        out.put("relations", rels);
        return out;
    }

    private static Map<String, Object> fieldJson(TypeDef d, Field f) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("key", f.key());
        m.put("label", f.label());
        m.put("label_key", f.labelKey());
        m.put("kind", f.kind());
        m.put("group", f.group());
        String section = sectionOf(d, f.key());
        if (section != null) m.put("section", section);
        m.put("required", f.required());
        m.put("editable", f.editable());
        if (f.multi()) m.put("multi", true);
        if (f.dict() != null) m.put("dict", f.dict());
        if (f.refType() != null) {
            Map<String, Object> ref = new LinkedHashMap<>();
            ref.put("type", f.refType());
            ref.put("rel", f.rel());
            ref.put("dir", f.dir());
            m.put("ref", ref);
        }
        if (f.relation() != null) m.put("relation", f.relation());
        m.put("write", writeJson(f.write()));
        return m;
    }

    private static String sectionOf(TypeDef d, String key) {
        for (PropSection s : d.props()) if (s.fields().contains(key)) return s.section();
        return null;
    }

    private static Map<String, Object> writeJson(Write w) {
        if (w == null) return null;
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("endpoint", w.endpoint());
        m.put("field", w.field());
        return m;
    }

    static Map<String, Object> layoutJson(TypeDef d) {
        Map<String, Object> out = new LinkedHashMap<>();
        List<Map<String, Object>> body = new ArrayList<>();
        for (Body b : d.body()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("key", b.key());
            m.put("label", b.label());
            m.put("editable", b.editable());
            m.put("write", writeJson(b.write()));
            body.add(m);
        }
        out.put("body", body);
        List<Map<String, Object>> props = new ArrayList<>();
        for (PropSection s : d.props()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("section", s.section());
            m.put("fields", s.fields());
            props.add(m);
        }
        out.put("props", props);
        List<Map<String, Object>> parts = new ArrayList<>();
        for (Part p : d.parts()) parts.add(partJson(p));
        out.put("parts", parts);
        List<Map<String, Object>> tabs = new ArrayList<>();
        for (LinkTab t : d.linkTabs()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("key", t.key());
            m.put("label", t.label());
            List<Map<String, Object>> rels = new ArrayList<>();
            for (TabRel r : t.rels()) {
                Map<String, Object> rm = new LinkedHashMap<>();
                rm.put("rel", r.rel());
                rm.put("dir", r.dir());
                rm.put("label", r.label());
                rm.put("relation", r.relation());
                rm.put("edge_props", r.edgeProps());
                rels.add(rm);
            }
            m.put("rels", rels);
            tabs.add(m);
        }
        out.put("link_tabs", tabs);
        Map<String, Object> tree = new LinkedHashMap<>();
        tree.put("children", treeJson(d.tree()));
        out.put("tree", tree);
        return out;
    }

    /** Описание части без строк — общее для schema.layout и parts[] ответа. */
    static Map<String, Object> partJson(Part p) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("key", p.key());
        m.put("label", p.label());
        m.put("type", p.type());
        m.put("rel", p.rel());
        m.put("dir", p.dir());
        m.put("owned", p.owned());
        m.put("relation", p.relation());
        m.put("columns", p.columns());
        m.put("optional_columns", p.optionalColumns());
        m.put("order_by", p.orderBy());
        // create/prefill у parts — после expected_version (D-2026-LORE-RECORD-LAYOUT-V03, «Порядок» п. 2).
        m.put("create", null);
        return m;
    }

    private static List<Map<String, Object>> treeJson(List<TreeNode> nodes) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (TreeNode n : nodes) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("part", n.part());
            m.put("label", n.label());
            if (n.groupBy() != null) m.put("group_by", n.groupBy());
            m.put("columns", n.columns());
            m.put("optional_columns", n.optionalColumns());
            if (!n.children().isEmpty()) m.put("children", treeJson(n.children()));
            out.add(m);
        }
        return out;
    }
}
