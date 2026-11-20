package studio.seer.heimdall.lore.llm;

/**
 * Потолок расхода на ОДНУ попытку рутины (SPEC-QG-JOB-CONTRACT §4): суммарные
 * токены и/или доллары. {@code null} — этот потолок не задан. Не задан ни один —
 * суждение не вызывается вовсе ({@link BudgetedModelCall#BUDGET_UNSET}): у нас нет
 * платформенного лимита, и «без потолка» значило бы «без предела».
 *
 * @param maxTokens суммарно вход + кэш + выход по всем вызовам попытки
 * @param maxUsd    доллары по всем вызовам попытки, по {@link LlmPrice}
 */
public record LlmBudget(Long maxTokens, Double maxUsd) {

    public LlmBudget {
        if (maxTokens != null && maxTokens <= 0) throw new IllegalArgumentException("maxTokens должен быть положительным");
        if (maxUsd != null && maxUsd < 0) throw new IllegalArgumentException("maxUsd не может быть отрицательным");
    }

    public boolean unset() {
        return maxTokens == null && maxUsd == null;
    }
}
