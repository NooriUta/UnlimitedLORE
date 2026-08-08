package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Разрыв «заявлено против доставлено» — чистая функция, без БД.
 *
 * <p>Опорный кейс взят с натуры: {@code FEAT-VP-FIT} стояла {@code shipped} с
 * тремя пустыми осями доставки, и это нашлось глазами, а не системой. Тест
 * фиксирует, что теперь находится системой.
 */
class VpFitGapsTest {

    private static Map<String, Object> root(String id, Object claimedJobs, Object performedJobs,
                                            Object claimedPains, Object relievedPains,
                                            Object claimedGains, Object deliveredMeasured) {
        Map<String, Object> m = new HashMap<>();
        m.put("uc_id", id);
        m.put("title", "заголовок " + id);
        m.put("claimed_job_ids", claimedJobs);
        m.put("performed_job_ids", performedJobs);
        m.put("claimed_pain_ids", claimedPains);
        m.put("relieved_pain_ids", relievedPains);
        m.put("claimed_gain_ids", claimedGains);
        m.put("delivered_measured_gain_ids", deliveredMeasured);
        return m;
    }

    private static boolean has(List<VpFitGaps.Gap> gaps, String finding, String missing) {
        return gaps.stream().anyMatch(g -> g.finding().equals(finding) && g.missingId().equals(missing));
    }

    @Test
    void случайСНатурыКорневаяФичаБезЕдинойДоставки() {
        // FEAT-VP-FIT: заявлено по одному на каждой оси, доставлено ничего.
        var gaps = VpFitGaps.evaluate(List.of(root("FEAT-VP-FIT",
            List.of("JOB-DECIDE-SCOPE"), List.of(),
            List.of("PAIN-FIT-BLIND"), List.of(),
            List.of("GAIN-FIT-EVIDENCE"), List.of())));

        assertEquals(3, gaps.size(), "три оси — три дыры");
        assertTrue(has(gaps, "job_claimed_not_performed", "JOB-DECIDE-SCOPE"));
        assertTrue(has(gaps, "pain_claimed_not_relieved", "PAIN-FIT-BLIND"));
        assertTrue(has(gaps, "gain_claimed_not_delivered", "GAIN-FIT-EVIDENCE"));
    }

    @Test
    void полностьюЗамкнутыйКореньДырНеДаёт() {
        var gaps = VpFitGaps.evaluate(List.of(root("FEAT-OK",
            List.of("J1"), List.of("J1"),
            List.of("P1"), List.of("P1"),
            List.of("G1"), List.of("G1"))));
        assertTrue(gaps.isEmpty());
    }

    @Test
    void выгодаБезМетрикиНеЗасчитываетсяКакДоставленная() {
        // Ключевой инвариант ADR-032 §2: доставка без метрики fit не замыкает.
        // Считаем ТОЛЬКО delivered_measured — иначе прятали бы ровно то, ради
        // чего метрика введена.
        Map<String, Object> r = root("FEAT-X",
            List.of(), List.of(), List.of(), List.of(),
            List.of("G1"), List.of());
        r.put("delivered_gain_ids", List.of("G1"));   // доставлена, но БЕЗ метрики
        var gaps = VpFitGaps.evaluate(List.of(r));
        assertTrue(has(gaps, "gain_claimed_not_delivered", "G1"),
            "доставка без метрики не должна закрывать ось");
    }

    @Test
    void доставленоеБезЗаявкиТожеСигнал() {
        // Не ошибка, но и не норма: либо забыли заявку, либо сценарий делает
        // не то, ради чего заведён.
        var gaps = VpFitGaps.evaluate(List.of(root("FEAT-Y",
            List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of("G-UNCLAIMED"))));
        assertTrue(has(gaps, "gain_delivered_not_claimed", "G-UNCLAIMED"));
    }

    @Test
    void частичноеЗакрытиеПоказываетТолькоНедостающее() {
        var gaps = VpFitGaps.evaluate(List.of(root("FEAT-Z",
            List.of("J1", "J2"), List.of("J1"),
            List.of(), List.of(), List.of(), List.of())));
        assertEquals(1, gaps.size());
        assertTrue(has(gaps, "job_claimed_not_performed", "J2"));
        assertFalse(has(gaps, "job_claimed_not_performed", "J1"));
    }

    @Test
    void дублиВДоставкеНеПлодятДыр() {
        // Срез возвращает по ребру: три сценария, снимающих одну боль, дают
        // её id трижды. Множество это схлопывает.
        var gaps = VpFitGaps.evaluate(List.of(root("FEAT-D",
            List.of(), List.of(),
            List.of("P1"), List.of("P1", "P1", "P1"),
            List.of(), List.of())));
        assertTrue(gaps.isEmpty());
    }

