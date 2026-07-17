package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * PL-12 (ADR-LORE-027 §3-4): линтер качества UC — чистая функция, без БД.
 * Ключевой инвариант: знаменатель зависит от веса (casual ≠ fully-dressed),
 * опциональные проверки в casual становятся подсказками и в счёт не входят.
 */
class UcQualityTest {

    private static final String FULL_SCENARIO = String.join("\n",
        "### Триггер", "Агент вызывает merge.",
        "### Предусловия", "PR открыт.",
        "### Основной сценарий", "1. Читаем чеки.", "2. Все зелёные → merge.",
        "### Расширения", "2a. Красный чек → 409.",
        "### Минимальные гарантии", "Merge на не-GREEN невозможен.",
        "### Гарантии успеха", "PR влит, рёбра созданы.");

    private static final String FULL_ACCEPTANCE = String.join("\n",
        "### Проверки", "1. PR смержен вызовом.",
        "### Покрытие расширений", "2a — проверка 1.");

    private UcQuality.Finding find(UcQuality.Result r, String code) {
        return r.findings().stream().filter(f -> f.code().equals(code)).findFirst().orElseThrow();
    }

    @Test
    void fullyDressedComplete() {
        UcQuality.Result r = UcQuality.evaluate("fully-dressed", "sea-level",
            FULL_SCENARIO, FULL_ACCEPTANCE, true, true);
        assertEquals("fully-dressed", r.rigor());
        assertEquals(r.max(), r.score(), "полностью оформленный UC даёт максимум");
        assertTrue(find(r, "extensions_ref_steps").ok());
        assertTrue(find(r, "traced_to").ok());
        assertFalse(find(r, "traced_to").required(), "TRACED_TO — подсказка, не в счёт");
    }

    @Test
    void casualHasSmallerDenominator() {
        // Тот же UC без Предусловий/Расширений/Гарантий-успеха: на fully-dressed
        // это штрафы, на casual — подсказки (в знаменатель не входят).
        String casualScenario = String.join("\n",
            "### Триггер", "Пуш ветки.",
            "### Основной сценарий", "1. Пушим.", "2. Открываем PR.",
            "### Минимальные гарантии", "Токен не покидает сервер.");
        UcQuality.Result full = UcQuality.evaluate("fully-dressed", "sea-level",
            casualScenario, "1. проверка", true, false);
        UcQuality.Result casual = UcQuality.evaluate("casual", "subfunction",
            casualScenario, "1. проверка", true, false);

        assertTrue(casual.max() < full.max(), "у casual знаменатель меньше");
        assertEquals(casual.max(), casual.score(), "для casual этот UC — полный");
        assertFalse(full.max() == full.score(), "для fully-dressed те же секции — недобор");
    }

    @Test
    void extensionRefToMissingStepFails() {
        String badExt = String.join("\n",
            "### Триггер", "x",
            "### Основной сценарий", "1. шаг", "2. шаг",
            "### Расширения", "5a. ссылка на несуществующий шаг 5",
            "### Минимальные гарантии", "y");
        UcQuality.Result r = UcQuality.evaluate("fully-dressed", "sea-level", badExt, "1. c", true, false);
        assertFalse(find(r, "extensions_ref_steps").ok(),
            "расширение 5a ссылается на отсутствующий шаг 5");
    }

    @Test
    void mainStepsAndExtensionRefsAreParsed() {
        assertEquals(List.of(1, 2), UcQuality.mainSteps(FULL_SCENARIO));
        assertEquals(List.of(2), UcQuality.extensionRefs(FULL_SCENARIO));
    }

    @Test
    void missingPrimaryActorIsAlwaysRequired() {
        UcQuality.Result r = UcQuality.evaluate("casual", "subfunction",
            "### Триггер\nx\n### Основной сценарий\n1. a\n2. b\n### Минимальные гарантии\ny",
            "1. c", false, false);
        assertFalse(find(r, "primary_actor").ok());
        assertTrue(find(r, "primary_actor").required(), "primary-актор обязателен в обоих весах");
    }

    @Test
    void fullyDressedAcceptanceNeedsBothSections() {
        // casual довольствуется нумерованным списком; fully-dressed требует секции.
        UcQuality.Result casual = UcQuality.evaluate("casual", "subfunction",
            "### Триггер\nx\n### Основной сценарий\n1. a\n2. b\n### Минимальные гарантии\ny",
            "1. простая проверка", true, false);
        assertTrue(find(casual, "acceptance").ok());

        UcQuality.Result full = UcQuality.evaluate("fully-dressed", "sea-level",
            FULL_SCENARIO, "1. просто список без секций", true, false);
        assertFalse(find(full, "acceptance").ok(), "fully-dressed требует «Проверки» + «Покрытие расширений»");
    }
}
