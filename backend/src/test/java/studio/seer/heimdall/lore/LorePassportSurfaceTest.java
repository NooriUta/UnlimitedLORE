package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * surfaces.passport — порядок разделов паспорта и место каждого: own (свой раздел, виден сразу),
 * content (блоком в конце тела, как в v1 зависимости спринта и решения ADR), more (под «Ещё»).
 * Владелица 09.11: «Спринт первое как ни странно задачи потом уже контент … зависимости и прочее
 * под море»; «раньше блокирует и зависит был как подраздел контента». Форма согласована с kit:
 * ключ slot, а не place (place уже занят в relations[] другими значениями), не tabs (сторож kit).
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

    private static Object slotOf(List<Map<String, Object>> s, String key) {
        return s.stream().filter(m -> key.equals(m.get("key"))).findFirst().orElseThrow().get("slot");
    }

    @Test
    void sprintFollowsOwnerWords() {
        Map<?, ?> sprint = (Map<?, ?>) LorePassportSurface.build().get("sprint");
        assertEquals(true, sprint.get("decided"));
        List<Map<String, Object>> s = sections("sprint");
        assertEquals(List.of("tasks", "content", "dependsOn", "blocks", "phases"), keys(s));
        assertEquals("own", slotOf(s, "tasks"));
        assertEquals("own", slotOf(s, "content"));
        assertEquals("content", slotOf(s, "dependsOn"), "зависимости — подраздел контента, как в v1");
        assertEquals("content", slotOf(s, "blocks"));
        assertEquals("more", slotOf(s, "phases"), "фазы у 4 спринтов из 29 — под «Ещё»");
        assertEquals("body", s.get(1).get("source"));
        assertNull(s.get(1).get("ref"), "тело — одна статья, ref null");
    }

    @Test
    void undecidedTypesHideNothing() {
        for (String type : LoreRecordRegistry.TYPES) {
            Map<?, ?> t = (Map<?, ?>) LorePassportSurface.build().get(type);
            if (Boolean.TRUE.equals(t.get("decided"))) continue;
            for (Map<String, Object> m : sections(type))
                assertEquals("own", m.get("slot"), type + "/" + m.get("key") + ": без решения ничего не прячем и не вклеиваем");
        }
    }

    @Test
    void sectionsAreDataOnlyOrderedAndSlotted() {
        for (String type : LoreRecordRegistry.TYPES) {
            List<Map<String, Object>> s = sections(type);
            int bodyOrder = -1;
            for (int i = 0; i < s.size(); i++) {
                Map<String, Object> m = s.get(i);
                assertEquals(Set.of("key", "source", "ref", "order", "slot"), m.keySet(),
                    type + ": элемент раздела — только данные, ровно пять ключей");
                assertEquals(i + 1, m.get("order"));
                assertTrue(Set.of("own", "content", "more").contains(m.get("slot")), type + ": slot из закрытого набора");
                if ("body".equals(m.get("source"))) {
                    bodyOrder = i + 1;
                    assertEquals("own", m.get("slot"), type + ": само тело не вклеивается в себя");
                }
                if ("content".equals(m.get("slot"))) {
                    assertTrue(bodyOrder > 0, type + "/" + m.get("key") + ": вклеенное в контент идёт ПОСЛЕ тела, и тело у типа есть");
                }
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

    // ── S4-29: паспорта решены у ВСЕХ типов (владелица 10.11: «проанализировать и создать
    // паспорта у всех»; жалоба «перегружено» — все вкладки в первом ряду). ──

    private static List<String> keysIn(List<Map<String, Object>> s, String slot) {
        List<String> out = new ArrayList<>();
        for (Map<String, Object> m : s) if (slot.equals(m.get("slot"))) out.add((String) m.get("key"));
        return out;
    }

    @Test
    void everyTypeIsDecided() {
        for (String type : LoreRecordRegistry.TYPES) {
            Map<?, ?> t = (Map<?, ?>) LorePassportSurface.build().get(type);
            assertEquals(true, t.get("decided"), type + ": порядок паспорта решён, а не «по данным»");
        }
    }

    @Test
    void firstRowHasAtMostFiveSections() {
        for (String type : LoreRecordRegistry.TYPES) {
            List<String> own = keysIn(sections(type), "own");
            assertTrue(own.size() <= 5, type + ": в первом ряду не больше 5 вкладок, сейчас " + own);
        }
    }

    @Test
    void everyRefExistsInModelRelations() {
        for (String type : LoreRecordRegistry.TYPES) {
            LoreRecordRegistry.TypeDef d = LoreRecordRegistry.get(type);
            Set<String> parts = new java.util.HashSet<>();
            for (LoreRecordRegistry.Part p : d.parts()) parts.add(p.key());
            Set<String> rels = new java.util.HashSet<>();
            for (LoreRecordRegistry.Relation r : d.relations()) rels.add(r.key());
            for (Map<String, Object> m : sections(type)) {
                Object ref = m.get("ref");
                switch ((String) m.get("source")) {
                    case "body" -> assertNull(ref, type + ": у тела ref null");
                    case "part" -> assertTrue(parts.contains(ref), type + "/" + ref + ": часть есть в parts");
                    case "relation" -> assertTrue(rels.contains(ref), type + "/" + ref + ": связь есть в relations модели");
                    default -> fail(type + ": неизвестный source " + m.get("source"));
                }
            }
        }
    }

    @Test
    void taskAndAdrFollowAnalysis() {
        List<Map<String, Object>> task = sections("task");
        assertEquals(List.of("content", "questions"), keysIn(task, "own"));
        assertEquals(List.of("gates", "prs", "adrs", "useCases"), keysIn(task, "content"),
            "PR, обоснование и блокирующие вопросы — 0–1 штука, блоком в конце заметки");
        List<Map<String, Object>> adr = sections("adr");
        assertEquals(List.of("content", "decisions", "questions", "sprints"), keysIn(adr, "own"),
            "решения — своей вкладкой: у 74% ADR они есть, до 35 штук");
        assertEquals(List.of("dependsOn", "blocks", "supersedes", "supersededBy"), keysIn(adr, "content"),
            "связи ADR↔ADR — в конце текста, как зависимости спринта");
    }
}
