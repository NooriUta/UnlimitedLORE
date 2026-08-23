package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
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
    void классРаботыТеперьОбязателен() {
        // Решение владельца 2026-08-03: ADR-LORE-022 D3 разрешал пустой класс,
        // и цена оказалась в том, что «зачем-ось» INVEST считается на 2.3%
        // трудоёмкости. Проверка остаётся advisory — понижает счёт, не блокирует.
        var r = WorkQuality.evaluateTask("📋 PLANNED", 1.0, null,
            List.of("OMILORE"), List.of("proj"), null, null);
        assertTrue(find(r, "work_class").required(), "класс работы обязателен");
        assertFalse(find(r, "work_class").ok());
        assertTrue(r.score() < r.max(), "его отсутствие обязано снижать счёт");
    }

    @Test
    void заданныйКлассРаботыЗасчитывается() {
        var r = WorkQuality.evaluateTask("📋 PLANNED", 1.0, "jtd",
            List.of("OMILORE"), List.of("proj"), null, null);
        assertTrue(find(r, "work_class").ok());
    }

    // ── фаза ─────────────────────────────────────────────────────────────────

    @Test
    void полнаяФазаНабираетМаксимум() {
        var r = WorkQuality.evaluatePhase("Подготовка", "Что делаем и зачем", 1);
        assertEquals(r.max(), r.score());
        assertEquals("phase", r.kind());
    }

    @Test
    void безымяннаяФазаКраснеет() {
        // Фаза без названия — разделитель, а не этап: по строке отчёта
        // невозможно принять решение.
        var r = WorkQuality.evaluatePhase("  ", null, 1);
        assertFalse(find(r, "title").ok());
    }

    @Test
    void описаниеФазыТолькоПодсказка() {
        var r = WorkQuality.evaluatePhase("Подготовка", null, 1);
        assertFalse(find(r, "summary").required());
        assertEquals(r.max(), r.score(), "отсутствие описания не снижает счёт");
    }

    @Test
    void фазаБезПорядковогоНомераКраснеет() {
        var r = WorkQuality.evaluatePhase("Подготовка", "текст", null);
        assertFalse(find(r, "order_index").ok());
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

    // ── релиз ────────────────────────────────────────────────────────────────

    @Test
    void полныйРелизНабираетМаксимум() {
        var r = WorkQuality.evaluateRelease("v1.2.0", "## Что вошло\nПравки.",
            List.of("SPRINT_A"), List.of(362), List.of("NooriUta/UnlimitedLORE"));
        assertEquals(r.max(), r.score());
        assertEquals("release", r.kind());
    }

    @Test
    void релизБезСвязейКраснеетПоОбеимОсямРаздельно() {
        // Спринты и PR — два разных вызова release_link, и забывается обычно
        // первый. Общая проверка «связи есть» показывала бы зелёное при
        // половине работы.
        var r = WorkQuality.evaluateRelease("v1.2.0", "описание",
            List.of(), List.of(), List.of("proj"));
        assertFalse(find(r, "sprints_linked").ok());
        assertFalse(find(r, "prs_linked").ok());
    }

    @Test
    void релизСPRНоБезСпринтовВсёРавноНеполон() {
        var r = WorkQuality.evaluateRelease("v1.2.0", "описание",
            List.of(), List.of(362), List.of("proj"));
        assertFalse(find(r, "sprints_linked").ok(), "PR не компенсируют отсутствие спринтов");
        assertTrue(find(r, "prs_linked").ok());
    }

    @Test
    void релизБезОписанияКраснеет() {
        var r = WorkQuality.evaluateRelease("v1.2.0", "  ",
            List.of("S"), List.of(1), List.of("proj"));
        assertFalse(find(r, "description").ok(), "пробелы не описание");
    }

    // ── ADR ──────────────────────────────────────────────────────────────────

    /** Тело длиннее порога содержательности, со ссылкой на сущность корпуса. */
    private static String body(String head) {
        return head + ": развёрнутый текст, который заведомо длиннее порога в сто двадцать "
            + "символов, чтобы проверка содержательности видела разбор, а не отписку (ADR-LORE-014).";
    }

    @Test
    void полныйAdrНабираетМаксимум() {
        var r = WorkQuality.evaluateAdr("ACCEPTED", List.of("OMILORE"), List.of("proj"),
            true, body("контекст"), body("решение"), "последствия");
        assertEquals(r.max(), r.score());
        assertEquals("adr", r.kind());
    }

    @Test
    void adrБезРешенияКраснеет() {
        // ADR без раздела «решение» — заметка, а не решение.
        var r = WorkQuality.evaluateAdr("ACCEPTED", List.of("OMILORE"), List.of("proj"),
            true, body("контекст"), null, "последствия");
        assertFalse(find(r, "decision").ok());
    }

    @Test
    void уЧерновикаПоследствияИРазложениеТолькоПодсказки() {
        // PROPOSED — черновик: бывают ADR, у которых последствий честно нет, а
        // разложение на решения отдельный шаг. Требовать это при заведении
        // значит давить на самом хрупком этапе (ADR-LORE-039 §5).
        var r = WorkQuality.evaluateAdr("PROPOSED", List.of("OMILORE"), List.of("proj"),
            false, "контекст", "решение", null);
        assertFalse(find(r, "consequences").required());
        assertFalse(find(r, "decisions").required());
        assertFalse(find(r, "context_substantive").required(), "порог у черновика — подсказка");
        assertFalse(find(r, "traceability").required(), "трассируемость у черновика — подсказка");
        assertEquals(r.max(), r.score(), "подсказки не снижают счёт");
    }

    @Test
    void уПринятогоТеЖеПроверкиСтановятсяОбязательными() {
        // ACCEPTED — принятое правило: «принято» сказанное о заметке и есть та
        // куцость, ради которой заведён вес по статусу. Набор проверок ТОТ ЖЕ,
        // меняется знаменатель.
        var r = WorkQuality.evaluateAdr("ACCEPTED", List.of("OMILORE"), List.of("proj"),
            false, "контекст", "решение", null);
        assertTrue(find(r, "consequences").required());
        assertTrue(find(r, "decisions").required());
        assertTrue(find(r, "context_substantive").required());
        assertFalse(find(r, "context_substantive").ok(), "полторы строки — отписка");
        assertTrue(r.score() < r.max(), "куцый принятый ADR обязан покраснеть");
    }

    @Test
    void альтернативыОстаютсяПодсказкойДажеУПринятого() {
        // Бывают решения без развилки; требовать вымышленный второй вариант
        // значит поощрять выдумку.
        var r = WorkQuality.evaluateAdr("ACCEPTED", List.of("OMILORE"), List.of("proj"),
            true, body("контекст"), body("решение"), "последствия");
        assertFalse(find(r, "alternatives").required());
        assertEquals(r.max(), r.score(), "отсутствие альтернатив не снижает счёт");
    }

    @Test
    void supersededБезРебраSupersedesКраснеет() {
        // Статус «заменён» без ребра — утверждение о замене, которое нечем
        // проверить: цепочка решений обрывается.
        var r = WorkQuality.evaluateAdr("SUPERSEDED", List.of("OMILORE"), List.of("proj"),
            true, body("контекст"), body("решение"), "последствия", false);
        assertFalse(find(r, "supersedes_edge").ok());
        var ok = WorkQuality.evaluateAdr("SUPERSEDED", List.of("OMILORE"), List.of("proj"),
            true, body("контекст"), body("решение"), "последствия", true);
        assertTrue(find(ok, "supersedes_edge").ok());
    }

    @Test
    void проверкаЗаменыНеПоявляетсяУДругихСтатусов() {
        var r = WorkQuality.evaluateAdr("ACCEPTED", List.of("OMILORE"), List.of("proj"),
            true, body("контекст"), body("решение"), "последствия");
        assertNull(find(r, "supersedes_edge"));
    }

    // ── decision / spec / component / milestone / question ───────────────────

    @Test
    void решениеБезРодителяАдрКраснеет() {
        // Решение вне ADR не найти от него и оно не попадает в разбор на правила.
        var r = WorkQuality.evaluateDecision("accepted", body("правило"), false, null, null);
        assertFalse(find(r, "parent_adr").ok());
        assertEquals("decision", r.kind());
    }

    @Test
    void решениеИзОдногоЗаголовкаЭтоЯрлык() {
        var r = WorkQuality.evaluateDecision("accepted", "Кэшируем", true, null, null);
        assertTrue(find(r, "body").ok(), "тело непусто");
        assertFalse(find(r, "body_substantive").ok(), "но правилом это не назвать");
    }

    @Test
    void спекаБезСодержанияЭтоЗаглушка() {
        var r = WorkQuality.evaluateSpec("active", "Схема БД", null,
            List.of("OMILORE"), List.of("proj"), "1.0");
        assertFalse(find(r, "content").ok());
        assertEquals("spec", r.kind());
    }

    @Test
    void вехаБезЦелевойДатыКраснеет() {
        var r = WorkQuality.evaluateMilestone("M1", null, null);
        assertFalse(find(r, "target_date").ok());
        assertFalse(find(r, "sprints").required(), "спринты — подсказка");
    }

    @Test
    void вопросБезВладельцаКраснеет() {
        var r = WorkQuality.evaluateQuestion("Как быть?", "open", null, null, null);
        assertFalse(find(r, "owner").ok(), "без адресата вопрос не закрывается");
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
