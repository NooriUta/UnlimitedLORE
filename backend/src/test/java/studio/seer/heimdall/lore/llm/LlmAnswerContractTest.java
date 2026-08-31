package studio.seer.heimdall.lore.llm;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_QG_REBUILD/QG-15 — контракт ответа модели.
 *
 * <p>Проверяется не «работает ли вызов», а то, ради чего модуль написан:
 * <b>несостоявшийся вызов нельзя принять за пустой ответ</b>. Весь спринт
 * разбирает один класс дефектов — отсутствие факта, прикрытое формально
 * правильным значением; здесь он пресекается на уровне типа.
 */
class LlmAnswerContractTest {

    @Test
    void недоступностьБезПричиныНевозможнаВПринципе() {
        // Молчаливый отказ неотличим от пустого ответа. Поэтому причина не
        // «желательна», а невыразима в отсутствие: конструктор её требует.
        assertThrows(IllegalArgumentException.class, () -> LlmAnswer.unavailable(null));
        assertThrows(IllegalArgumentException.class, () -> LlmAnswer.unavailable(""));
        assertThrows(IllegalArgumentException.class, () -> LlmAnswer.unavailable("   "));
    }

    @Test
    void уНедоступногоОтветаНетТекстаИЭтоНеПустаяСтрока() {
        LlmAnswer a = LlmAnswer.unavailable("машина выключена");

        assertFalse(a.ok());
        // Ключевое: НЕ пустая строка. Пустая строка прошла бы через любую
        // обработку как валидный ответ — ровно так SKIP выдавал себя за зелень.
        assertNull(a.text(), "текста быть не должно, иначе отказ читается как ответ");
        assertNull(a.model(), "модели быть не должно: никто не отвечал");
        assertEquals("машина выключена", a.unavailable());
    }

    @Test
    void успешныйОтветНесётФАКТИЧЕСКУЮМодельАНеЗапрошенную() {
        // Настройка говорит, что должно быть использовано; ответ — что было.
        // Расходятся при запасном провайдере и при подмене версии на стороне
        // раннера. Хранить только намерение значит отчитываться намерением.
        LlmAnswer a = LlmAnswer.of("вывод", "qwen2.5-coder:32b", new LlmUsage(100, 900, 50));

        assertTrue(a.ok());
        assertEquals("qwen2.5-coder:32b", a.model());
        assertNull(a.unavailable());
    }

    @Test
    void расходСкладываетсяПоПрогонуАНеПоВызову() {
        // Потолок считается на прогон: одна рутина может звать модель несколько раз.
        LlmUsage total = LlmUsage.NONE
            .plus(new LlmUsage(10, 0, 5))
            .plus(new LlmUsage(20, 100, 7));

        assertEquals(30, total.inputTokens());
        assertEquals(100, total.cachedInputTokens());
        assertEquals(12, total.outputTokens());
        assertEquals(142, total.total());
    }

    @Test
    void чтениеИзКэшаСчитаетсяОтдельноОтОбычногоВхода() {
        // Отдельный счётчик — единственный способ заметить, что кэш перестал
        // работать: суммарный расход просто вырастет, ошибки не будет.
        LlmUsage u = new LlmUsage(5, 995, 10);

        assertEquals(5, u.inputTokens(), "оплаченный полностью вход");
        assertEquals(995, u.cachedInputTokens(), "прочитано из кэша — примерно вдесятеро дешевле");
    }

    @Test
    void сложениеСПустымНеТеряетНакопленное() {
        LlmUsage acc = new LlmUsage(1, 2, 3);
        assertEquals(acc, acc.plus(null));
    }

    @Test
    void запросБезСообщенияОтвергаетсяСразуАНеУходитВСеть() {
        assertThrows(IllegalArgumentException.class, () -> LlmRequest.of("system", null, 100));
        assertThrows(IllegalArgumentException.class, () -> LlmRequest.of("system", "  ", 100));
        assertThrows(IllegalArgumentException.class, () -> LlmRequest.of("system", "вопрос", 0));
    }

    @Test
    void потолокВидимыйМоделиОтличаетсяОтЖёсткогоОбрыва() {
        // Разница не косметическая: maxTokens обрывает на полуслове и портит
        // прогон, taskBudget модель видит и успевает записать вывод.
        LlmRequest withoutBudget = LlmRequest.of("s", "u", 4096);
        assertEquals(0, withoutBudget.taskBudget(), "не задан — значит не задан, а не «ноль токенов»");

        LlmRequest withBudget = new LlmRequest("s", "u", 4096, 64000);
        assertEquals(64000, withBudget.taskBudget());
    }
}
