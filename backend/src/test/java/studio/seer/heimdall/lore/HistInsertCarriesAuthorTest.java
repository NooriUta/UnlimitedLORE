package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-12 — сторож правила «каждая новая версия истории
 * несёт автора».
 *
 * <p>Баг был не в одном месте: вставок {@code INSERT INTO Know…Hist} полтора десятка
 * в разных ресурсах, и ни одна не писала «кто». Чинить точечно — значит, что
 * следующая новая вставка снова пойдёт без автора, и узнаем об этом через неделю
 * по ленте с «неизвестно». Поэтому правило проверяется по исходникам: любая вставка
 * в Hist-тип (литералом или через переменную типа) в пределах своего оператора обязана
 * содержать {@code ChangeAuthor.SET_SQL} либо явные {@code changed_by_kind}.
 *
 * <p>Исключения — только DDL/миграции (там не вставляют версии от имени вызывающего).
 */
class HistInsertCarriesAuthorTest {

    private static final Path SRC = Path.of("src/main/java/studio/seer/heimdall/lore");

    /** Файлы схемы и миграций: создают типы и чинят данные, версий от вызывающего не открывают. */
    private static final Set<String> EXEMPT = Set.of(
        "LoreSchemaInitializer.java", "LoreSchemaMigrations.java", "LoreSchemaMigrationRunner.java");

    /** Вставка в Hist: литерал {@code INSERT INTO KnowXHist} или {@code "INSERT INTO ").append(<hist>)}. */
    static final Pattern HIST_INSERT = Pattern.compile(
        "INSERT INTO (Know\\w*Hist\\b|\"\\s*\\)\\s*\\.append\\(\\s*\\w*[hH]ist\\w*)");

    /** Конец оператора вставки: следующий оператор скрипта (ребро HAS_STATE/UPDATE) или 900 символов. */
    private static final Pattern NEXT_STATEMENT = Pattern.compile("CREATE EDGE|\"UPDATE |INSERT INTO ");

    /** Нарушения в одном исходнике: «файл:строка». Видимость пакетная — для положительного контроля. */
    static List<String> violations(String file, String src) {
        List<String> out = new ArrayList<>();
        Matcher m = HIST_INSERT.matcher(src);
        while (m.find()) {
            int start = m.start();
            int end = Math.min(src.length(), start + 900);
            Matcher n = NEXT_STATEMENT.matcher(src).region(m.end(), end);
            if (n.find()) end = n.start();
            String stmt = src.substring(start, end);
            if (!stmt.contains("ChangeAuthor.SET_SQL") && !stmt.contains("changed_by_kind")) {
                int line = 1 + (int) src.substring(0, start).chars().filter(c -> c == '\n').count();
                out.add(file + ":" + line + "  " + m.group());
            }
        }
        return out;
    }

    @Test
    void everyHistInsertCarriesTheAuthor() throws IOException {
        List<String> bad = new ArrayList<>();
        int seen = 0;
        try (Stream<Path> files = Files.list(SRC)) {
            for (Path p : files.filter(f -> f.toString().endsWith(".java")).sorted().toList()) {
                String name = p.getFileName().toString();
                if (EXEMPT.contains(name)) continue;
                String src = Files.readString(p, StandardCharsets.UTF_8);
                Matcher m = HIST_INSERT.matcher(src);
                while (m.find()) seen++;
                bad.addAll(violations(name, src));
            }
        }
        // Контроль разбора: сторож, не нашедший ни одной вставки, зелёный на пустом множестве.
        assertTrue(seen >= 14, "сторож нашёл всего " + seen + " вставок Hist — разбор сломан?");
        assertTrue(bad.isEmpty(), "вставки версий истории без автора (S2-12: дописать "
            + "ChangeAuthor.SET_SQL + author.bind(params)):\n  " + String.join("\n  ", bad));
    }

    // ── положительный контроль: сторож ловит вставку без автора ──────────────

    @Test
    void guardCatchesLiteralInsertWithoutAuthor() {
        String src = "x(\"INSERT INTO KnowTaskHist SET state_uid=:nsid, valid_from=:now;\" +\n"
            + "  \"CREATE EDGE HAS_STATE FROM (SELECT FROM KnowTask) TO (SELECT FROM KnowTaskHist)\");";
        assertEquals(1, violations("Probe.java", src).size());
    }

    @Test
    void guardCatchesDynamicInsertWithoutAuthor() {
        String src = "script.append(\"INSERT INTO \").append(histType)\n"
            + "  .append(\" SET state_uid = :nsid, status_raw = :ns, valid_from = :now;\")\n"
            + "  .append(\"CREATE EDGE HAS_STATE FROM x TO y;\");";
        assertEquals(1, violations("Probe.java", src).size());
    }

    @Test
    void guardDoesNotBorrowAuthorFromTheNextStatement() {
        // Автор у СЛЕДУЮЩЕЙ вставки не засчитывается предыдущей.
        String src = "\"INSERT INTO KnowADRHist SET state_uid=:a, valid_from=:now;\" +\n"
            + "\"CREATE EDGE HAS_STATE FROM x TO y;\" +\n"
            + "\"INSERT INTO KnowSpecHist SET state_uid=:b, valid_from=:now\" + ChangeAuthor.SET_SQL";
        List<String> v = violations("Probe.java", src);
        assertEquals(1, v.size(), v.toString());
        assertTrue(v.get(0).contains("KnowADRHist"), v.toString());
    }

    /** Схема: поля автора объявлены на КАЖДОЙ цепочке SCD2 (V66), не только на тех, что пишут REST-пути. */
    @Test
    void schemaDeclaresAuthorOnEveryHistChain() {
        LoreSchemaMigrations.Step s = LoreSchemaMigrations.STEPS.stream()
            .filter(x -> "hist_change_author".equals(x.name())).findFirst()
            .orElseThrow(() -> new AssertionError("нет шага схемы hist_change_author (S2-12)"));
        assertEquals(66, s.version(), "номер шага — сразу после батча S2 (V65)");
        assertEquals(17, s.compatMajor(), "аддитивно, major не поднимается");
        for (String hist : LoreSlices.HIST_PARENT.keySet()) {
            assertTrue(s.sql().contains("CREATE PROPERTY " + hist + ".changed_by IF NOT EXISTS STRING"), hist);
            assertTrue(s.sql().contains("CREATE PROPERTY " + hist + ".changed_by_kind IF NOT EXISTS STRING"), hist);
        }
    }

    @Test
    void insertWithAuthorPasses() {
        String src = "\"INSERT INTO KnowTaskHist SET state_uid=:nsid, valid_from=:now\" + ChangeAuthor.SET_SQL + \";\"";
        assertTrue(violations("Probe.java", src).isEmpty());
    }
}
