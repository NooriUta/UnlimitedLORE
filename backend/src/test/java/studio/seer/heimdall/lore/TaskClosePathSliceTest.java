package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-CAL-START — решение D6 владелицы 14.11: «пока никаких правил,
 * давай соберём статистику прыжков». Срез {@code task_close_path}: строка на закрытую задачу —
 * момент закрытия, кто закрыл, сколько версий истории в рабочих статусах. Прыжок
 * (planned/todo → done без рабочего статуса) — {@code work_versions = 0}.
 *
 * <p>Раньше замер требовал history_task на КАЖДУЮ задачу (проба 13.11: 40 вызовов, выборка
 * перекошена одним пакетом). Теперь — один вызов с changed_from/changed_to по дню закрытия.
 */
class TaskClosePathSliceTest {

    private static String sql() {
        return LoreSlices.compose("task_close_path", Map.of()).sql();
    }

    @Test
    void oneRowPerTaskWhoseOpenVersionIsDone() {
        String s = sql();
        assertTrue(s.contains("FROM KnowTask WHERE out('HAS_STATE')[valid_to IS NULL][" + LoreSlices.DONE_STATUS_SQL + "].size() > 0"), s);
        assertTrue(s.contains("task_uid") && s.contains("AS sprint_id"), s);
    }

    @Test
    void closingMomentIsTheStatusMomentAndFeedsTheChangedRange() {
        String s = sql();
        assertTrue(s.contains(LoreSlices.STATUS_SINCE_SQL + " AS done_at"), "момент закрытия — момент статуса, правка заметки его не двигает: " + s);
        assertTrue(s.contains(LoreSlices.STATUS_SINCE_SQL + " AS changed_at"), "changed_from/changed_to режут по дню закрытия: " + s);
        assertTrue(s.contains("AS closed_by") && s.contains("AS closed_by_kind"), "пакет — много закрытий за секунды ОДНИМ актором: " + s);
    }

    @Test
    void workVersionsCountEveryWorkingStatusAndNothingElse() {
        String s = sql();
        int at = s.indexOf("AS work_versions");
        assertTrue(at > 0, s);
        String expr = s.substring(s.lastIndexOf("out('HAS_STATE')[", at), at);
        for (String canon : new String[]{"in_progress", "partial", "uat", "ready_for_deploy"})
            for (String p : LoreStatusVocabulary.prefixesOf(canon))
                assertTrue(expr.contains("LIKE '" + p + "%'"), canon + " (" + p + ") — рабочий статус: " + expr);
        // review — отдельным счётчиком: с WK-05 done только из review, иначе прыжок неотличим от работы.
        for (String canon : new String[]{"planned", "todo", "backlog", "done", "cancelled", "review"})
            assertFalse(expr.contains("LIKE '" + LoreStatusVocabulary.prefixesOf(canon).get(0) + "%'"),
                canon + " — не рабочий статус: " + expr);
        assertTrue(s.contains("[" + LoreStatusVocabulary.anySql("status_raw", "review") + "].size() AS review_versions"), s);
        assertTrue(s.contains("[version_kind IS NULL].size() AS status_versions"), "версии-правки текста не считаются: " + s);
        assertTrue(s.contains("bookkeeping"), "запись задним числом видна потребителю: " + s);
    }

    /**
     * Замер 25.11: 94% закрытий «с работой», но work_versions считает и 🚀/🧪 — версии ПРИЁМКИ.
     * Задача, прошедшая planned → ready_for_deploy → uat → done, даты начала не даёт, а цель
     * задачи — «у новых закрытых есть дата начала в ≥80%». Начало работы — первая версия
     * в 🔄/🟡 (in_progress/partial), отдельным счётчиком и моментом.
     */
    @Test
    void startIsTheFirstInProgressOrPartialVersionNotAcceptance() {
        String s = sql();
        int at = s.indexOf("AS start_versions");
        assertTrue(at > 0, "счётчик версий начала работы: " + s);
        String expr = s.substring(s.lastIndexOf("out('HAS_STATE')[", at), at);
        for (String canon : new String[]{"in_progress", "partial"})
            for (String p : LoreStatusVocabulary.prefixesOf(canon))
                assertTrue(expr.contains("LIKE '" + p + "%'"), canon + " (" + p + ") — начало работы: " + expr);
        for (String canon : new String[]{"uat", "ready_for_deploy", "review", "planned", "done"})
            assertFalse(expr.contains("LIKE '" + LoreStatusVocabulary.prefixesOf(canon).get(0) + "%'"),
                canon + " — приёмка/план, не начало работы: " + expr);
        String inWork = "out('HAS_STATE')[" + LoreStatusVocabulary.anySql("status_raw", "in_progress", "partial") + "]";
        assertTrue(s.contains(inWork + ".valid_from[0] AS started_at"),
            "started_at — момент ПЕРВОЙ версии в работе (порядок рёбер — порядок вставки): " + s);
    }

    @Test
    void sliceIsScopedByProject() {
        String s = LoreSlices.compose("task_close_path", Map.of("project", "NooriUta/UnlimitedLORE")).sql();
        assertTrue(s.contains("out('PART_OF').out('BELONGS_TO_PROJECT').slug CONTAINS :project"), s);
    }
}
