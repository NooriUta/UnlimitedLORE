package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_QG_REBUILD/QG-07 — честный baseline: у метрики прогона есть «база» (отпечаток знаменателя:
 * состав выборки, фильтр, LIMIT), и сравнивать с прошлым прогоном можно только при совпадении базы.
 *
 * <p>Повод: {@code task_done_pct_avg} «упала» 99.1% → 78.1% без регресса — раньше считались 15 спринтов
 * ({@code LIMIT 15}), потом все 357 групп. Значение пришло без признака смены выборки, и сравнение
 * молча сопоставило несопоставимое. Здесь — серверная половина контракта: база доходит от входа до
 * хранения и до среза, который читает сравнивающий экран. Чистый JUnit, без Quarkus и базы.
 */
class QgMetricBasisTest {

    @Test
    void schemaDeclaresBasisOnRunMetric() {
        assertTrue(LoreSchemaMigrations.STEPS.stream()
                .flatMap(s -> s.sql().stream())
                .anyMatch(q -> q.replaceAll("\\s+", " ").contains("CREATE PROPERTY ClRoutineMetric.basis IF NOT EXISTS STRING")),
            "поле basis должно быть объявлено шагом миграции");
    }

    @Test
    void writerPersistsBasis() {
        assertTrue(LoreQgRunWriter.METRIC_UPSERT_SQL.contains("basis=:basis"), LoreQgRunWriter.METRIC_UPSERT_SQL);
        var m = new LoreQgResource.QGMetricEntry("task_done_pct_avg", 78.1, "pct", 90.0, "FAIL", null, null, null,
            "groups=357");
        Map<String, Object> p = LoreQgRunWriter.metricParams("run1", "qg-x", "2026-11-25", m, null);
        assertEquals("groups=357", p.get("basis"));
        assertEquals("run1_task_done_pct_avg", p.get("mid"));
    }

    /** Пустая строка — не база: иначе «   » и null дали бы разные базы и ложный разрыв ряда. */
    @Test
    void blankBasisIsNoBasis() {
        var m = new LoreQgResource.QGMetricEntry("k", 1.0, "count", 0.0, "FAIL", null, null, null, "  ");
        assertNull(LoreQgRunWriter.metricParams("r", "qg-x", "2026-11-25", m, null).get("basis"));
        var t = new LoreQgResource.QGMetricEntry("k", 1.0, "count", 0.0, "FAIL", null, null, null, " groups=15 ");
        assertEquals("groups=15", LoreQgRunWriter.metricParams("r", "qg-x", "2026-11-25", t, null).get("basis"));
    }

    @Test
    void runMetricsSliceReturnsBasis() {
        String sql = LoreSlices.compose("qg_run_metrics", Map.of("run_id", "r")).sql();
        assertTrue(sql.contains("basis"), sql);
    }
}
