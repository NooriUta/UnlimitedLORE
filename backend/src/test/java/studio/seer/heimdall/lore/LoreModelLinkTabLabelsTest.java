package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-10, п.1 (решение владельца 25.11.2026: «1а», переводы — три и более языка).
 *
 * <p>Диагностика модели (scripts/model-inconsistencies.mjs) нашла 42 вкладки связей без labelKey:
 * у полей ключ локализации и переводы были, у вкладок — только русская подпись. Админка «Модель»
 * на этом ругалась, а телефон и веб не могли перевести вкладку.
 *
 * <p>Сторож: у каждой вкладки связей в каноне — labelKey вида pp.tab.*, labelEn и labelPl; все три
 * доходят до контракта паспорта (link_tabs). Чистый JUnit — без подъёма приложения.
 */
class LoreModelLinkTabLabelsTest {

    static LoreModelFile.Content canon() throws Exception {
        return LoreModelFile.parse(Files.readString(LoreModelFileTest.CANON, StandardCharsets.UTF_8).replace("\r\n", "\n"));
    }

    @Test
    void everyLinkTabCarriesKeyAndThreeLanguages() throws Exception {
        LoreModelFile.Content c = canon();
        List<String> bad = new ArrayList<>();
        int tabs = 0;
        for (LoreRecordRegistry.TypeDef d : c.typeDefs().values())
            for (LoreRecordRegistry.LinkTab t : d.linkTabs()) {
                tabs++;
                String at = d.type() + "." + t.key();
                if (t.labelKey() == null || !t.labelKey().startsWith("pp.tab.")) bad.add(at + ": labelKey «" + t.labelKey() + "»");
                if (t.label() == null || t.label().isBlank()) bad.add(at + ": нет русской подписи");
                if (t.labelEn() == null || t.labelEn().isBlank()) bad.add(at + ": нет labelEn");
                if (t.labelPl() == null || t.labelPl().isBlank()) bad.add(at + ": нет labelPl");
            }
        assertTrue(tabs >= 42, "положительный контроль: вкладок связей в каноне не меньше найденных диагностикой (42), есть " + tabs);
        assertEquals(List.of(), bad, "вкладки связей без ключа локализации или перевода");
    }

    @Test
    void sameKeyMeansSameTexts() throws Exception {
        // Один ключ — одна подпись: иначе перевод по ключу покажет не то, что написано в модели.
        Map<String, String> seen = new java.util.HashMap<>();
        List<String> bad = new ArrayList<>();
        for (LoreRecordRegistry.TypeDef d : canon().typeDefs().values())
            for (LoreRecordRegistry.LinkTab t : d.linkTabs()) {
                if (t.labelKey() == null) continue;
                String texts = t.label() + " | " + t.labelEn() + " | " + t.labelPl();
                String was = seen.putIfAbsent(t.labelKey(), texts);
                if (was != null && !was.equals(texts)) bad.add(t.labelKey() + ": «" + was + "» ≠ «" + texts + "» (" + d.type() + "." + t.key() + ")");
            }
        assertEquals(List.of(), bad);
    }

    @Test
    void linkTabWithoutKeyIsCaughtNotSilentlyAccepted() throws Exception {
        // Обратная проверка: снятый у вкладки labelKey сторож видит.
        String s = Files.readString(LoreModelFileTest.CANON, StandardCharsets.UTF_8).replace("\r\n", "\n");
        String anchor = "\"labelKey\" : \"pp.tab.refs\",";
        assertTrue(s.contains(anchor), "положительный контроль: якорь есть в каноне");
        LoreModelFile.Content c = LoreModelFile.parse(s.replaceFirst(java.util.regex.Pattern.quote(anchor) + "\\n\\s*", ""));
        long without = c.typeDefs().values().stream().flatMap(d -> d.linkTabs().stream()).filter(t -> t.labelKey() == null).count();
        assertEquals(1, without, "одна вкладка без ключа — сторож её видит");
    }

    @Test
    @SuppressWarnings("unchecked")
    void contractCarriesKeyAndTranslations() throws Exception {
        LoreModelFile.Content c = canon();
        LoreRecordRegistry.TypeDef task = c.typeDefs().get("task");
        Map<String, Object> json = LoreRecordRegistry.layoutJson(task);
        List<Map<String, Object>> tabs = (List<Map<String, Object>>) json.get("link_tabs");
        Map<String, Object> deps = tabs.stream().filter(t -> "deps".equals(t.get("key"))).findFirst().orElseThrow();
        assertEquals("pp.tab.deps", deps.get("label_key"));
        assertEquals("Dependencies", deps.get("label_en"));
        assertEquals("Zależności", deps.get("label_pl"));
    }
}
