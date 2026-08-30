package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Правила назначения роли (ADR-LORE-042) и форма ответа (ADR-LORE-043).
 *
 * Каждая проверка здесь соответствует правилу, которого у свободного поля НЕ
 * БЫЛО — и отсутствие каждого стоило конкретных записей в корпусе.
 */
class TaskRoleWriterTest {

    private static final List<String> KNOWN =
        List.of("omiloreadmin", "ivanovalex32", "AGENT-FULL-msbt0fed");

    @Test
    void unknownIdentityIsRefusedWithCandidates() {
        var d = TaskRoleWriter.check(TaskRole.EXECUTOR, "SPRINT_X/T-1", "claude-печать",
            KNOWN, List.of());
        assertEquals(TaskRoleWriter.Verdict.REFUSE, d.verdict());
        assertTrue(d.message().contains("omiloreadmin"),
            "отказ обязан отдать кандидатов, иначе вызывающий угадает снова: " + d.message());
    }

    /**
     * Пустой список кандидатов — отдельный ответ, а не «никого не нашли».
     * Пусто означает «в проекте нет ни одной роли», и чинится настройкой.
     */
    @Test
    void emptyCandidatesPointAtTheProjectNotTheName() {
        var d = TaskRoleWriter.check(TaskRole.EXECUTOR, "SPRINT_X/T-1", "кто-то",
            List.of(), List.of());
        assertEquals(TaskRoleWriter.Verdict.REFUSE, d.verdict());
        assertTrue(d.message().contains("projects_without_role"),
            "не подсказано, чем увидеть проекты без ролей: " + d.message());
    }

    /** Тот же держатель — законное «ничего не изменилось», а не ошибка и не работа. */
    @Test
    void sameHolderIsUnchangedNotNoop() {
        var d = TaskRoleWriter.check(TaskRole.EXECUTOR, "SPRINT_X/T-1", "AGENT-FULL-msbt0fed",
            KNOWN, List.of("AGENT-FULL-msbt0fed"));
        assertEquals(TaskRoleWriter.Verdict.UNCHANGED, d.verdict());
        assertEquals("unchanged",
            TaskRoleWriter.describe(d, TaskRole.EXECUTOR, "AGENT-FULL-msbt0fed").get("outcome"));
    }

    /**
     * Смена исполнителя — это REPLACE, а не отказ.
     *
     * Отказать значило бы требовать снимать держателя отдельным вызовом, и
     * причина смены потерялась бы между двумя вызовами. Прежнее ребро
     * закрывается, а не стирается: «кто был» перестаёт исчезать.
     */
    @Test
    void changingTheSingleHolderReplacesAndNamesThePrevious() {
        var d = TaskRoleWriter.check(TaskRole.EXECUTOR, "SPRINT_X/T-1", "omiloreadmin",
            KNOWN, List.of("AGENT-FULL-msbt0fed"));
        assertEquals(TaskRoleWriter.Verdict.REPLACE, d.verdict());
        assertEquals("AGENT-FULL-msbt0fed", d.replaces());
        Map<String, Object> r = TaskRoleWriter.describe(d, TaskRole.EXECUTOR, "omiloreadmin");
        assertEquals("updated", r.get("outcome"));
        assertEquals("AGENT-FULL-msbt0fed", r.get("replaced"));
    }

    /** У ревьюеров и передач держателей может быть несколько — это не толпа. */
    @Test
    void multiHolderRolesAcceptASecondPerson() {
        var d = TaskRoleWriter.check(TaskRole.REVIEWER, "SPRINT_X/T-1", "ivanovalex32",
            KNOWN, List.of("omiloreadmin"));
        assertEquals(TaskRoleWriter.Verdict.CREATE, d.verdict(),
            "двойное ревью законно — единственным держателем ограничены только автор и исполнитель");
    }

    /**
     * Вердикт у handoff невозможен: он ничего не оценивал.
     * Разрешить его значило бы засчитывать «подхватил» за «проверил».
     */
    @Test
    void handoffCannotGiveAVerdict() {
        var d = TaskRoleWriter.checkVerdict(TaskRole.HANDOFF, "accepted");
        assertEquals(TaskRoleWriter.Verdict.REFUSE, d.verdict());
        assertTrue(d.message().contains("ничего не оценивал"), d.message());
    }

    /** Вердикт — закрытый список: свободный текст повторил бы историю ролей. */
    @Test
    void verdictVocabularyIsClosed() {
        assertEquals(TaskRoleWriter.Verdict.CREATE,
            TaskRoleWriter.checkVerdict(TaskRole.REVIEWER, "rework").verdict());
        var bad = TaskRoleWriter.checkVerdict(TaskRole.REVIEWER, "ну ок");
        assertEquals(TaskRoleWriter.Verdict.REFUSE, bad.verdict());
        assertTrue(bad.message().contains("accepted"), "в отказе нет допустимых: " + bad.message());
    }

    /** Отсутствие вердикта законно: место есть, обязанности пока нет. */
    @Test
    void missingVerdictIsNotAnError() {
        assertEquals(TaskRoleWriter.Verdict.UNCHANGED,
            TaskRoleWriter.checkVerdict(TaskRole.REVIEWER, null).verdict());
    }

    /**
     * Отказ описывается как noop с ПРИЧИНОЙ — центральное правило ADR-LORE-043.
     * Раньше на этом месте был бы ok:true и молчание.
     */
    @Test
    void refusalIsReportedAsNoopWithReason() {
        var d = TaskRoleWriter.check("рецензент", "SPRINT_X/T-1", "omiloreadmin", KNOWN, List.of());
        Map<String, Object> r = TaskRoleWriter.describe(d, "рецензент", "omiloreadmin");
        assertEquals("noop", r.get("outcome"));
        assertTrue(String.valueOf(r.get("reason")).contains("handoff"),
            "отказ по роли обязан объяснять разницу reviewer/handoff: " + r.get("reason"));
    }

    /** Сводка пакета несёт числа, и ноль отказов тоже показывается. */
    @Test
    void summaryAlwaysShowsRefusedEvenWhenZero() {
        var s = TaskRoleWriter.summarise(List.of(
            TaskRoleWriter.Decision.create(), TaskRoleWriter.Decision.unchanged()));
        assertEquals(1, s.get("created"));
        assertEquals(1, s.get("unchanged"));
        assertEquals(0, s.get("refused"));
        assertFalse(s.containsKey("refusals"), "пустой список причин не должен занимать место");
    }
}
