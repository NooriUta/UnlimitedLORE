package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * surfaces.passport v3 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-29, D-2026-UXR-OWNER-DELEGATED-ANSWERS-10-11).
 *
 * <p>Что изменилось против v2:
 * <ul>
 *   <li>«Ещё» больше НЕ место модели. Сервер отдаёт порядок ({@code order}) и место
 *       {@code own | content}: content — блоком в конце текста. Сколько вкладок влезает
 *       (не больше 7), а что уходит в «Ещё», решает kit по ширине: порядок по смыслу
 *       одинаков на любой ширине, ширина решает только, где начинается «Ещё».</li>
 *   <li>Группы: у раздела поле {@code group {key, label}} (или null). Разделы одной группы
 *       идут подряд и рисуются одной вкладкой с подзаголовками. Группа — это linkTab реестра,
 *       второй правды нет.</li>
 *   <li>Порядок у всех 11 типов — итоговая таблица анализа passport-tabs-kaos с поправками
 *       решения: сначала текст (у контейнера — дети), затем «решение ↔ работа», затем свои
 *       связи группой, затем контекст.</li>
 * </ul>
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

    private static List<String> keysIn(List<Map<String, Object>> s, String slot) {
        List<String> out = new ArrayList<>();
        for (Map<String, Object> m : s) if (slot.equals(m.get("slot"))) out.add((String) m.get("key"));
        return out;
    }

    @SuppressWarnings("unchecked")
    private static String groupKey(Map<String, Object> m) {
        Object g = m.get("group");
        return g == null ? null : (String) ((Map<String, Object>) g).get("key");
    }

    /**
     * Вкладки, как их нарисует kit: подряд идущие разделы одной группы — одна вкладка
     * «Подпись[ключ1+ключ2]», раздел без группы — его ключ. Разделы в конце текста — не вкладки.
     */
    @SuppressWarnings("unchecked")
    private static List<String> tabs(String type) {
        List<String> out = new ArrayList<>();
        String openGroup = null;
        for (Map<String, Object> m : sections(type)) {
            if (!"own".equals(m.get("slot"))) { openGroup = null; continue; }
            String g = groupKey(m);
            if (g == null) { out.add((String) m.get("key")); openGroup = null; continue; }
            String label = (String) ((Map<String, Object>) m.get("group")).get("label");
            if (g.equals(openGroup)) {
                String last = out.remove(out.size() - 1);
                out.add(last.substring(0, last.length() - 1) + "+" + m.get("key") + "]");
            } else {
                out.add(label + "[" + m.get("key") + "]");
                openGroup = g;
            }
        }
        return out;
    }

    // ── Форма ───────────────────────────────────────────────────────────────

    @Test
    void sectionIsSixKeysSlotOwnOrContentAndNoMore() {
        for (String type : LoreRecordRegistry.TYPES) {
            List<Map<String, Object>> s = sections(type);
            int bodyOrder = -1;
            for (int i = 0; i < s.size(); i++) {
                Map<String, Object> m = s.get(i);
                assertEquals(Set.of("key", "source", "ref", "order", "slot", "group"), m.keySet(),
                    type + ": элемент раздела — ровно шесть ключей (пятёрка v2 + group)");
                assertEquals(i + 1, m.get("order"), type + ": order — сквозной номер с 1");
                assertTrue(Set.of("own", "content").contains(m.get("slot")),
                    type + "/" + m.get("key") + ": slot только own | content — «Ещё» решает kit по ширине, а не модель");
                if ("body".equals(m.get("source"))) {
                    bodyOrder = i + 1;
                    assertEquals("own", m.get("slot"), type + ": само тело не вклеивается в себя");
                }
                if ("content".equals(m.get("slot")))
                    assertTrue(bodyOrder > 0, type + "/" + m.get("key") + ": в конец текста — только после тела, и тело у типа есть");
                Object g = m.get("group");
                if (g != null) {
                    @SuppressWarnings("unchecked") Map<String, Object> gm = (Map<String, Object>) g;
                    assertEquals(Set.of("key", "label"), gm.keySet(), type + ": group — {key, label}");
                    assertEquals("own", m.get("slot"), type + "/" + m.get("key") + ": группа — это вкладка, в конце текста групп нет");
                }
            }
        }
    }

    @Test
    void everyTypeIsDecided() {
        for (String type : LoreRecordRegistry.TYPES) {
            Map<?, ?> t = (Map<?, ?>) LorePassportSurface.build().get(type);
            assertEquals(true, t.get("decided"), type + ": порядок паспорта решён, а не «по данным»");
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

    @Test
    void everyRefExistsInModelRelations() {
        for (String type : LoreRecordRegistry.TYPES) {
            LoreRecordRegistry.TypeDef d = LoreRecordRegistry.get(type);
            Set<String> parts = new HashSet<>();
            for (LoreRecordRegistry.Part p : d.parts()) parts.add(p.key());
            Set<String> rels = new HashSet<>();
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

    // ── Группы ──────────────────────────────────────────────────────────────

    @Test
    void groupMembersAreContiguous() {
        for (String type : LoreRecordRegistry.TYPES) {
            Set<String> closed = new HashSet<>();
            String open = null;
            for (Map<String, Object> m : sections(type)) {
                String g = groupKey(m);
                if (g != null && !g.equals(open)) {
                    assertFalse(closed.contains(g), type + ": группа " + g + " разорвана — её разделы обязаны идти подряд");
                    if (open != null) closed.add(open);
                    open = g;
                } else if (g == null && open != null) {
                    closed.add(open);
                    open = null;
                }
            }
        }
    }

    /** Группа — это linkTab реестра: те же ключ и подпись, члены — ровно его рёбра. */
    @Test
    void groupsAreRegistryLinkTabs() {
        for (String type : LoreRecordRegistry.TYPES) {
            LoreRecordRegistry.TypeDef d = LoreRecordRegistry.get(type);
            Map<String, LoreRecordRegistry.Relation> byKey = new LinkedHashMap<>();
            for (LoreRecordRegistry.Relation r : d.relations()) byKey.put(r.key(), r);
            for (Map<String, Object> m : sections(type)) {
                String g = groupKey(m);
                if (g == null) continue;
                LoreRecordRegistry.LinkTab tab = d.linkTabs().stream().filter(t -> t.key().equals(g)).findFirst()
                    .orElseThrow(() -> new AssertionError(type + ": группа " + g + " не linkTab реестра"));
                @SuppressWarnings("unchecked") Map<String, Object> gm = (Map<String, Object>) m.get("group");
                assertEquals(tab.label(), gm.get("label"), type + "/" + g + ": подпись группы — подпись linkTab");
                LoreRecordRegistry.Relation r = byKey.get((String) m.get("ref"));
                assertTrue(tab.rels().stream().anyMatch(tr -> tr.rel().equals(r.rel()) && tr.dir().equals(r.dir())),
                    type + "/" + m.get("key") + ": ребро раздела есть в linkTab " + g);
            }
            // И обратно: каждое ребро linkTab — раздел-вкладка этой группы (группа без членов — выдумка).
            for (LoreRecordRegistry.LinkTab tab : d.linkTabs())
                for (LoreRecordRegistry.TabRel tr : tab.rels()) {
                    boolean placed = sections(type).stream().anyMatch(m -> tab.key().equals(groupKey(m))
                        && byKey.get((String) m.get("ref")).rel().equals(tr.rel())
                        && byKey.get((String) m.get("ref")).dir().equals(tr.dir()));
                    assertTrue(placed, type + ": ребро " + tr.rel() + ":" + tr.dir() + " linkTab " + tab.key() + " не стало разделом группы");
                }
        }
    }

    // ── Порядок по типам: итоговая таблица анализа + поправки решения ─────────

    @Test
    void adr() {
        assertEquals(List.of("content", "justifies", "sprints", "questions",
            "Связи ADR[dependsOn+blocks+supersedes+supersededBy]", "releases", "useCases",
            "Ссылки[refsOut+refsIn+runbooks]", "insights"), tabs("adr"),
            "ADR: Текст · Задачи · Спринты · Вопросы · Связи ADR · Релизы · Сценарии · Ссылки (с ранбуками) · Инсайты");
        assertEquals(List.of("decisions"), keysIn(sections("adr"), "content"),
            "решения ADR — в конце текста (41а), якорь «Решения N ↓» рисует kit по счётчику части");
    }

    @Test
    void task() {
        assertEquals(List.of("content", "ADR[adrs+qgRecs+insights]", "Реализация[prs+useCases]", "questions",
            "Ссылки[refsOut+refsIn]", "publications"), tabs("task"),
            "задача: Заметка · ADR (с QG и инсайтами) · Реализация (PR + сценарии, 42а) · Вопросы · Ссылки · Публикации");
        assertEquals(List.of("gates"), keysIn(sections("task"), "content"),
            "блокирующие вопросы — 42 ребра на 4896 задач — в конце заметки");
    }

    @Test
    void sprint() {
        assertEquals(List.of("tasks", "content", "adrs", "Связи[dependsOn+blocks]", "questions", "phases"), tabs("sprint"),
            "спринт: Задачи · Контент · ADR · Связи · Вопросы · Фазы (43а)");
        assertEquals(List.of(), keysIn(sections("sprint"), "content"), "зависимости спринта переехали во вкладку «Связи»");
    }

    @Test
    void spec() {
        assertEquals(List.of("content", "Ссылки[refsOut+refsIn]"), tabs("spec"));
    }

    @Test
    void decision() {
        assertEquals(List.of("content", "answers", "supersedes"), tabs("decision"),
            "решение: Текст · Вопросы · Замены (44а); родительский ADR — в шапке");
    }

    @Test
    void question() {
        assertEquals(List.of("content", "answeredBy", "gates"), tabs("question"),
            "вопрос: Текст · Ответ · Блокирует задачи (44а)");
    }

    @Test
    void milestone() {
        assertEquals(List.of("sprints", "content"), tabs("milestone"),
            "веха — контейнер: спринты первыми (45а); решения вехи — поле тела, читаются в конце текста");
    }

    @Test
    void release() {
        assertEquals(List.of("content", "sprints", "prs"), tabs("release"), "релиз: Описание · Спринты · PR (44а)");
    }

    @Test
    void component() {
        assertEquals(List.of("specs", "adrs", "tech", "children"), tabs("component"),
            "компонент: Спеки · ADR · Технологии · Подкомпоненты (46а/52а; Задачи и Спринты ждут среза)");
    }

    @Test
    void tech() {
        assertEquals(List.of("content"), tabs("tech"));
    }

    @Test
    void feature() {
        assertEquals(List.of("content", "children", "tasks", "Ценность[actors+pains+gains+jobs]"), tabs("feature"),
            "фича: Текст · Сценарии · Задачи · Ценность");
    }
}
