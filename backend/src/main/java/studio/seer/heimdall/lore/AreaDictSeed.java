package studio.seer.heimdall.lore;

import java.util.List;
import java.util.Map;

/**
 * V100 — статьи словаря area для областей компонентов (SPRINT_LORE_EXT_AUDIT_1190/AUD-AREA-COLORS,
 * issue SeidrStudio/UnlimitedLORE#2, повтор [[task:SPRINT_LORE_ADMIN_PANEL/AL-28]] на чистой базе).
 *
 * <p>ADR-LORE-012/AL-28: цвет области — из словаря, правка в админке меняет его везде. Но миграции
 * заводили только research и business (V89): на базе с нуля у кодов сида компонентов
 * ({@link LoreComponentSeeder#COMPONENTS}) статей не было, цвет брался из констант фронта, а править
 * в админке было нечего. Здесь — коды сида и прежние коды фронта с ТЕМИ ЖЕ цветами (чистая установка
 * выглядит как раньше, но цвет теперь живёт в словаре).
 *
 * <p>Как V90/V93: только INSERT недостающих строк (сравнение без учёта регистра), правленные людьми не
 * переписываются — на проде шаг вставляет лишь то, чего там нет. Статьи area расширяемые, как у V89.
 */
final class AreaDictSeed {

    private AreaDictSeed() {}

    static final String STEP = "java__area_dict_seed";

    static final List<StatusDictCoreSeed.Entry> AREA = List.of(
        new StatusDictCoreSeed.Entry("platform", "Платформа", "Platform", null, "var(--acc)", 10),
        new StatusDictCoreSeed.Entry("api", "API", "API", null, "color-mix(in srgb,var(--acc) 55%,var(--inf))", 20),
        new StatusDictCoreSeed.Entry("frontend", "Фронтенд", "Frontend", null, "color-mix(in srgb,var(--suc) 70%,var(--bg0))", 30),
        new StatusDictCoreSeed.Entry("service", "Сервисы", "Services", null, "color-mix(in srgb,var(--suc) 55%,var(--wrn))", 40),
        new StatusDictCoreSeed.Entry("engine", "Движки", "Engines", null, "color-mix(in srgb,var(--wrn) 60%,var(--dng))", 50),
        new StatusDictCoreSeed.Entry("algorithm", "Алгоритмы", "Algorithms", null, "color-mix(in srgb,var(--acc) 60%,var(--dng))", 60),
        new StatusDictCoreSeed.Entry("data", "Данные", "Data", null, "var(--suc)", 70),
        new StatusDictCoreSeed.Entry("db", "Базы данных", "Databases", null, "color-mix(in srgb,var(--inf) 70%,var(--bg0))", 80),
        new StatusDictCoreSeed.Entry("ai", "ИИ", "AI", null, "var(--inf)", 90),
        new StatusDictCoreSeed.Entry("infra", "Инфраструктура", "Infrastructure", null, "var(--t2)", 100),
        new StatusDictCoreSeed.Entry("observability", "Наблюдаемость", "Observability", null, "var(--wrn)", 110),
        new StatusDictCoreSeed.Entry("security", "Безопасность", "Security", null, "var(--dng)", 120),
        new StatusDictCoreSeed.Entry("marketing", "Маркетинг", "Marketing", null, "color-mix(in srgb,var(--acc) 55%,var(--wrn))", 130));

    static final Map<String, List<StatusDictCoreSeed.Entry>> SEEDS = Map.of("area", AREA);

    /** Чистая вставка, расширяемая статья (как area в V89); повтор отсекает план, а не перезапись. */
    static final String INSERT_SQL =
        "INSERT INTO KnowDictEntry SET dict_type = :dict_type, code = :code, label_ru = :label_ru, "
            + "label_en = :label_en, color = :color, sort_order = :sort_order, "
            + "is_active = true, is_extensible = true";

    /** Параметры вставки: иконки у области нет (как у research/business в V89) — поле не пишется вовсе. */
    static Map<String, Object> params(StatusDictCoreSeed.Insert i) {
        Map<String, Object> p = new java.util.LinkedHashMap<>(i.params());
        p.remove("icon");
        return p;
    }
}
