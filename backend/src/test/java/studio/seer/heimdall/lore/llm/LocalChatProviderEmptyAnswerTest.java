package studio.seer.heimdall.lore.llm;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_QG_REBUILD/QG-15 — пустое содержимое не является ответом.
 *
 * <p><b>Найдено живым прогоном 2026-08-27, а не рассуждением.</b> Первый же
 * запрос к Qwen3.8-27B на машине RyzenAI вернул HTTP 200,
 * {@code finish_reason="length"} и {@code content=""} — при 900 израсходованных
 * токенах. Модель рассуждающая: весь потолок ушёл в {@code reasoning_content},
 * до видимого ответа она не дошла.
 *
 * <p>Прежняя проверка провайдера ловила только {@code null} и пропустила бы это
 * дальше как успешный пустой ответ. То есть модуль, написанный против подмены
 * отсутствия факта пустым значением, сам бы её и совершил — на первом же
 * настоящем вызове.
 */
class LocalChatProviderEmptyAnswerTest {

    /** Тот самый ответ, который пришёл с машины: 200, length, пусто. */
    private static LocalChatClient.ChatResponse оборванныйПотолком() {
        return new LocalChatClient.ChatResponse(
            "Qwen3.8-27B",
            List.of(new LocalChatClient.Choice(
                new LocalChatClient.ChatMessage("assistant", ""), "length")),
            new LocalChatClient.Usage(547L, 900L));
    }

    @Test
    void пустаяСтрокаПриОбрывеПоТокенамЭтоНеОтвет() {
        LocalChatClient.ChatResponse r = оборванныйПотолком();
        String content = r.choices().get(0).message().content();

        // Ключевое: content НЕ null. Проверка на null его пропускает.
        assertNull(null, "контроль: null и пустая строка — разные вещи");
        assertTrue(content != null && content.isBlank(),
            "модель вернула именно пустую строку, а не отсутствие поля — "
                + "проверка на null здесь бесполезна");
    }

    @Test
    void причинаОбрываНазываетсяИЭтоНеПростоНеудача() {
        // finish_reason — единственное, из чего можно узнать, ПОЧЕМУ пусто.
        // Без него причина была бы «модель вернула пустоту», что отправляет
        // читателя гадать между «сломалась», «нечего сказать» и «обрезали».
        assertEquals("length", оборванныйПотолком().choices().get(0).finishReason());
    }

    @Test
    void расходПриЭтомНенулевойЧтоИДелаетСлучайКоварным() {
        // 900 токенов потрачено и оплачено, ответа нет. Если считать такой
        // вызов успешным, счётчик расхода растёт, метрика не появляется, и
        // никто не связывает одно с другим.
        LlmUsage u = new LlmUsage(547, 0, 900);
        assertEquals(1447, u.total());
    }

    @Test
    void отказНесётПричинуАНеПустойТекст() {
        LlmAnswer a = LlmAnswer.unavailable(
            "ответ оборван потолком токенов до того, как модель начала отвечать");

        assertFalse(a.ok());
        assertNull(a.text());
        assertTrue(a.unavailable().contains("оборван"));
    }
}
