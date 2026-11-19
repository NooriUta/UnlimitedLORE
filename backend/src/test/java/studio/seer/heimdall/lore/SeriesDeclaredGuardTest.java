package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Дефект 1.18 (19.11.2026): ряды {@code AgentActionLog} (журнал действий, V86) и {@code MetricSnapshot} (метрики,
 * ARC-02) заводились только шагами старой схемы. На базе, собранной из модели 1.18, шаги V не идут — рядов не было,
 * запись журнала действий терялась (WARN «точка … не записана»), «Журнал действий» был пуст.
 *
 * <p>Сторож: каждый {@code CREATE TIMESERIES TYPE} в коде сервера объявлен в разделе {@code series} модели — с тем же
 * моментом и тем же составом и порядком тегов и полей (ряд ArcadeDB запечатан: столбец не добавить после создания,
 * а запись с необъявленным столбцом база отклоняет). Новый ряд без объявления в модели не попадёт в базу из модели.
 */
class SeriesDeclaredGuardTest {

    /** Ряд в коде: момент, теги и поля в порядке DDL. */
    record CodeSeries(String file, String ts, Map<String, String> tags, Map<String, String> fields) {}

    // Склейка строк Java («…" + "…») снимается до разбора, поэтому DDL, разнесённый на строки, читается целиком.
    private static final Pattern GLUE = Pattern.compile("\"\\s*\\+\\s*\"");
    private static final Pattern DDL = Pattern.compile(
        "CREATE TIMESERIES TYPE\\s+(\\w+)(?:\\s+IF NOT EXISTS)?\\s+TIMESTAMP\\s+`?(\\w+)`?\\s+TAGS\\s*\\(([^)]*)\\)(?:\\s*FIELDS\\s*\\(([^)]*)\\))?");
    private static final Pattern COLUMN = Pattern.compile("`?(\\w+)`?\\s+([A-Z]+)");

    static Map<String, List<CodeSeries>> codeSeries() throws IOException {
        Map<String, List<CodeSeries>> out = new TreeMap<>();
        try (Stream<Path> files = Files.walk(Path.of("src", "main", "java"))) {
            for (Path f : (Iterable<Path>) files.filter(p -> p.toString().endsWith(".java"))::iterator) {
                String src = GLUE.matcher(Files.readString(f, StandardCharsets.UTF_8)).replaceAll("");
                Matcher m = DDL.matcher(src);
                while (m.find())
                    out.computeIfAbsent(m.group(1), k -> new ArrayList<>())
                        .add(new CodeSeries(f.getFileName().toString(), m.group(2), cols(m.group(3)), cols(m.group(4))));
            }
        }
        return out;
    }

    private static Map<String, String> cols(String list) {
        Map<String, String> out = new LinkedHashMap<>();
        if (list == null) return out;
        Matcher c = COLUMN.matcher(list);
        while (c.find()) out.put(c.group(1), c.group(2));
        return out;
    }

    @Test
    void каждый_ряд_в_коде_сервера_объявлен_в_модели_тем_же_составом() throws Exception {
        Map<String, LoreModelSeries.Series> model =
            LoreModelFile.parse(LoreModelFileTest.read(LoreModelFileTest.CANON)).series();
        Map<String, List<CodeSeries>> code = codeSeries();
        assertTrue(code.containsKey("AgentActionLog") && code.containsKey("MetricSnapshot"),
            "положительный контроль: разбор видит ряды кода — " + code.keySet());
        List<String> bad = new ArrayList<>();
        code.forEach((name, defs) -> {
            LoreModelSeries.Series s = model.get(name);
            if (s == null) { bad.add(name + " (" + defs.get(0).file() + "): ряда нет в series модели"); return; }
            for (CodeSeries d : defs) {
                if (!d.ts().equals(s.timestamp())) bad.add(name + " (" + d.file() + "): момент " + d.ts() + ", в модели " + s.timestamp());
                if (!List.copyOf(d.tags().entrySet()).equals(List.copyOf(s.tags().entrySet())))
                    bad.add(name + " (" + d.file() + "): теги " + d.tags() + ", в модели " + s.tags());
                if (!List.copyOf(d.fields().entrySet()).equals(List.copyOf(s.fields().entrySet())))
                    bad.add(name + " (" + d.file() + "): поля " + d.fields() + ", в модели " + s.fields());
            }
        });
        assertTrue(bad.isEmpty(), "ряд сервера не объявлен в модели 1.18 (shared/model/lore-model.json, series):\n  "
            + String.join("\n  ", bad));
    }

    @Test
    void ddl_журнала_действий_из_модели_совпадает_с_V86() throws Exception {
        LoreModelSeries.Series s = LoreModelFile.parse(LoreModelFileTest.read(LoreModelFileTest.CANON)).series().get("AgentActionLog");
        assertEquals(AgentActionLog.DDL, LoreModelSeries.ddl("AgentActionLog", s));
    }

    @Test
    void сторож_ловит_необъявленный_ряд() {
        // отрицательный контроль разбора: склеенный DDL без IF NOT EXISTS читается целиком
        Matcher m = DDL.matcher(GLUE.matcher("\"CREATE TIMESERIES TYPE Foo \" + \"TIMESTAMP ts \" + \"TAGS (a STRING) \" + \"FIELDS (v DOUBLE)\"").replaceAll(""));
        assertTrue(m.find());
        assertEquals("Foo", m.group(1));
        assertEquals(Map.of("a", "STRING"), cols(m.group(3)));
        assertEquals(Map.of("v", "DOUBLE"), cols(m.group(4)));
    }
}
