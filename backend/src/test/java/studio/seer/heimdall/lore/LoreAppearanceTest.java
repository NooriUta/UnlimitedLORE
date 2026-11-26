package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * [[task:SPRINT_LORE_ADMIN_POLISH/AP-APPEARANCE]] — оформление установки, решения владельца 25.11.2026 (1а, 2в, 3б, 4а).
 * Чистый JUnit: Quarkus и база не поднимаются.
 */
class LoreAppearanceTest {

    // ── 3б: свой стиль — JSON или CSS-переменные, хранится JSON ────────────────

    @Test
    void css_переменные_root_и_light_принимаются_и_хранятся_JSON() {
        LoreAppearance.StyleCheck c = LoreAppearance.checkStyle(
            ":root {\n  --bg0: #10141a; --bg1: #161c24; --t1: #e4ebf2; --t2: #a3b1c0; --acc: #e0a040;\n}\n"
                + "[data-mode=\"light\"] { --bg0: #fafafa; --acc: color-mix(in srgb, var(--wrn) 60%, #000); }");
        assertTrue(c.ok(), c.errors().toString());
        assertEquals("#e0a040", c.root().get("--acc"));
        assertEquals("#fafafa", c.light().get("--bg0"));
        assertEquals(List.of(), c.warnings(), "обязательные заданы — предупреждать не о чем");
        assertEquals("{\"root\":{\"--acc\":\"#e0a040\",\"--bg0\":\"#10141a\",\"--bg1\":\"#161c24\",\"--t1\":\"#e4ebf2\",\"--t2\":\"#a3b1c0\"},"
            + "\"light\":{\"--acc\":\"color-mix(in srgb, var(--wrn) 60%, #000)\",\"--bg0\":\"#fafafa\"}}", c.json());
    }

    @Test
    void json_плоский_и_хранимая_форма_дают_одно_и_то_же() {
        LoreAppearance.StyleCheck flat = LoreAppearance.checkStyle("{ \"--acc\": \"#3a8fd8\", \"--bg0\": \"rgb(13, 17, 23)\" }");
        assertTrue(flat.ok(), flat.errors().toString());
        LoreAppearance.StyleCheck stored = LoreAppearance.checkStyle(flat.json());
        assertTrue(stored.ok(), stored.errors().toString());
        assertEquals(flat.json(), stored.json(), "повторная загрузка хранимой формы равна себе");
        assertTrue(flat.warnings().toString().contains("--bg1"), "не заданные обязательные — предупреждение, не отказ");
    }

    @Test
    void неизвестный_токен_url_import_и_сырой_шрифт_отказ_со_словами() {
        LoreAppearance.StyleCheck c = LoreAppearance.checkStyle(
            ":root {\n  --acc: #e0a040;\n  --brand-primary: #ff00aa;\n  --bg0: tomato-ish;\n  font-family: \"Comic Sans MS\";\n"
                + "  --fs-base: 15px;\n  --display: \"Roboto Slab\", serif;\n  --bg1: url(x.png);\n}\n"
                + ".sk-btn { border-radius: 0; }\n@import url(\"https://cdn.example/x.css\");");
        assertFalse(c.ok());
        String e = String.join("\n", c.errors());
        assertTrue(e.contains("--brand-primary — неизвестная переменная"), e);
        assertTrue(e.contains("«tomato-ish» — не цвет"), e);
        assertTrue(e.contains("font-family") && e.contains("сырой шрифт"), e);
        assertTrue(e.contains("--fs-base") && e.contains("сырой шрифт"), e);
        assertTrue(e.contains("--display: своих шрифтов установка не принимает (решение 4а)"), e);
        assertTrue(e.contains("url() запрещён"), e);
        assertTrue(e.contains("@import или url()"), e);
        assertTrue(e.contains("селектор «.sk-btn»"), e);
        assertEquals(Map.of("--acc", "#e0a040"), c.root(), "годное посчитано, негодное в токены не попало");
    }

    @Test
    void пусто_битый_JSON_и_не_блок_отказ() {
        assertFalse(LoreAppearance.checkStyle("  ").ok());
        assertTrue(LoreAppearance.checkStyle("{ \"--acc\": ").errors().get(0).startsWith("JSON не читается"));
        assertTrue(LoreAppearance.checkStyle("--acc: #fff;").errors().toString().contains("не нашли блок"));
        assertTrue(LoreAppearance.checkStyle("x".repeat(LoreAppearance.SOURCE_MAX + 1)).errors().toString().contains("КБ"));
    }

    @Test
    void битый_tokens_json_в_базе_не_рисуется() {
        assertEquals(Map.of(), LoreAppearance.parseStored("{\"root\":{\"--nope\":\"#fff\"}}"));
        assertEquals(Map.of("root", Map.of("--acc", "#fff")), LoreAppearance.parseStored("{\"root\":{\"--acc\":\"#fff\"}}"));
        assertEquals(Map.of(), LoreAppearance.parseStored(null));
    }

    // ── наши обязательные; 2в — умолчание и набор установки, личный выбор внутри ───

