package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Сторож: «день» в корпусе — UTC-день, как и моменты (LoreTimeFormat: DATETIME хранит
 * UTC wall clock). {@code LocalDate.now()} без зоны берёт зону МАШИНЫ.
 *
 * <p>Повод (14.11.2026): FreshnessChangedAtLiveDbTest краснел у admin-polish в двух
 * тестах в зависимости от часового пояса машины. Вопрос и сценарий пишут день
 * заведения ({@code opened_date}/{@code date_created}) через {@code LocalDate.now()},
 * а момент правки {@code updated_at} — через {@code Instant.now()} (UTC). На машине в
 * CET в 00:46 местного это день 14-го при моменте 23:46Z 13-го: день «позже» момента
 * и выигрывал максимум свежести ({@link LoreChangedAt#fold}). В CI (UTC) — никогда.
 * На проде (UTC) — тоже нет, но запись дня по зоне машины — тот же дефект для любого
 * развёртывания не в UTC.
 */
class UtcDayGuardTest {

    /** Вызов без аргумента — зона машины; {@code now(ZoneOffset.UTC)} / {@code now(clock)} годятся. */
    static final Pattern BARE_NOW = Pattern.compile("\\bLocal(Date|DateTime|Time)\\.now\\(\\s*\\)");

    static List<String> offenders(Path root) throws IOException {
        List<String> out = new ArrayList<>();
        try (Stream<Path> files = Files.walk(root)) {
            for (Path f : files.filter(p -> p.toString().endsWith(".java")).toList()) {
                List<String> lines = Files.readAllLines(f);
                for (int i = 0; i < lines.size(); i++) {
                    String l = lines.get(i).trim();
                    if (l.startsWith("//") || l.startsWith("*")) continue;
                    if (BARE_NOW.matcher(l).find()) out.add(root.relativize(f) + ":" + (i + 1) + "  " + l);
                }
            }
        }
        return out;
    }

    @Test
    void mainCodeTakesTheDayInUtc() throws IOException {
        List<String> bad = offenders(Path.of("src/main/java"));
        assertEquals(List.of(), bad, "день по зоне машины — пишите LocalDate.now(ZoneOffset.UTC):\n" + String.join("\n", bad));
    }

    /** Положительный контроль: шаблон ловит голый вызов и пропускает вызов с зоной. */
    @Test
    void patternCatchesBareNowOnly() {
        assertTrue(BARE_NOW.matcher("p.put(\"d\", LocalDate.now().toString());").find());
        assertTrue(BARE_NOW.matcher("java.time.LocalDate.now( ).toString()").find());
        assertTrue(BARE_NOW.matcher("LocalDateTime.now()").find());
        assertTrue(!BARE_NOW.matcher("LocalDate.now(ZoneOffset.UTC)").find());
        assertTrue(!BARE_NOW.matcher("LocalDate.now(clock)").find());
    }
}
