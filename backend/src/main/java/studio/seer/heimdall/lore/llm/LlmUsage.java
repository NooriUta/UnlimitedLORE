package studio.seer.heimdall.lore.llm;

/**
 * Расход одного вызова.
 *
 * <p>Нужен не для отчётности, а для потолка: у нас нет платформенного лимита в
 * долларах (он есть только у управляемых агентов поставщика, от которых
 * отказались ради сменяемости моделей — SPEC-QG-ARCHITECTURE §4.2), поэтому
 * расход считается своим кодом и своим кодом же останавливается.
 *
 * <p>Кэш выделен отдельными полями сознательно. Чтение из кэша примерно
 * вдесятеро дешевле обычного входа, и если {@link #cachedInputTokens()} стабильно
 * нулевой при повторных прогонах — значит префикс запроса что-то молча ломает
 * (обычно текущая дата, попавшая в начало вместо конца). Без отдельного счётчика
 * это не видно вообще: суммарный расход просто вырастет, и никто не поймёт почему.
 *
 * @param inputTokens       вход, оплаченный полностью
 * @param cachedInputTokens вход, прочитанный из кэша
 * @param outputTokens      выход
 */
public record LlmUsage(long inputTokens, long cachedInputTokens, long outputTokens) {

    public static final LlmUsage NONE = new LlmUsage(0, 0, 0);

    /** Суммарные токены вызова — то, чем меряется потолок. */
    public long total() {
        return inputTokens + cachedInputTokens + outputTokens;
    }

    /** Сложение для накопления по прогону: потолок считается на прогон, не на вызов. */
    public LlmUsage plus(LlmUsage other) {
        if (other == null) return this;
        return new LlmUsage(
            inputTokens + other.inputTokens,
            cachedInputTokens + other.cachedInputTokens,
            outputTokens + other.outputTokens);
    }
}
