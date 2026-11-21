package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Поля метрики гейта по спеке LORE_SCHEMA_V12_NEW_TYPES: threshold, unit, direction (gte · lte · eq),
 * current_value (последнее измерение, NULL если нет), status (pass · fail · unknown). Владелица 19–20.11.2026:
 * «доделать функции, чтобы все поля работали». Чистый JUnit, без базы.
 */
class QgMetricStateTest {

    @Test
    void порог_разбирается_в_направление_число_и_единицу() {
        assertEquals(new QgMetricState.Threshold("gte", 98.0, "%"), QgMetricState.parseThreshold("≥ 98%"));
        assertEquals(new QgMetricState.Threshold("gte", 80.0, "%"), QgMetricState.parseThreshold(">= 80%"));
        assertEquals(new QgMetricState.Threshold("lte", 200.0, "ms"), QgMetricState.parseThreshold("≤ 200 ms"));
        assertEquals(new QgMetricState.Threshold("lte", 5.0, "s"), QgMetricState.parseThreshold("< 5s"));
        assertEquals(new QgMetricState.Threshold("gte", 50.0, "MB/s"), QgMetricState.parseThreshold("> 50 MB/s"));
        assertEquals(new QgMetricState.Threshold("eq", 0.0, "count"), QgMetricState.parseThreshold("= 0 count"));
        // голое число — равенство: другого направления текст не называет
        assertEquals(new QgMetricState.Threshold("eq", 0.0, null), QgMetricState.parseThreshold("0"));
        assertEquals(new QgMetricState.Threshold("lte", 1.5, null), QgMetricState.parseThreshold("<= 1,5"));
    }

    @Test
    void порог_без_числа_не_выдумывается() {
        assertEquals(new QgMetricState.Threshold(null, null, null), QgMetricState.parseThreshold("все зелёные"));
        assertEquals(new QgMetricState.Threshold(null, null, null), QgMetricState.parseThreshold(null));
        assertEquals(new QgMetricState.Threshold(null, null, null), QgMetricState.parseThreshold("  "));
    }

    @Test
    void статус_по_порогу_и_направлению() {
        assertEquals("pass", QgMetricState.status("gte", 80.0, 80.0));
        assertEquals("pass", QgMetricState.status("gte", 80.0, 91.2));
        assertEquals("fail", QgMetricState.status("gte", 80.0, 79.9));
        assertEquals("pass", QgMetricState.status("lte", 200.0, 200.0));
        assertEquals("pass", QgMetricState.status("lte", 200.0, 10.0));
        assertEquals("fail", QgMetricState.status("lte", 200.0, 200.1));
        assertEquals("pass", QgMetricState.status("eq", 0.0, 0.0));
        assertEquals("fail", QgMetricState.status("eq", 0.0, 1.0));
    }

    @Test
    void нет_измерения_порога_или_направления_unknown_а_не_pass() {
        assertEquals("unknown", QgMetricState.status("gte", 80.0, null));
        assertEquals("unknown", QgMetricState.status("gte", null, 80.0));
        assertEquals("unknown", QgMetricState.status(null, 80.0, 80.0));
        assertEquals("unknown", QgMetricState.status("between", 80.0, 80.0));
    }

    @Test
    void короткий_код_метрики_из_ключа_строки_таблицы() {
        // metric_id пишет QualityGateParser: «{qg_id}:{ID строки}:{номер}»
        assertEquals("P-1", QgMetricState.rowCode("QG-HOUND-PERF:P-1:0"));
        assertEquals("INV-03", QgMetricState.rowCode("QG-X:INV-03:12"));
        assertNull(QgMetricState.rowCode("без-двоеточий"));
    }

    @Test
    void измерение_последнего_прогона_по_коду_или_имени_метрики() {
        List<Map<String, Object>> run = List.of(
            Map.of("metric_key", "p-1", "value", 97.5, "unit", "%", "status", "FAIL"),
            Map.of("metric_key", "Покрытие тестами", "value", 81.0, "unit", "%", "status", "PASS"),
            new java.util.HashMap<>(Map.of("metric_key", "INV-02", "status", "NOT_MEASURED")));
        assertEquals(97.5, QgMetricState.measured(run, "QG-1:P-1:0", "Доля успешных").value());
        assertEquals(81.0, QgMetricState.measured(run, "QG-1:C-1:1", "Покрытие тестами").value());
        // не измерено в прогоне — значения нет (не ноль)
        assertNull(QgMetricState.measured(run, "QG-1:INV-02:2", "x").value());
        // метрики нет в прогоне — значения нет
        assertNull(QgMetricState.measured(run, "QG-1:Z-9:3", "x"));
    }

    @Test
    void поля_метрики_целиком_порог_прогон_статус() {
        List<Map<String, Object>> run = List.of(Map.of("metric_key", "P-1", "value", 97.5, "unit", "%"));
        QgMetricState.Fields f = QgMetricState.fields("QG-1:P-1:0", "Доля", "≥ 98%", run);
        assertEquals("gte", f.direction());
        assertEquals("%", f.unit());
        assertEquals(97.5, f.currentValue());
        assertEquals("fail", f.status());

        QgMetricState.Fields none = QgMetricState.fields("QG-1:P-1:0", "Доля", "≥ 98%", List.of());
        assertNull(none.currentValue(), "прогонов нет — значения нет");
        assertEquals("unknown", none.status());
        assertEquals("%", none.unit(), "единица из порога и без прогона");

        // единица у порога не названа — берётся из прогона
        QgMetricState.Fields u = QgMetricState.fields("QG-1:P-1:0", "Доля", "<= 3",
            List.of(Map.of("metric_key", "P-1", "value", 2.0, "unit", "count")));
        assertEquals("count", u.unit());
        assertEquals("pass", u.status());
    }

    @Test
    void имя_прогона_гейта_из_текста_иначе_код_строчными() {
        assertEquals("qg-lore-schema", QgMetricState.routineOf("QG-LORE-SCHEMA", null));
        assertEquals("qg-docs", QgMetricState.routineOf("QG-X", "# Гейт\n**Routine:** `qg-docs`\n"));
    }
}
