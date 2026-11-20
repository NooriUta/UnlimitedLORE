package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;
import studio.seer.heimdall.lore.llm.LlmPrice;

import java.util.Map;
import java.util.Optional;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * task:SPRINT_QG_REBUILD/QG-15 (остаток) — где владелец задаёт модель и потолок
 * рутины: конфиг {@code lore.qg.routines.<name>.model|max-tokens|max-usd} и цена
 * {@code lore.llm.price.<model>.input|output|cache-read} (SPEC-QG-JOB-CONTRACT §4).
 * Настройка, а не константа: смена модели не должна требовать деплоя.
 */
class QgLlmSettingsTest {

    private static Function<String, Optional<String>> cfg(Map<String, String> m) {
        return k -> Optional.ofNullable(m.get(k));
    }

    @Test
    void modelAndCeilingsComeFromRoutineConfig() {
        QgLlmSettings s = QgLlmSettings.of("qg-stale-docs", cfg(Map.of(
            "lore.qg.routines.qg-stale-docs.model", "local",
            "lore.qg.routines.qg-stale-docs.max-tokens", "200000",
            "lore.qg.routines.qg-stale-docs.max-usd", "0.5",
            "lore.llm.price.local.input", "0",
            "lore.llm.price.local.output", "0")));
        assertEquals("local", s.model());
        assertEquals(200_000L, s.budget().maxTokens());
        assertEquals(0.5, s.budget().maxUsd());
        assertEquals(new LlmPrice(0, 0, 0), s.price().orElseThrow());
    }

    @Test
    void blankModelMeansRouterDefault() {
        QgLlmSettings s = QgLlmSettings.of("r", cfg(Map.of("lore.qg.routines.r.model", "  ")));
        assertNull(s.model(), "пустое имя — дефолт ModelRouter, а не модель с именем «  »");
    }

    @Test
    void priceIsLookedUpForTheDefaultProviderWhenModelUnset() {
        QgLlmSettings s = QgLlmSettings.of("r", cfg(Map.of(
            "lore.llm.default-provider", "local",
            "lore.llm.price.local.output", "0")));
        assertTrue(s.price().isPresent());
    }

    @Test
    void missingOrGarbagePriceIsUnknownNotZero() {
        assertTrue(QgLlmSettings.of("r", cfg(Map.of("lore.qg.routines.r.model", "x"))).price().isEmpty(),
            "цены нет — неизвестна, а не бесплатна");
        assertTrue(QgLlmSettings.of("r", cfg(Map.of(
            "lore.qg.routines.r.model", "x", "lore.llm.price.x.output", "дёшево"))).price().isEmpty());
    }

    @Test
    void garbageCeilingIsAbsentNotUnlimited() {
        QgLlmSettings s = QgLlmSettings.of("r", cfg(Map.of("lore.qg.routines.r.max-tokens", "много")));
        assertNull(s.budget().maxTokens());
        assertNull(s.budget().maxUsd());
    }
}
