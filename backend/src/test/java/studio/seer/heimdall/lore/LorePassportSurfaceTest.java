package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * surfaces.passport — порядок разделов паспорта и что по умолчанию под «Ещё».
 * Владелица 09.11: «Спринт первое как ни странно задачи потом уже контент … а зависимости
 * и прочее можно скрыть под море». Форма согласована с kit (D-2026-LORE-MODEL-TYPES-VS-SURFACES,
 * -COLUMN-LAYERS): данные-умолчание, не отрисовка; ключ не «tabs» — его не пускает assertDataOnly.
 */
class LorePassportSurfaceTest {

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> sections(String type) {
        Map<String, Object> t = (Map<String, Object>) LorePassportSurface.build().get(type);
        assertNotNull(t, "у типа " + type + " есть раздел surfaces.passport");
        return (List<Map<String, Object>>) t.get("sections");
    }

    private static List<String> keys(List<Map<String, Object>> s) {
        List<String> out = new ArrayList<>();
        for (Map<String, Object> m : s) out.add((String) m.get("key"));
        return out;
    }

    @Test
    void sprintFollowsOwnerOrder() {
        Map<?, ?> sprint = (Map<?, ?>) LorePassportSurface.build().get("sprint");
        assertEquals(true, sprint.get("decided"));
        List<Map<String, Object>> s = sections("sprint");
        assertEquals(List.of("tasks", "content", "phases", "dependsOn", "blocks"), keys(s));
        for (Map<String, Object> m : s) {
            boolean shown = Set.of("tasks", "content").contains(m.get("key"));
            assertEquals(shown, m.get("default_visible"), "видно сразу только задачи и контент: " + m.get("key"));
        }
        assertEquals("part", s.get(0).get("source"));
        assertEquals("body", s.get(1).get("source"));
        assertNull(s.get(1).get("ref"), "тело — одна статья, ref null");
        assertEquals("relation", s.get(3).get("source"));
    }

    @Test
    void otherTypesAreHonestlyUndecided() {
        for (String type : LoreRecordRegistry.TYPES) {
            if (type.equals("sprint")) continue;
            Map<?, ?> t = (Map<?, ?>) LorePassportSurface.build().get(type);
            assertEquals(false, t.get("decided"), type + ": без слова владелицы порядок по данным");
            for (Map<String, Object> m : sections(type))
                assertEquals(true, m.get("default_visible"), type + "/" + m.get("key") + ": без решения ничего не прячем");
        }
    }

    @Test
    void sectionsAreDataOnlyAndOrdered() {
        for (String type : LoreRecordRegistry.TYPES) {
            List<Map<String, Object>> s = sections(type);
            for (int i = 0; i < s.size(); i++) {
                assertEquals(Set.of("key", "source", "ref", "order", "default_visible"), s.get(i).keySet(),
                    type + ": элемент раздела — только данные, без лишних ключей");
                assertEquals(i + 1, s.get(i).get("order"));
            }
        }
    }

    @Test
    void everyPartBodyAndLinkTabIsPlacedExactlyOnce() {
        for (String type : LoreRecordRegistry.TYPES) {
            LoreRecordRegistry.TypeDef d = LoreRecordRegistry.get(type);
            List<String> expected = new ArrayList<>();
            if (!d.body().isEmpty()) expected.add("content");
            for (LoreRecordRegistry.Part p : d.parts()) expected.add(p.key());
            for (LoreRecordRegistry.Relation r : d.relations()) if ("link_tab".equals(r.place())) expected.add(r.key());
            List<String> got = keys(sections(type));
            assertEquals(Set.copyOf(expected), Set.copyOf(got), type + ": ни один раздел не потерян и не выдуман");
            assertEquals(got.size(), Set.copyOf(got).size(), type + ": без повторов");
        }
    }
}
