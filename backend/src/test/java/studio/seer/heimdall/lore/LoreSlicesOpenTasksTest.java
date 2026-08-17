package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SE-01 (пожелание сессии UDWE/mig_gen, передано владельцем 2026-08-11/12):
 * `open_tasks` — облегчённая проекция задач без `note_md`, со встроенным
 * фильтром «не done и не cancelled» и узкими фильтрами по проекту/спринту/
 * компоненту/классу работы. Тест пинует SQL-композицию (чистая функция,
 * без БД) — то, что реально ломается тихо при следующей правке compose().
 */
class LoreSlicesOpenTasksTest {

    @Test
    void базоваяВыдачаИсключаетDoneИCancelled() {
        LoreSlices.Composed c = LoreSlices.compose("open_tasks", Map.of());
        assertTrue(c.sql().contains("NOT LIKE '✅%'"), "done обязан быть исключён");
        assertTrue(c.sql().contains("NOT LIKE '🚫%'"), "cancelled обязан быть исключён");
        assertTrue(c.sql().toLowerCase(java.util.Locale.ROOT).contains("note_md") == false,
            "note_md — то, из-за чего all_tasks раздувается; open_tasks не имеет права его нести");
    }

    @Test
    void фильтрПроектаДобавляетсяЧерезAndНеЛомаяБазовыйWhere() {
        LoreSlices.Composed c = LoreSlices.compose("open_tasks", Map.of("project", "AIDA/UnlimitedLORE"));
        assertTrue(c.sql().contains(" AND out('PART_OF').out('BELONGS_TO_PROJECT').slug CONTAINS :project"),
            "двойной хоп PART_OF -> BELONGS_TO_PROJECT, связка AND (базовый WHERE уже занят фильтром статуса)");
        assertEquals("AIDA/UnlimitedLORE", c.params().get("project"));
    }

    @Test
    void несколькоФильтровСразуНеДаютДвойнойWhere() {
        LoreSlices.Composed c = LoreSlices.compose("open_tasks",
            Map.of("project", "AIDA/UnlimitedLORE", "work_class", "enb"));
        // Ровно один литеральный "WHERE" — остальное связано через AND, иначе
        // невалидный SQL "... WHERE a WHERE b" (тот же класс дефекта, что уже
        // ловили на слайсе sprints до нормализации connector'а в compose()).
        long whereCount = c.sql().toUpperCase(java.util.Locale.ROOT).split(" WHERE ", -1).length - 1;
        assertEquals(1, whereCount, "connector обязан нормализоваться в AND, а не плодить WHERE");
        assertTrue(c.sql().contains("work_class = :work_class"));
    }

    @Test
    void неизвестныйПараметрОтклоняется() {
        assertThrows(IllegalArgumentException.class,
            () -> LoreSlices.compose("open_tasks", Map.of("note_md", "x")));
    }

    @Test
    void componentИSprintФильтрыКладутсяПравильнымиРёбрами() {
        LoreSlices.Composed c = LoreSlices.compose("open_tasks",
            Map.of("component", "OMILORE", "sprint", "SPRINT_X"));
        assertTrue(c.sql().contains("out('TAGGED_WITH').component_id CONTAINS :component"));
        assertTrue(c.sql().contains("out('PART_OF').sprint_id CONTAINS :sprint"));
    }
}
