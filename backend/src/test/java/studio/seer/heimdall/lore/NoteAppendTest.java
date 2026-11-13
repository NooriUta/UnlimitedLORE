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

    /**
     * Пункт 4 (content_hash) и основа пункта 3 (откат). sprint_set писал context/outcome только
     * в вершину, а хэш (LoreHashStamper) и перенос при смене статуса берут тела с ОТКРЫТОЙ
     * строки истории — там было пусто. Отсюда замер 06.11 по SPRINT_VIZ_EMBED: все ревизии
     * с context_md = null и одинаковым content_hash при 4819 знаках на вершине.
     */
    @Test
    void sprintTextsAreMirroredOntoTheOpenHistRowWhole() {
        LoreCommandClient.LoreCommand c = LoreSprintTaskResource.sprintHistMirror("SPRINT_X", "новый контекст", "итог");
        assertNotNull(c);
        assertTrue(c.command().startsWith("UPDATE KnowSprintHist SET"), c.command());
        assertTrue(c.command().contains("valid_to IS NULL"), "только открытая версия: " + c.command());
        assertTrue(c.command().contains("context_md = :ctx") && c.command().contains("outcome_md = :outcome"), c.command());
        assertEquals("SPRINT_X", c.params().get("sid"));
        assertEquals("новый контекст", c.params().get("ctx"));
        assertEquals("итог", c.params().get("outcome"));
    }

    @Test
    void mirrorCarriesTheUntouchedTextTooSoTheHashCoversBoth() {
        // Пустое второе поле зеркалится как есть (null), а не пропускается: иначе на строке
        // истории остался бы прежний текст, которого на вершине уже нет.
        LoreCommandClient.LoreCommand c = LoreSprintTaskResource.sprintHistMirror("SPRINT_X", "контекст", null);
        assertTrue(c.command().contains("outcome_md = :outcome"), c.command());
        assertTrue(c.params().containsKey("outcome"));
        assertNull(c.params().get("outcome"));
    }

    private static boolean has(Class<?> rec, String name) {
        return Arrays.stream(rec.getRecordComponents()).anyMatch(c -> c.getName().equals(name) && c.getType() == String.class);
    }
}
