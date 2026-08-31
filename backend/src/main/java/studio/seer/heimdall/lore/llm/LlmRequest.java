package studio.seer.heimdall.lore.llm;

/**
 * Запрос к модели.
 *
 * <p><b>Порядок полей значим и является частью контракта.</b> Совпадение кэша
 * идёт по префиксу: сначала системная часть, затем сообщение. Изменение любого
 * байта в префиксе обесценивает всё, что после него.
 *
 * <p>Отсюда правило, которое обязан соблюдать вызывающий: <b>в
 * {@code systemPrompt} не должно быть ничего изменчивого</b> — ни даты прогона,
 * ни номера, ни идентификатора запуска. Всё это идёт в {@code userMessage}. У
 * рутины по расписанию дата попадёт в системную часть сама собой, если за этим
 * не следить, и кэш исчезнет молча: ошибки не будет, просто счёт вырастет
 * примерно вдесятеро. Проверяется по {@link LlmUsage#cachedInputTokens()}.
 *
 * @param systemPrompt  инструкция рутины — между прогонами НЕИЗМЕННА
 * @param userMessage   изменчивая часть: нормализованные метрики, история ряда, дата
 * @param maxTokens     жёсткий потолок ответа; обрывает на полуслове, модель о нём не знает
 * @param taskBudget    потолок, который модель ВИДИТ и под который укладывается сама;
 *                      0 — не задан. Отличается от {@code maxTokens} принципиально:
 *                      обрыв портит прогон, а укладывание позволяет закончить и записать вывод
 */
public record LlmRequest(String systemPrompt, String userMessage, long maxTokens, long taskBudget) {

    public LlmRequest {
        if (userMessage == null || userMessage.isBlank()) {
            throw new IllegalArgumentException("userMessage обязателен");
        }
        if (maxTokens <= 0) {
            throw new IllegalArgumentException("maxTokens должен быть положительным");
        }
    }

    /** Без потолка, видимого модели. */
    public static LlmRequest of(String systemPrompt, String userMessage, long maxTokens) {
        return new LlmRequest(systemPrompt, userMessage, maxTokens, 0);
    }
}
