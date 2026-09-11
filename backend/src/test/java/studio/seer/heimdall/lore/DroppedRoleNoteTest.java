package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** AO-05: разбор блока V38 — дословно, только своя строка, метка в прозе не считается. */
class DroppedRoleNoteTest {

    private static final String BLOCK =
        "Что-то было раньше.\n\n"
        + DroppedRoleNote.MARKER + "\n"
        + "**Роли из снятых полей** (не сопоставлены с заявленными личностями, "
        + "сохранены при переходе на рёбра): author = rollout; executor = minilore-app; "
        + "reviewer = claude-full + соседняя сессия.";

    @Test
    void parsesAllRolesVerbatimInOrder() {
        List<DroppedRoleNote.Entry> e = DroppedRoleNote.parse(BLOCK);
        assertEquals(3, e.size());
        assertEquals(new DroppedRoleNote.Entry("author", "rollout"), e.get(0));
        assertEquals(new DroppedRoleNote.Entry("executor", "minilore-app"), e.get(1));
        // составное значение — ДОСЛОВНО, включая «+» и второго участника
        assertEquals(new DroppedRoleNote.Entry("reviewer", "claude-full + соседняя сессия"), e.get(2));
    }

    @Test
    void markerQuotedInProseIsNotABlock() {
        // Ровно тот случай, что дал «124 против 123»: метка упомянута в тексте
        // задачи, а блока V38 в этом примечании нет.
        String prose = "Я искала примечания по подстроке `" + DroppedRoleNote.MARKER
            + "`, а не по самому блоку. author = кто-то.";
        assertTrue(DroppedRoleNote.parse(prose).isEmpty());
    }

    @Test
    void unknownRoleAndEmptyValueAreSkipped() {
        String note = DroppedRoleNote.MARKER + "\n"
            + "**Роли из снятых полей** (…): owner = alexa; executor = ; author = ui-design.";
        List<DroppedRoleNote.Entry> e = DroppedRoleNote.parse(note);
        assertEquals(List.of(new DroppedRoleNote.Entry("author", "ui-design")), e);
    }

    @Test
    void nullAndBlankGiveEmpty() {
        assertTrue(DroppedRoleNote.parse(null).isEmpty());
        assertTrue(DroppedRoleNote.parse("   ").isEmpty());
        assertTrue(DroppedRoleNote.parse("обычное примечание без блока").isEmpty());
    }

    @Test
    void markerOnLastLineWithoutHeadingIsEmpty() {
        assertTrue(DroppedRoleNote.parse("текст\n" + DroppedRoleNote.MARKER).isEmpty());
        assertTrue(DroppedRoleNote.parse(DroppedRoleNote.MARKER + "\nне заголовок: author = x").isEmpty());
    }
}
