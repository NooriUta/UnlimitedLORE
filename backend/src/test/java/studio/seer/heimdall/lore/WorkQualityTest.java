package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Линтер полноты спринта и задачи — чистая функция, без БД.
 *
 * <p>Негативные кейсы здесь несут основную нагрузку. Позитивный сам по себе
 * ничего не доказывает: линтер, всегда возвращающий «всё хорошо», прошёл бы его
 * тоже. Проверять надо, что проверка КРАСНЕЕТ там, где должна, — иначе она
 * декоративна (урок DBR-08: индекс с одним документом из 6754 проходил проверку
 * «индекс существует»).
 */
class WorkQualityTest {

    private static WorkQuality.Finding find(WorkQuality.Result r, String code) {
        return r.findings().stream().filter(f -> f.code().equals(code)).findFirst().orElse(null);
    }

    // ── задача ───────────────────────────────────────────────────────────────

    @Test
    void полностьюЗаполненнаяЗадачаНабираетМаксимум() {
        var r = WorkQuality.evaluateTask("📋 PLANNED", 1.5, "jtd",
            List.of("OMILORE"), List.of("NooriUta/UnlimitedLORE"), null, null);
        assertEquals(r.max(), r.score(), "все обязательные проверки должны пройти");
        assertEquals("task", r.kind());
    }

    @Test
    void пустаяЗадачаКраснеетПоВсемЧетырёмПолям() {
        var r = WorkQuality.evaluateTask(null, null, null, null, null, null, null);
        assertEquals(0, r.score(), "не заполнено ничего — счёт нулевой");
        for (String code : List.of("status", "effort_days", "component", "project")) {
            assertFalse(find(r, code).ok(), code + " обязан покраснеть");
        }
    }

    @Test
    void нулеваяОценкаНеСчитаетсяОценкой() {
        // 0 неотличим от «забыл поставить» — а именно это забывание и ловим.
        var r = WorkQuality.evaluateTask("📋 PLANNED", 0.0, null,
            List.of("OMILORE"), List.of("proj"), null, null);
        assertFalse(find(r, "effort_days").ok(), "нулевая оценка не должна засчитываться");
    }

    @Test
    void компонентУнаследованныйОтСпринтаЗасчитывается() {
        // Задача в размеченном спринте компонент уже имеет — требовать своё
        // ребро значило бы заставлять дублировать разметку на каждой задаче.
        var r = WorkQuality.evaluateTask("📋 PLANNED", 1.0, null,
            List.of("OMILORE"), List.of("proj"), null, null);
        assertTrue(find(r, "component").ok());
    }

    @Test
    void пустойСписокРёберЭтоОтсутствиеСвязи() {
        // Траверс графа отдаёт пустой список, а не null — это «ребра нет».
        var r = WorkQuality.evaluateTask("📋 PLANNED", 1.0, null,
            List.of(), List.of(), null, null);
        assertFalse(find(r, "component").ok());
        assertFalse(find(r, "project").ok());
    }

    @Test
    void классРаботыСамПоСебеТолькоПодсказка() {
        // D3: work_class законно бывает пустым, штрафовать за это нельзя.
        var r = WorkQuality.evaluateTask("📋 PLANNED", 1.0, null,
            List.of("OMILORE"), List.of("proj"), null, null);
        assertFalse(find(r, "work_class").required(), "класс работы не обязателен");
        assertEquals(r.max(), r.score(), "его отсутствие не должно снижать счёт");
    }

    @Test
    void ucЗадачаБезРеализуемогоСценарияКраснеет() {
        var r = WorkQuality.evaluateTask("📋 PLANNED", 1.0, "uc",
            List.of("OMILORE"), List.of("proj"), null, null);
        assertNotNull(find(r, "realizes_uc"), "для uc проверка обязана появиться");
        assertFalse(find(r, "realizes_uc").ok());
        assertTrue(find(r, "realizes_uc").required());
    }

    @Test
    void enbЗадачаБезОбоснованияКраснеет() {
        var r = WorkQuality.evaluateTask("📋 PLANNED", 1.0, "enb",
            List.of("OMILORE"), List.of("proj"), null, null);
        assertFalse(find(r, "justified_by").ok());
    }

    @Test
    void проверкиСвязейНеПоявляютсяУЧужогоКласса() {
        // jtd не обязан нести ни REALIZES, ни JUSTIFIED_BY — лишняя красная
        // строка обесценила бы вердикт, приучив его игнорировать.
        var r = WorkQuality.evaluateTask("📋 PLANNED", 1.0, "jtd",
            List.of("OMILORE"), List.of("proj"), null, null);
        assertEquals(null, find(r, "realizes_uc"));
        assertEquals(null, find(r, "justified_by"));
    }

    // ── спринт ───────────────────────────────────────────────────────────────

    @Test
    void полностьюЗаполненныйСпринтНабираетМаксимум() {
        var r = WorkQuality.evaluateSprint("🟢 ACTIVE", List.of("proj"), List.of("OMILORE"),
            "2026-08-01", "2026-08-14", List.of("MS-1"));
        assertEquals(r.max(), r.score());
        assertEquals("sprint", r.kind());
    }

    @Test
    void однаПлановаяДатаБезВторойНеЗасчитывается() {
        // Одна дата не даёт ни длительности, ни места на доске плана —
        // а ради доски они и заполняются.
        var r = WorkQuality.evaluateSprint("🟢 ACTIVE", List.of("proj"), List.of("OMILORE"),
            "2026-08-01", null, null);
        assertFalse(find(r, "planned_dates").ok());
    }

    @Test
    void вехаУСпринтаТолькоПодсказка() {
        var r = WorkQuality.evaluateSprint("🟢 ACTIVE", List.of("proj"), List.of("OMILORE"),
            "2026-08-01", "2026-08-14", null);
        assertFalse(find(r, "milestone").required());
        assertEquals(r.max(), r.score(), "отсутствие вехи не снижает счёт");
    }

    @Test
    void пустойСпринтКраснеетПоВсемОбязательным() {
        var r = WorkQuality.evaluateSprint(null, null, null, null, null, null);
        assertEquals(0, r.score());
        for (String code : List.of("status", "project", "component", "planned_dates")) {
            assertFalse(find(r, code).ok(), code + " обязан покраснеть");
        }
    }
}