    @Test
    void скалярВместоСпискаЧитаетсяКакОдинЭлемент() {
        // Траверс ArcadeDB отдаёт одиночное значение не списком.
        var gaps = VpFitGaps.evaluate(List.of(root("FEAT-S",
            "J1", "J1", null, null, null, null)));
        assertTrue(gaps.isEmpty());
    }

    // ── MT-04: веса ──────────────────────────────────────────────────────────

    @Test
    void существеннаяДыраПоднимаетсяНаверх() {
        // Порядок во входе обратный нужному — сортировка обязана его исправить.
        var gaps = VpFitGaps.evaluate(
            List.of(root("F", List.of(), List.of(), List.of(), List.of(),
                List.of("G-MINOR", "G-CORE"), List.of())),
            Map.of("G-MINOR", "unexpected", "G-CORE", "essential"), Map.of());

        assertEquals("G-CORE", gaps.get(0).missingId(), "essential обязана быть первой");
        assertTrue(gaps.get(0).essential());
        assertFalse(gaps.get(1).essential());
    }

    @Test
    void рангПопадаетВСтроку() {
        var gaps = VpFitGaps.evaluate(
            List.of(root("F", List.of(), List.of(), List.of(), List.of(),
                List.of("G1"), List.of())),
            Map.of("G1", "desired"), Map.of());
        assertEquals("desired", gaps.get(0).weight());
    }

    @Test
    void остраяБольСчитаетсяСущественной() {
        var gaps = VpFitGaps.evaluate(
            List.of(root("F", List.of(), List.of(), List.of("P1"), List.of(),
                List.of(), List.of())),
            Map.of(), Map.of("P1", "high"));
        assertTrue(gaps.get(0).essential());
    }

    @Test
    void невыполненнаяРаботаСущественнаВсегда() {
        // У работ своей шкалы в разрыве нет: если работу никто не выполняет,
        // линия не делает того, ради чего заявлена.
        var gaps = VpFitGaps.evaluate(
            List.of(root("F", List.of("J1"), List.of(), List.of(), List.of(),
                List.of(), List.of())),
            Map.of(), Map.of());
        assertTrue(gaps.get(0).essential());
    }

    @Test
    void неизвестныйРангНеДелаетДыруСущественной() {
        // Ранг не проставлен — повышать приоритет наугад нельзя: так
        // существенное потонет среди повышенного без причины.
        var gaps = VpFitGaps.evaluate(
            List.of(root("F", List.of(), List.of(), List.of(), List.of(),
                List.of("G1"), List.of())),
            Map.of(), Map.of());
        assertFalse(gaps.get(0).essential());
        assertEquals(null, gaps.get(0).weight());
    }

    // ── MT-02: покрытие INVEST ───────────────────────────────────────────────

    @Test
    void покрытиеСчитаетсяИПоШтукамИПоТрудоёмкости() {
        var rows = List.<Map<String, Object>>of(
            Map.of("work_class", "uc", "effort_days", 1.0),
            Map.of("work_class", "enb", "effort_days", 3.0),
            Map.of("effort_days", 96.0));               // без класса
        var c = VpFitGaps.coverage(rows);

        assertEquals(3, c.tasksTotal());
        assertEquals(2, c.tasksClassified());
        assertEquals(100.0, c.effortTotal(), 0.001);
        assertEquals(4.0, c.effortClassified(), 0.001);
        // Ровно та ловушка, ради которой задача заведена: по штукам покрытие
        // выглядит приличным, по трудоёмкости — нет.
        assertEquals(0.667, c.taskShare(), 0.01);
        assertEquals(0.04, c.effortShare(), 0.001);
    }

    @Test
    void пустойКлассНеСчитаетсяЗаданным() {
        var c = VpFitGaps.coverage(List.of(Map.of("work_class", "  ", "effort_days", 5.0)));
        assertEquals(0, c.tasksClassified());
    }

    @Test
    void пустойКорпусНеДелитНаНоль() {
        var c = VpFitGaps.coverage(List.of());
        assertEquals(0.0, c.taskShare(), 0.001);
        assertEquals(0.0, c.effortShare(), 0.001);
    }

    @Test
    void пустойВходНеПадает() {
        assertTrue(VpFitGaps.evaluate(null).isEmpty());
        assertTrue(VpFitGaps.evaluate(List.of()).isEmpty());
    }
}
