package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * {@code surfaces.passport} в /lore/model: порядок разделов паспорта и что по умолчанию
 * под «Ещё». Это умолчание модели (D-2026-LORE-MODEL-COLUMN-LAYERS: модель → командный вид →
 * личная настройка), а не отрисовка: kit сам решает, вкладки это на десктопе или свёртка
 * на телефоне. Поэтому ключ — {@code sections}, элемент — только
 * {key, source, ref, order, default_visible}.
 *
 * <p>{@code decided}: true — порядок задан словом владелицы; false — порядок по данным
 * (тело → части → вкладки связей в порядке реестра), сервер ничего не решал и ничего не прячет.
 */
final class LorePassportSurface {

    private LorePassportSurface() {}

    /** Раздел тела — одна статья на все поля тела (у ADR три поля читаются подряд). */
    static final String CONTENT = "content";

    /** Явный порядок по слову владелицы; ключи — разделы этого типа. */
    private static final Map<String, List<String>> DECIDED_ORDER = Map.of(
        // 09.11: «Спринт первое как ни странно задачи потом уже контент … зависимости и прочее под море».
        "sprint", List.of("tasks", CONTENT, "phases", "dependsOn", "blocks"));

    /**
     * Видны сразу. Остальное в decided-типе — под «Ещё». Фазы у спринта скрыты по замеру
     * 09.11: phase_uid есть у задач 4 спринтов из 29 последних.
     */
    private static final Map<String, Set<String>> DECIDED_VISIBLE = Map.of(
        "sprint", Set.of("tasks", CONTENT));

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

    static Map<String, Object> build() {
        Map<String, Object> out = new LinkedHashMap<>();
        for (String type : LoreRecordRegistry.TYPES) {
            LoreRecordRegistry.TypeDef d = LoreRecordRegistry.get(type);
            List<Section> data = byData(d);
            List<String> order = DECIDED_ORDER.get(type);
            boolean decided = order != null;
            List<Section> ordered = new ArrayList<>();
            if (decided) {
                for (String k : order)
                    data.stream().filter(s -> s.key().equals(k)).findFirst().ifPresent(ordered::add);
                // Раздел, появившийся в реестре после решения, не теряется — в конец и под «Ещё».
                for (Section s : data) if (!order.contains(s.key())) ordered.add(s);
            } else {
                ordered.addAll(data);
            }
            Set<String> visible = DECIDED_VISIBLE.getOrDefault(type, Set.of());
            List<Map<String, Object>> sections = new ArrayList<>();
            int i = 1;
            for (Section s : ordered) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("key", s.key());
                m.put("source", s.source());
                m.put("ref", s.ref());
                m.put("order", i++);
                m.put("default_visible", !decided || visible.contains(s.key()));
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
