package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-NOTE-APPEND · decision:D-2026-NOTE-APPEND-IS-WORTH-FIXING.
 * Слово владелицы 06.11.2026: «пусть уж заводит задачу а то все мучаются с этим
 * перезаписываниями».
 *
 * <p>note_md, context_md и outcome_md заменялись только целиком: чтобы дописать
 * абзац, поле передавали заново — Völva за день дважды перепечатала ~11 000 знаков,
 * координатор не смогла дописать замер в чужую заметку. Прежней версии нет нигде,
 * опечатка при перезаписи необратима.
 *
 * <p>Пункты 1 и 2 задачи: дописывание (пустое поле — это запись; разделитель —
 * пустая строка; одновременная передача поля и дописки — отказ, а не угадывание)
 * и возврат прежнего значения в ответе на запись.
 */
class NoteAppendTest {

    @Test
    void appendKeepsTheOldTextAndAddsTheNewAfterABlankLine() {
        assertEquals("A\n\nB", LoreSprintTaskResource.appendText("A", "B"));
        assertEquals("A\n\nB", LoreSprintTaskResource.appendText("A\n\n\n", "B"), "хвостовые переводы строк не копятся");
    }

    @Test
    void appendToAnEmptyFieldIsAPlainWrite() {
        assertEquals("B", LoreSprintTaskResource.appendText(null, "B"));
        assertEquals("B", LoreSprintTaskResource.appendText("   ", "B"));
    }

    @Test
    void fullValueAndAppendTogetherAreRefusedNotGuessed() {
        String r = LoreSprintTaskResource.appendConflict("note_md", "целиком", "note_append", "дописка");
        assertNotNull(r);
        assertTrue(r.contains("note_md") && r.contains("note_append"), r);
        assertNull(LoreSprintTaskResource.appendConflict("note_md", null, "note_append", "дописка"));
        assertNull(LoreSprintTaskResource.appendConflict("note_md", "целиком", "note_append", null));
    }

    @Test
    void requestsCarryTheAppendFields() {
        assertTrue(has(LoreSprintTaskResource.TaskEditRequest.class, "note_append"));
        assertTrue(has(LoreSprintTaskResource.SprintUpdateRequest.class, "context_append"));
        assertTrue(has(LoreSprintTaskResource.SprintUpdateRequest.class, "outcome_append"));
    }

    private static boolean has(Class<?> rec, String name) {
        return Arrays.stream(rec.getRecordComponents()).anyMatch(c -> c.getName().equals(name) && c.getType() == String.class);
    }
}
