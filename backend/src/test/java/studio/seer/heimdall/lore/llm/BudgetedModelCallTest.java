package studio.seer.heimdall.lore.llm;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * task:SPRINT_QG_REBUILD/QG-15 (остаток), SPEC-QG-JOB-CONTRACT §4: потолок расхода
 * на попытку рутины. У нас нет платформенного лимита, поэтому расход считается
 * своим кодом и своим же кодом останавливается. Превышение — явный отказ
 * {@code budget_exhausted}, а не молчание и не обрыв на полуслове.
 */
class BudgetedModelCallTest {

    private static final LlmRequest REQ = LlmRequest.of("инструкция", "метрики", 800);

    /** Подставной провайдер: каждый вызов тратит {@code perCall} токенов выхода. */
    private static final class Fake implements Function<LlmRequest, LlmAnswer> {
        final List<LlmRequest> seen = new ArrayList<>();
        final long perCall;
        Fake(long perCall) { this.perCall = perCall; }
        @Override public LlmAnswer apply(LlmRequest r) {
            seen.add(r);
            return LlmAnswer.of("суждение", "Qwen3.5-122B-A10B", new LlmUsage(100, 0, perCall));
        }
    }

    private static final LlmPrice FREE = new LlmPrice(0, 0, 0);

    @Test
    void unknownPriceRefusesBeforeAnyCall() {
        Fake f = new Fake(100);
        BudgetedModelCall c = new BudgetedModelCall(f, new LlmBudget(1000L, null), Optional.empty());
        LlmAnswer a = c.ask(REQ);
        assertFalse(a.ok());
        assertTrue(a.unavailable().startsWith(BudgetedModelCall.BUDGET_EXHAUSTED), a.unavailable());
        assertEquals(BudgetedModelCall.PRICE_UNKNOWN, c.refusal());
        assertEquals(0, f.seen.size(), "неизвестная цена не должна превращаться в неограниченный расход");
    }

    @Test
    void noCeilingAtAllRefusesBeforeAnyCall() {
        Fake f = new Fake(100);
        BudgetedModelCall c = new BudgetedModelCall(f, new LlmBudget(null, null), Optional.of(FREE));
        assertFalse(c.ask(REQ).ok());
        assertEquals(BudgetedModelCall.BUDGET_UNSET, c.refusal());
        assertEquals(0, f.seen.size());
    }

    @Test
    void tokenCeilingStopsFurtherCallsOnceSpent() {
        Fake f = new Fake(400); // 100 вход + 400 выход = 500 за вызов
        BudgetedModelCall c = new BudgetedModelCall(f, new LlmBudget(1000L, null), Optional.of(FREE));
        assertTrue(c.ask(REQ).ok());
        assertTrue(c.ask(REQ).ok());
        LlmAnswer third = c.ask(REQ);
        assertFalse(third.ok(), "потрачено 1000 из 1000 — третий вызов не идёт");
        assertEquals(BudgetedModelCall.BUDGET_EXHAUSTED, c.refusal());
        assertEquals(2, f.seen.size());
        assertEquals(1000, c.spent().total());
    }

    @Test
    void hardMaxTokensIsCappedToRemainingCeiling() {
        Fake f = new Fake(400);
        BudgetedModelCall c = new BudgetedModelCall(f, new LlmBudget(700L, null), Optional.of(FREE));
        c.ask(REQ);           // потрачено 500, осталось 200
        c.ask(REQ);
        assertEquals(700, f.seen.get(0).maxTokens(), "просили 800 при потолке 700 — урезано до потолка");
        assertEquals(200, f.seen.get(1).maxTokens(), "запрос не может просить больше остатка потолка");
    }

    @Test
    void usdCeilingCountsByPrice() {
        Fake f = new Fake(1_000_000); // миллион токенов выхода за вызов
        LlmPrice price = new LlmPrice(1.0, 2.0, 0.1); // $ за миллион
        BudgetedModelCall c = new BudgetedModelCall(f, new LlmBudget(null, 3.0), Optional.of(price));
        assertTrue(c.ask(REQ).ok());   // ≈ $2.0001, меньше $3 — следующий разрешён
        assertTrue(c.ask(REQ).ok());   // ≈ $4.0002 — потолок пробит этим вызовом
        assertFalse(c.ask(REQ).ok(), "после пробоя потолка вызовов больше нет");
        assertEquals(2, f.seen.size());
        assertEquals(BudgetedModelCall.BUDGET_EXHAUSTED, c.refusal());
        assertTrue(c.spentUsd() >= 3.0);
    }

    @Test
    void answeredModelIsRememberedNotTheRequestedOne() {
        BudgetedModelCall c = new BudgetedModelCall(new Fake(10), new LlmBudget(1000L, null), Optional.of(FREE));
        assertNull(c.answeredModel(), "до вызова модели нет");
        c.ask(REQ);
        assertEquals("Qwen3.5-122B-A10B", c.answeredModel());
    }

    @Test
    void unavailableProviderIsNotABudgetRefusal() {
        BudgetedModelCall c = new BudgetedModelCall(r -> LlmAnswer.unavailable("модель вне окна"),
            new LlmBudget(1000L, null), Optional.of(FREE));
        LlmAnswer a = c.ask(REQ);
        assertFalse(a.ok());
        assertNull(c.refusal(), "модель недоступна — это не исчерпанный бюджет");
        assertEquals(0, c.spent().total());
    }

    @Test
    void priceCountsCacheSeparately() {
        LlmPrice p = new LlmPrice(10.0, 20.0, 1.0);
        assertEquals(10.0 + 20.0 + 1.0, p.usd(new LlmUsage(1_000_000, 1_000_000, 1_000_000)), 1e-9);
    }
}
