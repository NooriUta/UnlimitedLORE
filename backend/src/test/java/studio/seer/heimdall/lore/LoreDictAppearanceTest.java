package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Запись справочника и оформление ([[task:SPRINT_LORE_ADMIN_POLISH/AP-APPEARANCE]] 1а/3б,
 * [[task:SPRINT_LORE_EXT_AUDIT_1190/AUD-AREA-COLORS]] 6а): свой стиль — статья palette с кодом own-… и проверенным
 * tokens_json; наши палитры обязательные; цвет статьи — токен. Чистый JUnit.
 */
class LoreDictAppearanceTest {

    private static LoreDictResource.DictEntryRequest req(String dt, String code, String label, String color,
                                                         Boolean active, String tokens) {
        return new LoreDictResource.DictEntryRequest(dt, code, label, null, color, null, null, active, null, null, null, tokens);
    }

    private static final String GOOD = ":root { --acc: #3a8fd8; --bg0: #0d1117; }";

    @Test
    void цвет_статьи_только_токен() {
        assertTrue(LoreDictResource.appearanceRefusal(req("task_type", "dev", null, "#4caf72", null, null), true)
            .contains("токен темы"));
        assertNull(LoreDictResource.appearanceRefusal(req("task_type", "dev", null, "var(--suc)", null, null), true));
        assertNull(LoreDictResource.appearanceRefusal(req("task_type", "dev", "Разработка", null, null, null), true),
            "правка без цвета — цвет не проверяется");
    }

    @Test
    void свой_стиль_годный_принимается_и_нормализуется() {
        var r = req("palette", "own-corp", "Корпоративный", null, null, GOOD);
        assertNull(LoreDictResource.appearanceRefusal(r, false));
        assertEquals("{\"root\":{\"--acc\":\"#3a8fd8\",\"--bg0\":\"#0d1117\"}}", LoreDictResource.storedTokens(r));
    }

    @Test
    void свой_стиль_с_ошибками_отказ_словами() {
        String r = LoreDictResource.appearanceRefusal(req("palette", "own-corp", "x", null, null, ":root { --brand: #fff; }"), false);
        assertTrue(r.contains("свой стиль own-corp не принят") && r.contains("--brand — неизвестная переменная"), r);
    }

    @Test
    void новый_свой_стиль_без_токенов_отказ() {
        assertTrue(LoreDictResource.appearanceRefusal(req("palette", "own-corp", "x", null, null, null), false)
            .contains("без токенов"));
        assertNull(LoreDictResource.appearanceRefusal(req("palette", "own-corp", null, null, false, null), true),
            "выключить существующий свой стиль — можно");
    }

    @Test
    void наши_палитры_обязательные() {
        assertTrue(LoreDictResource.appearanceRefusal(req("palette", "slate", null, null, false, null), true)
            .contains("наши палитры обязательные"));
        assertTrue(LoreDictResource.appearanceRefusal(req("palette", "slate", null, null, null, GOOD), true)
            .contains("токены наших палитр живут в приложении"));
        assertNull(LoreDictResource.appearanceRefusal(req("palette", "slate", "Сланец", "var(--swatch-slate)", null, null), true),
            "подпись нашей палитры править можно");
        assertTrue(LoreDictResource.appearanceRefusal(req("palette", "corp", "x", null, null, GOOD), false)
            .contains("own-"));
    }

    @Test
    void токены_только_у_палитры() {
        assertTrue(LoreDictResource.appearanceRefusal(req("area", "x", "x", null, null, GOOD), false)
            .contains("только у статьи palette"));
    }

    @Test
    void ключи_установки_проверяются() {
        assertTrue(LoreDictResource.appearanceRefusal(req("app_setting", "appearance.palette_default", "Amber", null, null, null), true)
            .contains("неизвестные коды [Amber]"));
        assertNull(LoreDictResource.appearanceRefusal(req("app_setting", "appearance.palettes_allowed", "slate,own-corp", null, null, null), true));
    }

    @Test
    void повтор_тех_же_токенов_unchanged() {
        var r = req("palette", "own-corp", null, null, null, GOOD);
        Map<String, Object> stored = new HashMap<>();
        stored.put("tokens_json", LoreDictResource.storedTokens(r));
        assertTrue(LoreDictResource.sameAsStored(r, stored));
        stored.put("tokens_json", "{\"root\":{\"--acc\":\"#000000\"}}");
        assertFalse(LoreDictResource.sameAsStored(r, stored));
    }

    @Test
    void проверка_стиля_до_сохранения_отдаёт_все_причины_и_токены() {
        Map<String, Object> bad = LoreDictResource.styleCheckBody(":root { --brand: #fff; --acc: tomato; }");
        assertEquals(false, bad.get("ok"));
        assertEquals(2, ((java.util.List<?>) bad.get("errors")).size(), "все причины разом, не первая");
        assertNull(bad.get("tokens_json"));
        Map<String, Object> good = LoreDictResource.styleCheckBody(GOOD);
        assertEquals(true, good.get("ok"));
        assertEquals(Map.of("root", Map.of("--acc", "#3a8fd8", "--bg0", "#0d1117")), good.get("tokens"));
    }
}
