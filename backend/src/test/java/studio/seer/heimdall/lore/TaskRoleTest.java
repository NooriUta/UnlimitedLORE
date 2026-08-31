package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Правила ролей на задаче (ADR-LORE-042).
 *
 * Проверяется не «работает ли код», а держатся ли РАЗЛИЧЕНИЯ, ради которых
 * роль стала ребром. Каждое из них однажды уже склеилось в свободном поле, и
 * склейка ничем не проявлялась.
 */
class TaskRoleTest {

    /**
     * reviewer и handoff — разные роли, и вердикт есть только у первого.
     *
     * Если handoff получит право на вердикт, «работу подхватили» станет
     * засчитываться как «работу проверили»: гейт приёмки закроется фактом, к
     * проверке отношения не имеющим. Именно так поле и работало — в нём эти
     * два смысла лежали вперемешку, и отличить их было нельзя.
     */
    @Test
    void verdictBelongsToReviewerOnly() {
        assertTrue(TaskRole.canGiveVerdict(TaskRole.REVIEWER));
        assertFalse(TaskRole.canGiveVerdict(TaskRole.HANDOFF),
            "handoff ничего не оценивал — вердикта у него быть не может");
        assertFalse(TaskRole.canGiveVerdict(TaskRole.EXECUTOR));
        assertFalse(TaskRole.canGiveVerdict(TaskRole.AUTHOR));
    }

    /** Один автор и один исполнитель; ревьюеров и передач бывает несколько. */
    @Test
    void singleHolderRolesAreExactlyAuthorAndExecutor() {
        assertTrue(TaskRole.SINGLE_HOLDER.contains(TaskRole.AUTHOR));
        assertTrue(TaskRole.SINGLE_HOLDER.contains(TaskRole.EXECUTOR));
        assertFalse(TaskRole.SINGLE_HOLDER.contains(TaskRole.REVIEWER),
            "ревью бывает двойным — это не толпа");
        assertFalse(TaskRole.SINGLE_HOLDER.contains(TaskRole.HANDOFF),
            "маршрут бывает цепочкой — это не толпа");
    }

    /**
     * Отказ обязан НАЗЫВАТЬ допустимое.
     *
     * Отказ без альтернатив заставляет вызывающего угадывать. Он и угадывал —
     * 73 раза, и каждый раз запись проходила, потому что поле принимало всё.
     */
    @Test
    void roleErrorListsWhatIsAllowed() {
        String msg = TaskRole.roleError("рецензент");
        for (String r : TaskRole.ALL) {
            assertTrue(msg.contains(r), "в отказе нет допустимого значения '" + r + "': " + msg);
        }
        assertTrue(msg.contains("reviewer") && msg.contains("handoff"),
            "отказ обязан объяснять разницу двух похожих ролей, иначе её снова склеят");
    }

    /** Занятую роль отказ называет по имени: иначе не отличить ошибку от гонки. */
    @Test
    void singleHolderErrorNamesTheCurrentHolder() {
        String msg = TaskRole.singleHolderError(TaskRole.EXECUTOR, "SPRINT_X/T-1", "AGENT-FULL-msbt0fed");
        assertTrue(msg.contains("SPRINT_X/T-1"), msg);
        assertTrue(msg.contains("AGENT-FULL-msbt0fed"), "не сказано, кто уже занимает роль: " + msg);
    }

    /**
     * Незаявленная личность: отказ отдаёт кандидатов, потому что список
     * выводится из графа и вызывающему неизвестен.
     */
    @Test
    void unknownIdentityErrorOffersCandidates() {
        String msg = TaskRole.unknownIdentityError("claude-печать",
            List.of("omiloreadmin", "AGENT-FULL-msbt0fed"));
        assertTrue(msg.contains("omiloreadmin"), msg);
        assertTrue(msg.contains("AGENT-FULL-msbt0fed"), msg);
    }

    /**
     * Пустой список кандидатов — ОТДЕЛЬНЫЙ случай, а не «никого не нашли».
     *
     * Пусто здесь означает «в проекте нет ни одной роли», то есть чинится
     * настройкой проекта, а не другим написанием имени. Утром 30.08.2026 таких
     * проектов было семь: не скажи мы этого прямо, агент искал бы ошибку в
     * имени, а она была в проекте.
     */
    @Test
    void emptyCandidatesExplainProjectNotName() {
        String msg = TaskRole.unknownIdentityError("кто-то", List.of());
        assertTrue(msg.contains("НЕ ОДНОЙ роли") || msg.contains("НЕТ НИ ОДНОЙ"),
            "пустой список обязан объясняться настройкой проекта: " + msg);
        assertTrue(msg.contains("projects_without_role"),
            "отказ обязан подсказать, чем это увидеть: " + msg);
    }

    /** Список ролей закрыт: новое значение — решение, а не правка строки. */
    @Test
    void roleVocabularyIsClosed() {
        assertEquals(4, TaskRole.ALL.size(),
            "роль добавили или убрали — это изменение модели, оно идёт через ADR-LORE-042");
    }
}
