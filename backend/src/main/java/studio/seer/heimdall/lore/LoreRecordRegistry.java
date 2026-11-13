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

    /**
     * Типы паспорта v2 — в порядке показа. С MC-02 (D-2026-LORE-MODEL-AS-CONFIG) описание модели лежит
     * конфигурацией — shared/model/lore-model.json ({@link LoreModelFile}), а не таблицами здесь.
     */
    static final List<String> TYPES = LoreModelViews.list(() -> LoreModelFile.content().types());

    /**
     * Kit 09.11: типы с паспортом только на чтение — путей записи в фасаде у них пока нет.
     * Поля не правятся, perms ничего не обещают: кнопка без пути сохранения хуже её отсутствия.
     */
    static final java.util.Set<String> READ_ONLY = LoreModelViews.set(() -> LoreModelFile.content().readOnly());

    /** Куда пишется поле: эндпоинт существующего пути записи и имя поля в его теле. */
    record Write(String endpoint, String field) {}

    /**
     * Поле записи. {@code group}: head | body | props. {@code relation} — вид связи,
     * если поле показывает ребро (attribute/composition), иначе null.
     */
    record Field(String key, String label, String labelKey, String kind, String group, String dict,
                 boolean editable, Write write, boolean multi, boolean required,
                 String refType, String rel, String dir, String relation, Options options) {
        Field(String key, String label, String labelKey, String kind, String group, String dict,
              boolean editable, Write write, boolean multi, boolean required,
              String refType, String rel, String dir, String relation) {
            this(key, label, labelKey, kind, group, dict, editable, write, multi, required,
                refType, rel, dir, relation, null);
        }
    }

    /**
     * S4-24 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24): значения поля — строки среза, а не справочник
     * и не свободный текст. {@code GET /lore/slice/{slice}?{param}=<id записи>}; в поле пишется
     * {@code value} строки, показывается {@code label}, группируется по {@code group} (может быть null).
     */
    record Options(String slice, String param, String value, String label, String group) {}

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

    private static final Map<String, TypeDef> TYPE_DEFS = LoreModelViews.map(() -> LoreModelFile.content().typeDefs());
    /** Описания типов, которые бывают только детьми (фаза, вопрос, решение) — для колонок parts. */
    private static final Map<String, TypeDef> CHILD_ONLY = LoreModelViews.map(() -> LoreModelFile.content().childOnly());

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

    /** {@code schema} ответа: подпись, поля, раскладка, связи. {@code null} — тип не заведён. Схема БД не читалась — block «unknown». */
    static Map<String, Object> schemaJson(String type) {
        return schemaJson(type, null, null);
    }

    /**
     * MD-REQUIRED: то же с фактами схемы БД — свойства вершины и Hist типа и обязательные из них
     * ({@link LoreFieldRequirement}). {@code null} — схема не читалась: block неизвестен.
     */
    static Map<String, Object> schemaJson(String type, java.util.Set<String> props, java.util.Set<String> mandatory) {
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
        // MD-REQUIRED: block — из схемы БД, warn — из проверок качества MCP (с условиями).
        out.put("requirements", LoreFieldRequirement.annotate(type, fields, rels, props, mandatory));
        out.put("requirements_block", props != null && mandatory != null ? "schema" : "unknown");
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
        // S4-24: как dict/ref — ключ только у поля с выбором из среза; group — если задан.
        if (f.options() != null) {
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("slice", f.options().slice());
            // param — только у среза «по записи»; общий список зовётся без параметров.
            if (f.options().param() != null) o.put("param", f.options().param());
            o.put("value", f.options().value());
            o.put("label", f.options().label());
            if (f.options().group() != null) o.put("group", f.options().group());
            m.put("options", o);
        }
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
