package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * ADR-LORE-048 (черновик), первый срез модели: статусные статьи с category и allow
 * (D-2026-LORE-MODEL-STATUS-ENTRIES), справочники внутри документа, версия внутри
 * документа, честная неполнота. Чистая функция — без БД и сети.
 */
class LoreModelTest {

    private static Map<String, Object> dict(String type, String code, String ru, String icon, String color, int order) {
        Map<String, Object> m = new HashMap<>();
        m.put("dict_type", type);
        m.put("code", code);
        m.put("label_ru", ru);
        m.put("label_en", null);
        m.put("icon", icon);
        m.put("color", color);
        m.put("sort_order", order);
        m.put("is_active", true);
        return m;
    }

    private static List<Map<String, Object>> taskDict() {
        List<Map<String, Object>> rows = new ArrayList<>();
        String[] codes = {"todo", "backlog", "planned", "design", "active", "partial",
            "ready_for_deploy", "done", "blocked", "cancelled"};
        for (int i = 0; i < codes.length; i++)
            rows.add(dict("task_status", codes[i], "T " + codes[i], "icon-" + codes[i], "var(--t3)", (i + 1) * 10));
        return rows;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> entries(Map<String, Object> model, String type) {
        Map<String, Object> st = (Map<String, Object>) ((Map<String, Object>) model.get("statuses")).get(type);
        return (List<Map<String, Object>>) st.get("entries");
    }

    private static Map<String, Object> entry(Map<String, Object> model, String type, String code) {
        return entries(model, type).stream().filter(e -> code.equals(e.get("code"))).findFirst().orElseThrow();
    }

    @Test
    void taskStatusEntryCarriesDictionaryCategoryAndAllow() {
        Map<String, Object> m = LoreModel.build(taskDict());
        Map<String, Object> done = entry(m, "task", "done");
        assertEquals("T done", done.get("title"));
        assertEquals("icon-done", done.get("icon"));
        assertEquals("finished", done.get("category"));
        @SuppressWarnings("unchecked") List<String> allow = (List<String>) done.get("allow");
        assertFalse(allow.contains("done"), "переход в самого себя не разрешён");
        assertTrue(allow.contains("active") && allow.contains("cancelled"));
        assertEquals("withdrawn", entry(m, "task", "cancelled").get("category"));
        assertEquals("in_progress", entry(m, "task", "blocked").get("category"));
    }

    @Test
    void lifecycleStatusMissingInDictionaryIsHonest() {
        List<Map<String, Object>> rows = taskDict();
        rows.removeIf(r -> "blocked".equals(r.get("code")));
        Map<String, Object> m = LoreModel.build(rows);
        Map<String, Object> blocked = entry(m, "task", "blocked");
        assertEquals(false, blocked.get("in_dictionary"));
        assertEquals("blocked", blocked.get("title"), "без справочника подпись — сам код, а не пусто");
        assertTrue(String.valueOf(m.get("warnings")).contains("blocked"));
    }

    /**
     * kit 09.11 (S4-STATUS-AXIS-CONFIG): иконка и цвет статуса — предметное знание сервера.
     * Статья цикла без иконки или цвета в справочнике не молчит: модель называет её в warnings,
     * иначе клиент держит свою таблицу «код → иконка» и у иконок два источника.
     */
    @Test
    void lifecycleStatusWithoutIconOrColorIsNamed() {
        List<Map<String, Object>> rows = taskDict();
        rows.get(7).put("icon", null);   // done
        rows.get(8).put("color", "");  // blocked
        Map<String, Object> m = LoreModel.build(rows);
        String w = String.valueOf(m.get("warnings"));
        assertTrue(w.contains("task_status: статус «done» без иконки"), w);
        assertTrue(w.contains("task_status: статус «blocked» без цвета"), w);
        assertFalse(w.contains("«planned» без"), "заполненный статус не назван: " + w);
    }

    /**
     * kit 10.11 (K-14): палитра — прикладной словарь, kit не должен держать её у себя. Раздел
     * {@code palettes} несёт коды из того же белого списка, что принимает настройка
     * {@code palette} (один источник), умолчание и подписи из справочника {@code palette}.
     * Код без статьи в справочнике не прячется: {@code in_dictionary:false}, подпись = код,
     * и он назван в warnings — «не описано» отличается от «не прислали».
     */
    @Test
    @SuppressWarnings("unchecked")
    void palettesComeFromSettingsWhitelistWithDictionaryLabels() {
        List<Map<String, Object>> rows = new ArrayList<>(taskDict());
        rows.add(dict("palette", "lichen", "Лишайник", null, null, 20));
        Map<String, Object> m = LoreModel.build(rows);

        Map<String, Object> p = (Map<String, Object>) m.get("palettes");
        assertEquals("amber-forest", p.get("default"));
        List<Map<String, Object>> entries = (List<Map<String, Object>>) p.get("entries");
        assertEquals(List.of("amber-forest", "lichen", "slate", "juniper", "warm-dark", "mono"),
            entries.stream().map(e -> e.get("code")).toList(), "ровно коды настройки palette, в её порядке");

        Map<String, Object> lichen = entries.get(1);
        assertEquals("Лишайник", lichen.get("title"));
        assertEquals(true, lichen.get("in_dictionary"));
        Map<String, Object> slate = entries.get(2);
        assertEquals("slate", slate.get("title"), "нет статьи — подпись = код, не выдумана");
        assertEquals(false, slate.get("in_dictionary"));

        String w = String.valueOf(m.get("warnings"));
        assertTrue(w.contains("palette: палитра «slate» без статьи в справочнике"), w);
        assertFalse(w.contains("«lichen» без статьи"), w);
        assertFalse(String.valueOf(m.get("missing")).contains("palettes"), "раздел прислан — в missing его нет");
    }

    @Test
    void adrDictionaryCaseMismatchIsMatchedAndReported() {
        List<Map<String, Object>> rows = new ArrayList<>(taskDict());
        rows.add(dict("adr_status", "ACCEPTED", "Принят", "laurel-crown", "var(--suc)", 20));
        rows.add(dict("adr_status", "DEPRECATED", "Устарел", null, "var(--wrn)", 30));
        Map<String, Object> m = LoreModel.build(rows);
        Map<String, Object> accepted = entry(m, "adr", "accepted");
        assertEquals("Принят", accepted.get("title"));
        assertEquals("in_force", accepted.get("category"));
        Map<String, Object> deprecated = entry(m, "adr", "DEPRECATED");
        assertEquals(false, deprecated.get("in_lifecycle"));
        String w = String.valueOf(m.get("warnings"));
        assertTrue(w.contains("ACCEPTED"), "расхождение регистра видно: " + w);
        assertTrue(w.contains("DEPRECATED"), "статус справочника вне цикла виден: " + w);
    }

    @Test
    void typeWithoutLifecycleHasUnknownAllowNotEmpty() {
        List<Map<String, Object>> rows = new ArrayList<>(taskDict());
        rows.add(dict("decision_status", "accepted", "Принято", "laurel-crown", "var(--suc)", 20));
        Map<String, Object> m = LoreModel.build(rows);
        assertNull(entry(m, "decision", "accepted").get("allow"),
            "переходы решения не заданы — null (неизвестно), а не [] (запрещено всё)");
    }

    @Test
    void versionIsInsideDocumentAndDeterministic() {
        Map<String, Object> a = LoreModel.build(taskDict());
        Map<String, Object> b = LoreModel.build(taskDict());
        assertTrue(String.valueOf(a.get("version")).length() >= 12);
        assertEquals(a.get("version"), b.get("version"));
        List<Map<String, Object>> changed = taskDict();
        changed.get(0).put("label_ru", "другое");
        assertNotEquals(a.get("version"), LoreModel.build(changed).get("version"));
    }

    @Test
    void dictionariesTravelInsideButSettingsDoNot() {
        List<Map<String, Object>> rows = new ArrayList<>(taskDict());
        rows.add(dict("work_class", "uc", "Use Case", null, "#5AB4E8", 10));
        rows.add(dict("app_setting", "md_images_enabled", "true", null, null, 10));
        rows.add(dict("palette", "lichen", "Лишайник", null, null, 20));
        Map<String, Object> m = LoreModel.build(rows);
        @SuppressWarnings("unchecked") Map<String, Object> d = (Map<String, Object>) m.get("dictionaries");
        assertTrue(d.containsKey("work_class"));
        assertFalse(d.containsKey("app_setting"), "настройки приложения — не перечень значений");
        assertFalse(d.containsKey("palette"), "palette живёт в блоке palettes, не в dictionaries");
    }

    // «У типа нет статусов» ≠ «тип ещё не описан» (замечание kit-сессии 08.11).
    @Test
    void describedStatusTypesAreListedAndTheRestIsMarkedMissing() {
        Map<String, Object> m = LoreModel.build(taskDict());
        assertEquals(List.of("task", "sprint", "adr", "spec", "decision"), m.get("statuses_known"));
        assertTrue(String.valueOf(m.get("missing")).contains("statuses:*"),
            "пока описаны не все типы, раздел statuses помечен неполным");
    }

    // Порядок — часть контракта: по нему строится меню выбора.
    @Test
    void orderIsPartOfTheContract() {
        List<Map<String, Object>> rows = new ArrayList<>(taskDict());
        rows.add(dict("work_class", "jtd", "JTD", null, "#C0A36E", 20));
        rows.add(dict("work_class", "uc", "UC", null, "#5AB4E8", 10));
        rows.add(dict("area", "api", "API", null, null, 20));
        Map<String, Object> m = LoreModel.build(rows);
        @SuppressWarnings("unchecked") Map<String, Object> d = (Map<String, Object>) m.get("dictionaries");
        assertEquals(List.of("area", "task_status", "work_class"), List.copyOf(d.keySet()), "справочники по алфавиту");
        @SuppressWarnings("unchecked") List<Map<String, Object>> wc = (List<Map<String, Object>>) d.get("work_class");
        assertEquals(List.of("uc", "jtd"), wc.stream().map(x -> x.get("code")).toList(), "статьи по order");
        assertEquals("todo", entries(m, "task").get(0).get("code"), "статусы — в порядке жизненного цикла");
    }

    @Test
    void partialModelSaysWhatIsMissingAndLeaksNoSystemFields() {
        Map<String, Object> m = LoreModel.build(taskDict());
        assertEquals(true, m.get("partial"));
        assertTrue(String.valueOf(m.get("missing")).contains("types"));
        assertFalse(String.valueOf(m.get("format")).toLowerCase().contains("lore"),
            "формат модели универсален — без имени LORE (D-2026-LORE-MODEL-PLUGGABLE-SOURCE)");
        assertNoAtKeys(m);
    }

    @SuppressWarnings("unchecked")
    private static void assertNoAtKeys(Object o) {
        if (o instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> e : map.entrySet()) {
                assertFalse(String.valueOf(e.getKey()).startsWith("@"), "системное поле в модели: " + e.getKey());
                assertNoAtKeys(e.getValue());
            }
        } else if (o instanceof List<?> list) {
            for (Object x : list) assertNoAtKeys(x);
        }
    }
}
