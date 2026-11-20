package studio.seer.heimdall.lore.llm;

/**
 * Цена модели в долларах за миллион токенов (SPEC-QG-JOB-CONTRACT §4).
 *
 * <p>Кэш — отдельной ценой: чтение из кэша примерно вдесятеро дешевле обычного
 * входа, и считать его по цене входа значило бы завысить расход и оборвать
 * суждение раньше времени. Локальная модель — законная цена {@code 0/0/0},
 * заданная владелицей явно; отсутствие цены — не ноль, а «неизвестна»
 * (см. {@link BudgetedModelCall#PRICE_UNKNOWN}).
 *
 * @param inputPerM     вход, оплаченный полностью
 * @param outputPerM    выход
 * @param cacheReadPerM вход, прочитанный из кэша
 */
public record LlmPrice(double inputPerM, double outputPerM, double cacheReadPerM) {

    public LlmPrice {
        if (inputPerM < 0 || outputPerM < 0 || cacheReadPerM < 0) {
            throw new IllegalArgumentException("цена не может быть отрицательной");
        }
    }

    /** Стоимость расхода в долларах. */
    public double usd(LlmUsage u) {
        if (u == null) return 0;
        return (u.inputTokens() * inputPerM
            + u.outputTokens() * outputPerM
            + u.cachedInputTokens() * cacheReadPerM) / 1_000_000d;
    }
}
