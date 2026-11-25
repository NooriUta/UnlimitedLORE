package studio.seer.heimdall.lore;

import java.util.List;
import java.util.Map;

/**
 * Доводка v4 · подписи шести наших палитр ([[task:SPRINT_LORE_EXT_AUDIT_1190/AUD-AREA-COLORS]], решение владельца
 * 25.11.2026, пункт 5а: «засеять подписи шести палитр на свежую установку»).
 *
 * <p>Коды — {@link LoreAppearance#BUILTIN_PALETTES} (= kit/src/tokens/prefs.ts PALETTES). Без статьи экран настроек
 * печатал «без статьи — показан код», а на свежей установке справочник palette пуст (init-empty его не сеял). Цвет
 * статьи — образец палитры токеном {@code --swatch-*} (значения живут только в seidr.css). Подпись mono — как на проде.
 *
 * <p>Как V90/V93/V100: только INSERT недостающих статей, правленные людьми строки не трогаются. Справочник расширяемый:
 * в нём же живут свои стили установки (код {@code own-…}, поле tokens_json — {@link LoreAppearance}).
 */
final class PaletteDictSeed {

    private PaletteDictSeed() {}

    private static StatusDictCoreSeed.Entry e(String code, String ru, String en, int sort) {
        return new StatusDictCoreSeed.Entry(code, ru, en, null, "var(--swatch-" + code + ")", sort);
    }

    static final List<StatusDictCoreSeed.Entry> PALETTE = List.of(
        e("amber-forest", "янтарный лес", "amber forest", 10),
        e("lichen", "лишайник", "lichen", 20),
        e("slate", "сланец", "slate", 30),
        e("juniper", "можжевельник", "juniper", 40),
        e("warm-dark", "тёплая тёмная", "warm dark", 50),
        e("mono", "приглушённая (mono)", "muted (mono)", 60));

    static final Map<String, List<StatusDictCoreSeed.Entry>> SEEDS = Map.of("palette", PALETTE);

    static final String INSERT_SQL =
        "INSERT INTO KnowDictEntry SET dict_type = :dict_type, code = :code, label_ru = :label_ru, "
            + "label_en = :label_en, color = :color, sort_order = :sort_order, "
            + "is_active = true, is_extensible = true";

    /** Иконки у палитры нет — поле не пишется. */
    static Map<String, Object> params(StatusDictCoreSeed.Insert i) {
        Map<String, Object> p = new java.util.LinkedHashMap<>(i.params());
        p.remove("icon");
        return p;
    }
}
