package studio.seer.heimdall.lore.llm;

import java.util.Optional;
import java.util.function.Function;

/**
 * Вызовы модели в пределах потолка одной попытки рутины —
 * task:SPRINT_QG_REBUILD/QG-15 (остаток), SPEC-QG-JOB-CONTRACT §4.
 *
 * <p>Потолок долларов есть только у управляемых агентов поставщика, от которых
 * отказались ради сменяемости моделей (QG-11, развилка A). Поэтому расход
 * складывается здесь ({@link LlmUsage#plus}) и здесь же останавливается.
 *
 * <h2>Правила</h2>
 * <ul>
 *   <li>Цена модели неизвестна — ни одного вызова ({@link #PRICE_UNKNOWN}, умолчание 1
 *       спеки): неизвестная цена не должна превращаться в неограниченный расход.
 *       Локальная модель — явная цена {@code 0}.</li>
 *   <li>Не задан ни один потолок — ни одного вызова ({@link #BUDGET_UNSET}).</li>
 *   <li>Потрачено ≥ потолка — следующего вызова нет ({@link #BUDGET_EXHAUSTED}).
 *       Вызов, начатый до пробоя, засчитывается целиком: его не отменить.</li>
 *   <li>Жёсткий {@code maxTokens} запроса урезается до остатка токенного потолка —
 *       страховка, а не основной механизм (обрыв на полуслове портит прогон).</li>
 * </ul>
 *
 * <p>Отказ — обычный {@link LlmAnswer#unavailable} с причиной, начинающейся с
 * {@code budget_exhausted}; код отказа отдельно в {@link #refusal()}, чтобы
 * вызывающий не разбирал текст. Недоступность самой модели отказом бюджета
 * не считается: {@link #refusal()} остаётся {@code null}.
 *
 * <p>Не потокобезопасен: одна попытка — один экземпляр.
 */
public final class BudgetedModelCall {

    /** Код причины «не измерено» в записи прогона (LoreQgRunWriter.NOT_MEASURED_REASONS). */
    public static final String BUDGET_EXHAUSTED = "budget_exhausted";
    /** Флаг: цена модели не задана в {@code lore.llm.price.<model>.*}. */
    public static final String PRICE_UNKNOWN = "price_unknown";
    /** Флаг: у рутины не задан ни {@code max-tokens}, ни {@code max-usd}. */
    public static final String BUDGET_UNSET = "budget_unset";

    private final Function<LlmRequest, LlmAnswer> call;
    private final LlmBudget budget;
    private final Optional<LlmPrice> price;

    private LlmUsage spent = LlmUsage.NONE;
    private String answeredModel;
    private String refusal;

    /**
     * @param call   сам вызов — в приложении {@code req -> router.ask(model, req)}
     * @param budget потолок попытки
     * @param price  цена выбранной модели; пусто — неизвестна
     */
    public BudgetedModelCall(Function<LlmRequest, LlmAnswer> call, LlmBudget budget, Optional<LlmPrice> price) {
        this.call = call;
        this.budget = budget == null ? new LlmBudget(null, null) : budget;
        this.price = price == null ? Optional.empty() : price;
    }

    public LlmAnswer ask(LlmRequest request) {
        if (price.isEmpty()) return refuse(PRICE_UNKNOWN, "цена модели не задана (lore.llm.price.<model>.*)");
        if (budget.unset()) return refuse(BUDGET_UNSET, "у рутины не задан ни max-tokens, ни max-usd");

        Long maxT = budget.maxTokens();
        if (maxT != null && spent.total() >= maxT) {
            return refuse(BUDGET_EXHAUSTED, "потрачено " + spent.total() + " из " + maxT + " токенов");
        }
        Double maxUsd = budget.maxUsd();
        if (maxUsd != null && spentUsd() >= maxUsd) {
            return refuse(BUDGET_EXHAUSTED, String.format(java.util.Locale.ROOT,
                "потрачено $%.4f из $%.4f", spentUsd(), maxUsd));
        }

        LlmRequest capped = request;
        if (maxT != null) {
            long remaining = maxT - spent.total();
            if (remaining < request.maxTokens()) {
                capped = new LlmRequest(request.systemPrompt(), request.userMessage(), remaining, request.taskBudget());
            }
        }

        LlmAnswer a = call.apply(capped);
        if (a == null) {
            // Провайдер обязан не возвращать null (LlmProvider); если вернул — называем, а не молчим.
            return LlmAnswer.unavailable("провайдер вернул null вместо ответа");
        }
        if (a.usage() != null) spent = spent.plus(a.usage());
        if (a.ok()) answeredModel = a.model();
        return a;
    }

    private LlmAnswer refuse(String code, String why) {
        refusal = code;
        return LlmAnswer.unavailable(BUDGET_EXHAUSTED + ": " + code + " — " + why);
    }

    /** Код отказа бюджета последнего вызова: {@link #BUDGET_EXHAUSTED}, {@link #PRICE_UNKNOWN}, {@link #BUDGET_UNSET}; {@code null} — отказа не было. */
    public String refusal() { return refusal; }

    /** Расход по всем вызовам попытки. */
    public LlmUsage spent() { return spent; }

    /** Расход в долларах; без цены — 0 (вызовов без цены не бывает). */
    public double spentUsd() { return price.map(p -> p.usd(spent)).orElse(0d); }

    /** Модель, которая ФАКТИЧЕСКИ ответила последней; {@code null} — не отвечала ни одна. */
    public String answeredModel() { return answeredModel; }
}
