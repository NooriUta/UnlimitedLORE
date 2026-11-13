package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * {@code surfaces.passport} в /lore/model: порядок разделов паспорта, место каждого и группа.
 * Это умолчание модели (D-2026-LORE-MODEL-COLUMN-LAYERS: модель → командный вид → личная
 * настройка), а не отрисовка. Элемент — {key, source, ref, order, slot, group}.
 *
 * <p><b>v3 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-29, D-2026-UXR-OWNER-DELEGATED-ANSWERS-10-11).</b>
 * <ul>
 *   <li>{@code slot}: own — своя вкладка, content — блоком в конце текста. «Ещё» больше НЕ место
 *       модели: сколько вкладок видно (не больше 7) и что уходит в «Ещё», решает kit по ширине.
 *       Порядок по смыслу одинаков на любой ширине, ширина решает только, где начинается «Ещё».</li>
 *   <li>{@code group}: {key, label} или null. Группа — linkTab реестра (второй правды нет): раздел
 *       связи входит в группу, если его ребро (rel, dir) есть среди рёбер linkTab. Разделы одной
 *       группы идут подряд и рисуются одной вкладкой с подзаголовками.</li>
 *   <li>Правило порядка (итоговая таблица анализа passport-tabs-kaos): текст (у контейнера — дети)
 *       → цепочка «решение ↔ работа» → свои связи группой → контекст; связь, у которой обычно
 *       0–1 элемент, — в конце текста.</li>
 *   <li>Пустой раздел (0 связей) остаётся на месте (47а): порядок не прыгает от записи к записи.</li>
 * </ul>
 */
final class LorePassportSurface {

    private LorePassportSurface() {}

    /** Раздел тела — одна статья на все поля тела (у ADR три поля читаются подряд). */
    static final String CONTENT = "content";

    private static final String OWN = "own";

    /** Раздел решённого паспорта: ключ и место. */
    record Slot(String key, String slot) {}

    /**
     * Порядок и место разделов по типам. Раздел, не названный здесь (появился в реестре позже),
     * идёт в конец своей вкладкой — не теряется и не прячется.
     */
    static final Map<String, List<Slot>> DECIDED = LoreModelFile.content().passport();

    record Section(String key, String source, String ref) {}

    /** Разделы типа в порядке данных: тело → части → вкладки связей. */
    static List<Section> byData(LoreRecordRegistry.TypeDef d) {
        List<Section> out = new ArrayList<>();
        if (!d.body().isEmpty()) out.add(new Section(CONTENT, "body", null));
        for (LoreRecordRegistry.Part p : d.parts()) out.add(new Section(p.key(), "part", p.key()));
        for (LoreRecordRegistry.Relation r : d.relations())
            if ("link_tab".equals(r.place())) out.add(new Section(r.key(), "relation", r.key()));
        return out;
    }

    /** Группа раздела связи — linkTab реестра, в рёбрах которого есть (rel, dir) этой связи. */
    static Map<String, Object> groupOf(LoreRecordRegistry.TypeDef d, Section s) {
        if (!"relation".equals(s.source())) return null;
        LoreRecordRegistry.Relation r = null;
        for (LoreRecordRegistry.Relation x : d.relations()) if (x.key().equals(s.ref())) r = x;
        if (r == null) return null;
        for (LoreRecordRegistry.LinkTab t : d.linkTabs())
            for (LoreRecordRegistry.TabRel tr : t.rels())
                if (tr.rel().equals(r.rel()) && tr.dir().equals(r.dir())) {
                    Map<String, Object> g = new LinkedHashMap<>();
                    g.put("key", t.key());
                    g.put("label", t.label());
                    return g;
                }
        return null;
    }

    static Map<String, Object> build() {
        Map<String, Object> out = new LinkedHashMap<>();
        for (String type : LoreRecordRegistry.TYPES) {
            LoreRecordRegistry.TypeDef d = LoreRecordRegistry.get(type);
            List<Section> data = byData(d);
            List<Slot> decidedSlots = DECIDED.get(type);
            boolean decided = decidedSlots != null;
            List<String> order = new ArrayList<>();
            Map<String, String> slots = new LinkedHashMap<>();
            if (decided) for (Slot sl : decidedSlots) { order.add(sl.key()); slots.put(sl.key(), sl.slot()); }
            List<Section> ordered = new ArrayList<>();
            if (decided) {
                for (String k : order)
                    data.stream().filter(s -> s.key().equals(k)).findFirst().ifPresent(ordered::add);
                // Раздел, появившийся в реестре после решения, не теряется — в конец, своей вкладкой.
                for (Section s : data) if (!order.contains(s.key())) ordered.add(s);
            } else {
                ordered.addAll(data);
            }
            List<Map<String, Object>> sections = new ArrayList<>();
            int i = 1;
            for (Section s : ordered) {
                String slot = slots.getOrDefault(s.key(), OWN);
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("key", s.key());
                m.put("source", s.source());
                m.put("ref", s.ref());
                m.put("order", i++);
                m.put("slot", slot);
                // В конце текста групп нет: группа — это вкладка.
                m.put("group", OWN.equals(slot) ? groupOf(d, s) : null);
                sections.add(m);
            }
            Map<String, Object> t = new LinkedHashMap<>();
            t.put("decided", decided);
            t.put("sections", sections);
            out.put(type, t);
        }
        return out;
    }
}
