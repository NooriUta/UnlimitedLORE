package studio.seer.heimdall.lore;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_AS_CONFIG/MC-07 (D-2026-LORE-MODEL-AUDIENCE-VISIBILITY) — видимость по аудитории
 * в конфиге модели, как Data Model в Völva. Разметка — слова владелицы 13.11: «везде не страшно.
 * разделяй реальную админку от бизнес-анализа»; люди и агенты в проекте — «просмотр да изменение нет
 * только админка (оставить простой список)».
 *
 * <p>Общее меню строится из модели ({@code surfaces.nav}), а не из списка в коде: смена уровня в
 * конфиге меняет показ без правки кода.
 */
class LoreModelNavTest {

    @AfterEach
    void restore() throws Exception {
        LoreModelFile.replace(LoreModelFile.parse(LoreModelLiveReplaceTest.canon()));
    }

    @SuppressWarnings("unchecked")
    static List<String> navSections(Map<String, Object> doc) {
        Map<String, Object> surfaces = (Map<String, Object>) doc.get("surfaces");
        assertNotNull(surfaces.get("nav"), "в /lore/model есть surfaces.nav");
        List<String> out = new ArrayList<>();
        for (Map<String, Object> g : (List<Map<String, Object>>) surfaces.get("nav"))
            for (Map<String, Object> i : (List<Map<String, Object>>) g.get("items")) out.add(String.valueOf(i.get("section")));
        return out;
    }

    @Test
    @SuppressWarnings("unchecked")
    void approvedMarkupIsInTheModel() {
        Map<String, Object> doc = LoreModelGoldenTest.modelDoc();
        Map<String, String> audience = (Map<String, String>) doc.get("audience");
        assertNotNull(audience, "в /lore/model есть audience");
        for (String admin : List.of("people", "agent", "machine"))
            assertEquals("admin", audience.get(admin), admin + " — админка (решение 13.11)");
        for (String ba : List.of("product", "feature", "actor", "pain", "gain", "job"))
            assertEquals("everywhere", audience.get(ba), ba + " — бизнес-анализ, везде («везде не страшно»)");
        List<String> nav = navSections(doc);
        assertTrue(nav.containsAll(List.of("sprint", "task", "adr", "spec", "product", "actor", "project", "component")), nav.toString());
        assertFalse(nav.contains("people") || nav.contains("agent") || nav.contains("machine"), "админки нет в общем меню: " + nav);
    }

    @Test
    void changingAudienceInConfigChangesTheMenuWithoutCode() throws Exception {
        assertTrue(navSections(LoreModelGoldenTest.modelDoc()).contains("actor"), "положительный контроль");
        String edited = LoreModelLiveReplaceTest.canon().replaceFirst("\"actor\" : \"everywhere\"", "\"actor\" : \"detail\"");
        LoreModelFile.replace(LoreModelFile.parse(edited));
        assertFalse(navSections(LoreModelGoldenTest.modelDoc()).contains("actor"), "detail — не в общем меню");
    }

    @Test
    void navItemWithoutAudienceOrWithAdminAudienceIsRefused() throws Exception {
        String admin = LoreModelLiveReplaceTest.canon().replaceFirst("\"sprint\" : \"everywhere\"", "\"sprint\" : \"admin\"");
        IllegalStateException e = assertThrows(IllegalStateException.class, () -> LoreModelFile.parse(admin));
        assertTrue(e.getMessage().contains("sprint"), e.getMessage());
        String unknown = LoreModelLiveReplaceTest.canon().replaceFirst("\"sprint\" : \"everywhere\"", "\"sprint\" : \"всем\"");
        assertThrows(IllegalStateException.class, () -> LoreModelFile.parse(unknown));
    }
}