    @Test
    void наши_палитры_те_же_что_белый_список_настройки_palette() {
        assertEquals(LoreMePrefs.SETTINGS.get("palette").values(), LoreAppearance.BUILTIN_PALETTES,
            "один список наших палитр: настройка, модель и оформление");
        assertEquals(LoreAppearance.BUILTIN_PALETTES,
            PaletteDictSeed.PALETTE.stream().map(StatusDictCoreSeed.Entry::code).toList(), "подписи посеяны всем шести (5а)");
        assertTrue(LoreAppearance.isOwn("own-corp-blue"));
        assertFalse(LoreAppearance.isOwn("amber-forest"));
        assertFalse(LoreAppearance.isOwn("own-"));
    }

    private static Map<String, Object> setting(String code, String value) {
        Map<String, Object> m = new HashMap<>();
        m.put("dict_type", "app_setting");
        m.put("code", code);
        m.put("label_ru", value);
        m.put("is_active", true);
        return m;
    }

    @Test
    void без_настроек_установки_разрешено_всё_умолчание_из_кода() {
        LoreAppearance.Install i = LoreAppearance.install(List.of(), List.of("own-corp"));
        assertEquals("amber-forest", i.paletteDefault());
        assertEquals(List.of("amber-forest", "lichen", "slate", "juniper", "warm-dark", "mono", "own-corp"), i.palettesAllowed());
        assertEquals("pair", i.fontDefault());
        assertEquals(List.of("pair", "mono"), i.fontsAllowed());
        assertEquals(List.of(), i.notes());
    }

    @Test
    void умолчание_установки_перекрывается_личным_выбором_только_из_набора() {
        LoreAppearance.Install i = LoreAppearance.install(List.of(
            setting(LoreAppearance.K_PALETTES_ALLOWED, "slate, own-corp, mono"),
            setting(LoreAppearance.K_PALETTE_DEFAULT, "own-corp"),
            setting(LoreAppearance.K_FONTS_ALLOWED, "pair"),
            setting(LoreAppearance.K_FONT_DEFAULT, "pair")), List.of("own-corp"));
        assertEquals(List.of("slate", "mono", "own-corp"), i.palettesAllowed(), "порядок — наши, затем свои");
        assertEquals("own-corp", i.paletteDefault());

        Map<String, Object> eff = Map.of("palette", "amber-forest", "font_pair", "pair", "theme", "dark");
        // человек ничего не выбирал — умолчание установки
        assertEquals("own-corp", LoreAppearance.overlay(eff, Map.of(), i).get("palette"));
        // выбор внутри набора — его
        assertEquals("slate", LoreAppearance.overlay(eff, Map.of("palette", "slate"), i).get("palette"));
        // выбор вне набора (набор сузили после выбора) — умолчание установки, а не прежний выбор
        assertEquals("own-corp", LoreAppearance.overlay(eff, Map.of("palette", "lichen", "font_pair", "mono"), i).get("palette"));
        assertEquals("pair", LoreAppearance.overlay(eff, Map.of("font_pair", "mono"), i).get("font_pair"));
        assertEquals("dark", LoreAppearance.overlay(eff, Map.of(), i).get("theme"), "прочие настройки не трогаются");

        assertNull(LoreAppearance.personalRefusal(Map.of("palette", "mono"), i));
        String r = LoreAppearance.personalRefusal(Map.of("palette", "lichen", "font_pair", "mono"), i);
        assertTrue(r.contains("палитра «lichen» не входит в набор установки") && r.contains("пара шрифтов «mono»"), r);
    }

    @Test
    void битые_настройки_установки_названы_словами_и_заменены() {
        LoreAppearance.Install i = LoreAppearance.install(List.of(
            setting(LoreAppearance.K_PALETTES_ALLOWED, "own-gone, nope"),
            setting(LoreAppearance.K_PALETTE_DEFAULT, "lichen"),
            setting(LoreAppearance.K_FONTS_ALLOWED, "mono"),
            setting(LoreAppearance.K_FONT_DEFAULT, "pair")), List.of());
        assertEquals(LoreAppearance.BUILTIN_PALETTES, i.palettesAllowed(), "набор опустел — разрешено всё, не «ничего»");
        assertEquals("lichen", i.paletteDefault());
        assertEquals("mono", i.fontDefault(), "умолчание вне набора — первое из набора");
        String n = i.notes().toString();
        assertTrue(n.contains("[own-gone, nope] пропущены") && n.contains("пуст после проверки") && n.contains("«pair» вне разрешённого набора"), n);
    }

    @Test
    void запись_ключа_установки_проверяет_коды() {
        assertNull(LoreAppearance.installSettingRefusal(LoreAppearance.K_PALETTES_ALLOWED, "slate,own-corp"));
        assertNull(LoreAppearance.installSettingRefusal(LoreAppearance.K_FONT_DEFAULT, "mono"));
        assertNull(LoreAppearance.installSettingRefusal("charts.layer", "whatever"), "чужой ключ — не наше дело");
        assertTrue(LoreAppearance.installSettingRefusal(LoreAppearance.K_PALETTE_DEFAULT, "Amber").contains("неизвестные коды [Amber]"));
        assertTrue(LoreAppearance.installSettingRefusal(LoreAppearance.K_FONTS_ALLOWED, "pair,comic").contains("[comic]"));
    }
}
