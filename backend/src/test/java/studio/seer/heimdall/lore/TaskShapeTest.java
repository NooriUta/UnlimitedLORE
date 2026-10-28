package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** MT-TASK-SHAPE: скелет и сложность задачи из текста — без базы. */
class TaskShapeTest {

    private static List<String> codes(TaskShape.Shape s) {
        return s.recommendations().stream().map(TaskShape.Recommendation::code).toList();
    }

    /** Одношаговая dev-задача без заметки: все подсказки скелета на месте. */
    @Test
    void oneLinerGetsSkeletonHints() {
        var s = TaskShape.analyze("Добавить outcome в ответ", null, "dev", 0.5, "📋 PLANNED", 1L);
        assertEquals(0, s.steps());
        assertEquals("S", s.complexity());
        assertTrue(codes(s).containsAll(List.of("steps", "verify", "test")), codes(s).toString());
    }

    /** Хорошо разложенная задача — без подсказок скелета. */
    @Test
    void wellShapedTaskHasNoSkeletonHints() {
        String note = """
            ## Повод
            Срез отдаёт пусто.
            ## Сделать
            1. Падающий тест на compose.
            2. Правка слайса.
            3. Проверка на стенде.
            ## Как проверять
            Слайс отдаёт строки, тест зелёный.
            """;
        var s = TaskShape.analyze("Слайс specs: фильтр project", note, "dev", 0.25, "📋 PLANNED", 1L);
        assertTrue(s.steps() >= 3);
        assertTrue(s.why());
        assertTrue(s.verify());
        assertFalse(codes(s).contains("steps"));
        assertFalse(codes(s).contains("verify"));
        assertFalse(codes(s).contains("test"));
    }

    /** Длинная заметка при оценке 0,5 — эпик; класс не сходится с оценкой. */
    @Test
    void longNoteWithSmallEstimateIsEpic() {
        String note = "Повод. Бэкенд java, mcp-server, ui .tsx, миграция схемы, прод-данные. "
            + "x".repeat(3500);
        var s = TaskShape.analyze("Большая задача", note, "dev", 0.5, "📋 PLANNED", 1L);
        assertTrue(codes(s).contains("epic"), codes(s).toString());
        assertTrue(List.of("L", "XL").contains(s.complexity()), s.complexity() + " " + s.factors());
        assertEquals(Boolean.FALSE, s.estimateFits());
        assertTrue(codes(s).contains("estimate"));
    }

    /** До часа и без шагов — слить в чек-лист соседней. */
    @Test
    void tinyTaskWithoutStepsShouldMerge() {
        var s = TaskShape.analyze("Поправить подпись", "подпись кнопки", "design", 0.125, "📋 PLANNED", 1L);
        assertTrue(codes(s).contains("merge"));
    }

    /** partial дольше 14 дней — выделить остаток; 3 дня — рано. */
    @Test
    void stalePartialOnlyAfterThreshold() {
        assertTrue(codes(TaskShape.analyze("x", "y", "dev", 1.0, "🟡 PARTIAL", 30L)).contains("stale_partial"));
        assertFalse(codes(TaskShape.analyze("x", "y", "dev", 1.0, "🟡 PARTIAL", 3L)).contains("stale_partial"));
        assertFalse(codes(TaskShape.analyze("x", "y", "dev", 1.0, "🟡 PARTIAL", null)).contains("stale_partial"));
    }

    /** ops без пробы — подсказка; с curl — нет. */
    @Test
    void opsNeedsProbe() {
        assertTrue(codes(TaskShape.analyze("Перезапуск", "рестарт сервиса", "ops", 0.25, null, null)).contains("probe"));
        assertFalse(codes(TaskShape.analyze("Перезапуск", "после рестарта curl /health", "ops", 0.25, null, null))
            .contains("probe"));
    }

    /** Без оценки сверять не с чем — estimate_fits отсутствует, подсказки estimate нет. */
    @Test
    void noEstimateNoFitVerdict() {
        var s = TaskShape.analyze("x", "y", "dev", null, null, null);
        assertNull(s.estimateFits());
        assertFalse(codes(s).contains("estimate"));
        assertFalse(s.toMap().containsKey("estimate_fits"));
    }

    /** MT-TASK-SHAPE-2: шаги с жирным номером и «Шаг N» — тоже шаги. */
    @Test
    void boldAndNamedStepsAreSteps() {
        String note = """
            **1. Падающий тест.** Пишем.
            - **2.** Правка.
            **Шаг 3** — проверка на стенде.
            ### 4. Отчёт
            """;
        assertEquals(4, TaskShape.analyze("x", note, "dev", 0.5, null, null).steps());
    }

    /** Заметки, записанные с буквальным «\\n» вместо переноса, — шаги видны. */
    @Test
    void literalBackslashNIsALineBreak() {
        String note = "Повод: x.\\n\\n1. Тест.\\n2. Правка.\\n3. Проверка.";
        assertEquals(3, TaskShape.analyze("x", note, "dev", 0.5, null, null).steps());
    }

    /** Обзор и итог не делают задачу сложнее: факторы ищутся вне них. */
    @Test
    void factorsIgnoreContextAndResultSections() {
        String note = """
            ## Контекст
            Срез по java, mcp-server, ui .tsx, миграции схемы, docker, прод-данным.
            ## Сделать
            1. Подпись кнопки.
            2. Проверка глазами.
            ## Итог
            Сделано в LorePage.tsx, a.java, b.java, c.ts, d.ts, e.yml.
            """;
        var s = TaskShape.analyze("Подпись", note, "design", 0.125, null, null);
        assertEquals("S", s.complexity(), s.factors().toString());
    }

    /** Жирная метка «**Проблема:** …» — тоже контекстный раздел. */
    @Test
    void boldLabelContextIsSkipped() {
        String note = "**Проблема:** на проде бэкфилл java + ui .tsx + docker.\n\n"
            + "**Решение:** поправить подпись.\n";
        var s = TaskShape.analyze("Подпись", note, "design", 0.125, null, null);
        assertEquals("S", s.complexity(), s.factors().toString());
    }

    /** Гипотеза + решение владельца + прод поднимают класс. */
    @Test
    void riskFactorsRaiseClass() {
        var s = TaskShape.analyze("x", "Гипотеза, не подтверждено. Нужно решение владельца. Бэкфилл на проде.",
            "ops", 0.25, null, null);
        assertTrue(s.points() >= 4, s.factors().toString());
        assertEquals(Boolean.FALSE, s.estimateFits());
    }
}
