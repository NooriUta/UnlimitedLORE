package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Чипы шапки паспорта: проекты и компоненты записи (решения владелицы 50а, 51а, 55а —
 * D-2026-UXR-OWNER-DELEGATED-ANSWERS-10-11; SPRINT_UXR_S4_UI_SHELL_LISTS/S4-29).
 *
 * <p>Форма {@code values.projects} / {@code values.components} — у ВСЕХ типов:
 * {@code [{id, label, inherited_from: null | {type, id}}]}. Новых ключей ответа нет (3б):
 * те же ключи, что и раньше, только элемент стал чипом.
 * <ul>
 *   <li>Порядок (55а): свои — в порядке рёбер, затем унаследованные — по частоте
 *       (сколько источников его дают), при равенстве — по первому появлению.</li>
 *   <li>Унаследованное, которое уже есть среди своих, не повторяется.</li>
 *   <li>{@code inherited_from} — первый источник (51а: «от спринта», «от фичи»).</li>
 *   <li>{@code label} — имя (проекта / компонента), иначе id: подпись не выдумывается.</li>
 * </ul>
 * Чистые функции — без БД.
 */
final class LoreRecordChips {

    private LoreRecordChips() {}

    /** Один унаследованный id и откуда он пришёл. */
    record Inherited(String id, String fromType, String fromId) {}

    static List<Map<String, Object>> chips(List<String> own, List<Inherited> inherited, Map<String, String> labels) {
        List<Map<String, Object>> out = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        for (String id : own == null ? List.<String>of() : own) {
            if (id == null || id.isBlank() || !seen.add(id)) continue;
            out.add(chip(id, labels, null));
        }
        Map<String, Inherited> first = new LinkedHashMap<>();
        Map<String, Integer> freq = new LinkedHashMap<>();
        for (Inherited i : inherited == null ? List.<Inherited>of() : inherited) {
            if (i == null || i.id() == null || i.id().isBlank() || seen.contains(i.id())) continue;
            first.putIfAbsent(i.id(), i);
            freq.merge(i.id(), 1, Integer::sum);
        }
        List<String> order = new ArrayList<>(first.keySet());
        // Устойчивая сортировка: при равной частоте — порядок первого появления.
        order.sort((a, b) -> Integer.compare(freq.get(b), freq.get(a)));
        for (String id : order) {
            Inherited i = first.get(id);
            Map<String, Object> from = new LinkedHashMap<>();
            from.put("type", i.fromType());
            from.put("id", i.fromId());
            out.add(chip(id, labels, from));
        }
        return out;
    }

    private static Map<String, Object> chip(String id, Map<String, String> labels, Map<String, Object> from) {
        Map<String, Object> c = new LinkedHashMap<>();
        c.put("id", id);
        String l = labels == null ? null : labels.get(id);
        c.put("label", l == null || l.isBlank() ? id : l);
        c.put("inherited_from", from);
        return c;
    }

    /** Свои проекты записи из values (у всех типов, где они есть, — список slug). */
    static List<String> ownProjects(Map<String, Object> values) {
        return LoreRecordValues.arr(values.get("projects"));
    }

    /** Свои компоненты: список {@code components}, у спеки и технологии — одиночный {@code component}. */
    static List<String> ownComponents(String type, Map<String, Object> values) {
        List<String> l = new ArrayList<>(LoreRecordValues.arr(values.get("components")));
        if (("spec".equals(type) || "tech".equals(type))) {
            String one = LoreRecordValues.str(values.get("component"));
            if (one != null && !l.contains(one)) l.add(one);
        }
        return l;
    }
}
