package studio.seer.heimdall.lore;

import studio.seer.heimdall.lore.llm.LlmBudget;
import studio.seer.heimdall.lore.llm.LlmPrice;

import java.util.Optional;
import java.util.function.Function;

/**
 * Где владелец задаёт модель и потолок рутины — task:SPRINT_QG_REBUILD/QG-15
 * (остаток), SPEC-QG-JOB-CONTRACT §4–5. Только конфигурация приложения, отдельного
 * конфига рутин нет:
 * <pre>
 * lore.qg.routines.&lt;name&gt;.model        имя провайдера ModelRouter; пусто — lore.llm.default-provider
 * lore.qg.routines.&lt;name&gt;.max-tokens   потолок токенов на попытку (вход + кэш + выход)
 * lore.qg.routines.&lt;name&gt;.max-usd      потолок долларов на попытку
 * lore.llm.price.&lt;model&gt;.input|output|cache-read   $ за миллион; нет ни одной — цена неизвестна
 * </pre>
 * Не константа в коде: смена модели — правка env и рестарт, без деплоя
 * (решение владелицы 27.08.2026, ModelRouter).
 *
 * <p>Мусор в числе — «не задано», а не ноль и не «без предела»: ноль токенов
 * запретил бы любой вызов молча, «без предела» снял бы потолок.
 *
 * @param model  провайдер, выбранный владелицей; {@code null} — дефолт ModelRouter
 * @param budget потолок попытки
 * @param price  цена модели; пусто — неизвестна, суждение не вызывается
 */
record QgLlmSettings(String model, LlmBudget budget, Optional<LlmPrice> price) {

    static QgLlmSettings of(String routine, Function<String, Optional<String>> cfg) {
        String p = "lore.qg.routines." + routine + ".";
        String model = cfg.apply(p + "model").map(String::trim).filter(s -> !s.isEmpty()).orElse(null);
        Long maxTokens = cfg.apply(p + "max-tokens").map(QgLlmSettings::parseLong).filter(v -> v != null && v > 0).orElse(null);
        Double maxUsd = cfg.apply(p + "max-usd").map(QgLlmSettings::parseDouble).filter(v -> v != null && v >= 0).orElse(null);

        String priceKey = model != null ? model
            : cfg.apply("lore.llm.default-provider").map(String::trim).filter(s -> !s.isEmpty()).orElse(null);
        return new QgLlmSettings(model, new LlmBudget(maxTokens, maxUsd), price(priceKey, cfg));
    }

    /** Цена есть, если задана хоть одна из трёх и ни одна не мусор; незаданные — 0. */
    static Optional<LlmPrice> price(String model, Function<String, Optional<String>> cfg) {
        if (model == null) return Optional.empty();
        String p = "lore.llm.price." + model + ".";
        Optional<String> in = cfg.apply(p + "input");
        Optional<String> out = cfg.apply(p + "output");
        Optional<String> cache = cfg.apply(p + "cache-read");
        if (in.isEmpty() && out.isEmpty() && cache.isEmpty()) return Optional.empty();
        // Optional.map(null) дал бы пусто → orElse(0) превратил бы мусор в «бесплатно»; разбираем явно.
        Double i = in.isPresent() ? parseDouble(in.get()) : Double.valueOf(0);
        Double o = out.isPresent() ? parseDouble(out.get()) : Double.valueOf(0);
        Double c = cache.isPresent() ? parseDouble(cache.get()) : Double.valueOf(0);
        if (i == null || o == null || c == null || i < 0 || o < 0 || c < 0) return Optional.empty();
        return Optional.of(new LlmPrice(i, o, c));
    }

    private static Long parseLong(String s) {
        try { return Long.parseLong(s.trim()); } catch (NumberFormatException e) { return null; }
    }

    private static Double parseDouble(String s) {
        try { return Double.parseDouble(s.trim()); } catch (NumberFormatException e) { return null; }
    }
}
