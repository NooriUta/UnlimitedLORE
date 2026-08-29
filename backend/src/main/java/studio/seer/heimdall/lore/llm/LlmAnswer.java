package studio.seer.heimdall.lore.llm;

/**
 * Ответ языковой модели — либо содержательный, либо явно несостоявшийся.
 *
 * <p><b>Третьего состояния нет намеренно.</b> Ни один вызывающий не должен иметь
 * возможности принять отсутствие ответа за пустой ответ: {@link #unavailable} —
 * это не {@code null}, не пустая строка и не исключение, а обычное значение с
 * названной причиной, которое нельзя не заметить, потому что {@link #text()} у
 * него отсутствует.
 *
 * <p>Форма взята у MIMIR: там stub-провайдер возвращает
 * {@code MimirAnswer.unavailable("ollama not wired")} вместо молчания
 * (ADR-MIMIR-001, ярус 3). Тот же принцип, что ADR-LORE-039 и инвариант И-6
 * SPEC-QG-ARCHITECTURE: измерение, которое не состоялось, обязано об этом
 * сказать, а не выглядеть как состоявшееся.
 *
 * @param text        текст ответа; {@code null}, если ответа нет
 * @param model       модель, которая ФАКТИЧЕСКИ ответила — не та, которую просили
 * @param usage       расход; {@code null}, если вызова не было
 * @param unavailable причина, по которой ответа нет; {@code null} при успехе
 */
public record LlmAnswer(String text, String model, LlmUsage usage, String unavailable) {

    /** Успешный ответ. {@code model} — та, что ответила на самом деле. */
    public static LlmAnswer of(String text, String model, LlmUsage usage) {
        return new LlmAnswer(text, model, usage, null);
    }

    /**
     * Ответа нет, и вот почему. Причина обязательна и не может быть пустой:
     * «не смог» без причины неотличимо от «нечего сказать», а это ровно тот
     * дефект, ради устранения которого класс и заведён.
     */
    public static LlmAnswer unavailable(String reason) {
        if (reason == null || reason.isBlank()) {
            throw new IllegalArgumentException(
                "причина недоступности обязательна: молчаливый отказ неотличим от пустого ответа");
        }
        return new LlmAnswer(null, null, null, reason);
    }

    /** Есть ли содержательный ответ. Проверять ДО чтения {@link #text()}. */
    public boolean ok() {
        return unavailable == null;
    }
}
