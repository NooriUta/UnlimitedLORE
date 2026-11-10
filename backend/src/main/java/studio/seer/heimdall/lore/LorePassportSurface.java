package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * {@code surfaces.passport} в /lore/model: порядок разделов паспорта и что по умолчанию
 * под «Ещё». Это умолчание модели (D-2026-LORE-MODEL-COLUMN-LAYERS: модель → командный вид →
 * личная настройка), а не отрисовка: kit сам решает, вкладки это на десктопе или свёртка
 * на телефоне. Поэтому ключ — {@code sections}, элемент — только
 * {key, source, ref, order, slot}.
 *
 * <p>{@code decided}: true — порядок задан словом владелицы; false — порядок по данным
 * (тело → части → вкладки связей в порядке реестра), сервер ничего не решал и ничего не прячет.
 */
final class LorePassportSurface {

    private LorePassportSurface() {}

    /** Раздел тела — одна статья на все поля тела (у ADR три поля читаются подряд). */
    static final String CONTENT = "content";

    private static final String OWN = "own", GLUE = "content", MORE = "more";

    /** Раздел решённого паспорта: ключ и место. */
    private record Slot(String key, String slot) {}

    private static Slot s(String key, String slot) { return new Slot(key, slot); }

    /**
     * Явный порядок и место разделов. own — свой раздел (первый ряд, ≤ 5), content — блоком в
     * конце тела (v1: «блокирует и зависит был как подраздел контента»), more — под «Ещё».
     * Раздел, не названный здесь (появился в реестре позже), — в конец под «Ещё».
     * Map.ofEntries, а не Map.of: типов больше десяти.
     */
    private static final Map<String, List<Slot>> DECIDED = Map.ofEntries(
        // 09.11: «Спринт первое как ни странно задачи потом уже контент … зависимости и прочее под море».
        // Фазы под «Ещё» по замеру 09.11: phase_uid у задач 4 спринтов из 29.
        Map.entry("sprint", List.of(s("tasks", OWN), s(CONTENT, OWN), s("dependsOn", GLUE), s("blocks", GLUE),
            s("phases", MORE))),
        // S4-29 (10.11): у задачи главное — заметка; PR/ADR/сценарий/блокирующий вопрос — 0–1 штука,
        // PR к тому же есть в «Свойствах», поэтому они блоком в конце заметки, а не вкладками.
        Map.entry("task", List.of(s(CONTENT, OWN), s("questions", OWN),
            s("gates", GLUE), s("prs", GLUE), s("adrs", GLUE), s("useCases", GLUE),
            s("qgRecs", MORE), s("insights", MORE), s("refsOut", MORE), s("refsIn", MORE), s("publications", MORE))),
        // ADR: решения — своей вкладкой (их бывает десятки), связи ADR↔ADR — в конце текста.
        Map.entry("adr", List.of(s(CONTENT, OWN), s("decisions", OWN), s("questions", OWN), s("sprints", OWN),
            s("dependsOn", GLUE), s("blocks", GLUE), s("supersedes", GLUE), s("supersededBy", GLUE),
            s("justifies", MORE), s("releases", MORE), s("useCases", MORE), s("runbooks", MORE),
            s("insights", MORE), s("refsOut", MORE), s("refsIn", MORE))),
        Map.entry("spec", List.of(s(CONTENT, OWN), s("refsIn", GLUE), s("refsOut", GLUE))),
        // Типы только на чтение: из разделов паспорта у них лишь тело; связи — в «Свойствах»/шапке.
        Map.entry("decision", List.of(s(CONTENT, OWN))),
        Map.entry("question", List.of(s(CONTENT, OWN))),
        Map.entry("milestone", List.of(s(CONTENT, OWN))),
        Map.entry("release", List.of(s(CONTENT, OWN))),
        Map.entry("component", List.of()),
        Map.entry("tech", List.of(s(CONTENT, OWN))),
        Map.entry("feature", List.of(s(CONTENT, OWN))));

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
            List<Slot> decidedSlots = DECIDED.get(type);
            boolean decided = decidedSlots != null;
            List<String> order = new ArrayList<>();
            Map<String, String> slots = new LinkedHashMap<>();
            if (decided) for (Slot sl : decidedSlots) { order.add(sl.key()); slots.put(sl.key(), sl.slot()); }
            List<Section> ordered = new ArrayList<>();
            if (decided) {
                for (String k : order)
                    data.stream().filter(s -> s.key().equals(k)).findFirst().ifPresent(ordered::add);
                // Раздел, появившийся в реестре после решения, не теряется — в конец, slot more.
                for (Section s : data) if (!order.contains(s.key())) ordered.add(s);
            } else {
                ordered.addAll(data);
            }
            List<Map<String, Object>> sections = new ArrayList<>();
            int i = 1;
            for (Section s : ordered) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("key", s.key());
                m.put("source", s.source());
                m.put("ref", s.ref());
                m.put("order", i++);
                m.put("slot", decided ? slots.getOrDefault(s.key(), "more") : "own");
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
