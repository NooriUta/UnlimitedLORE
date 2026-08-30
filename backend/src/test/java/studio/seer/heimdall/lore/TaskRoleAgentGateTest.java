package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Гейт создания задачи для агента (решение владельца 30.08.2026):
 * «отсутствующие роли не записывать для агентов, а возвращать ошибку записи
 * задачи, пока не исправится».
 *
 * <p>Отказ, а не пометка в вердикте полноты. Вердикт советует, и это верно
 * там, где пропуск честнее выдумки — оценку в днях лучше не ставить, чем
 * поставить мусорную. С ролью наоборот: её не «не знают», её не пишут, потому
 * что можно не писать. Так и накопились 4114 значений при 438 неразбираемых —
 * по одной необязательной записи.
 *
 * <p>Проверяется чистая часть правила: сбор фактов из графа живёт в
 * {@link TaskRoleService}, а решение — здесь, и потому его видно тестом.
 */
class TaskRoleAgentGateTest {

    private static final List<String> KNOWN =
        List.of("omiloreadmin", "ivanovalex32", "AGENT-FULL-msbt0fed");

    /** Отказ вместо записи, и он называет ИМЕННО те роли, которых нет. */
    @Test
    void missingRolesRefuseTheWriteAndNameThem() {
        String why = gate(null, "AGENT-FULL-msbt0fed", KNOWN);
        assertNotNull(why, "задача без автора создалась бы молча");
        assertTrue(why.contains("author"), "не сказано, какой роли не хватает: " + why);
        assertTrue(why.contains("не создана"),
            "отказ обязан говорить, что записи НЕ БЫЛО: иначе он читается как предупреждение "
            + "при успешной записи — " + why);
    }

    /** Отказ отдаёт кандидатов: без них вызывающий угадает так же, как угадывал 73 раза. */
    @Test
    void refusalOffersCandidates() {
        String why = gate("", "", KNOWN);
        assertTrue(why.contains("omiloreadmin"), "в отказе нет списка допустимых: " + why);
        assertTrue(why.contains("author") && why.contains("executor"),
            "названа только одна из двух отсутствующих ролей: " + why);
    }

    /**
     * Пустой список кандидатов — другой отказ: чинится он настройкой проекта,
     * а не другим написанием имени.
     */
    @Test
    void emptyCandidatesPointAtTheProject() {
        String why = gate(null, null, List.of());
        assertTrue(why.contains("projects_without_role"),
            "не подсказано, чем увидеть проекты без ролей: " + why);
    }

    /**
     * Незаявленное написание отвергается ТЕМ ЖЕ правилом, что и запись роли.
     * Иначе задача создалась бы с именем, которое потом невозможно превратить
     * в ребро, — и разошлись бы два пути записи.
     */
    @Test
    void unknownSpellingIsRefusedToo() {
        String why = gate("omiloreadmin", "claude-печать", KNOWN);
        assertNotNull(why, "имя вне списка прошло бы в корпус");
        assertTrue(why.contains("claude-печать"), why);
    }

    /** Сырое, но однозначное написание проходит: сводит его таблица. */
    @Test
    void mappedSpellingPasses() {
        assertNull(gate("owner", "claude-full", KNOWN),
            "написание из таблицы сопоставления обязано проходить — иначе "
            + "канонического имени требовали бы от вызывающего");
    }

    @Test
    void bothRolesPresentAndKnownPasses() {
        assertNull(gate("omiloreadmin", "AGENT-FULL-msbt0fed", KNOWN));
    }

    /** Вызывается ТА ЖЕ функция, что и на пути записи, — не её копия. */
    private static String gate(String author, String executor, List<String> known) {
        return TaskRoleWriter.refuseCreate(author, executor, known);
    }
}
