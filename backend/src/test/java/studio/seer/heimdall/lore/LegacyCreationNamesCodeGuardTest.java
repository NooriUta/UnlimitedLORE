package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-10 · «колонка пустая — удалить» (владелец 25.11.2026).
 *
 * <p>В базе из модели (1.18) свойств {@code date_created} и {@code created_date} нет: момент создания лежит в
 * {@code created_at}, а прежние имена в SQL переводил на лету {@link ModelSchemaAdapter}. Сторож: ни один путь
 * записи или чтения сервера к прежним именам как к КОЛОНКЕ не обращается. Имя ключа ответа и поля запроса
 * ({@code ... AS date_created}, {@code row.get("date_created")}, {@code req.date_created()}) — это контракт API
 * (SPEC-MINILORE-PHONE-API, параметры MCP), не колонка: оно остаётся.
 */
class LegacyCreationNamesCodeGuardTest {

    static final Pattern WORD = Pattern.compile("(?<![\\w])(date_created|created_date)(?![\\w])");

    /** Файлы истории старой схемы (ledger): миграции неизменяемы, их DDL описывает базу до 1.18. */
    static final Map<String, String> EXEMPT = Map.of(
        "LoreSchemaMigrations.java", "история миграций старой схемы (ledger) — неизменяема",
        "LoreSchemaInitializer.java", "начальная схема старой базы (ledger)",
        "LoreSchemaMigrationRunner.java", "разовые переносы старой базы (ledger) — читают её прежние имена");

    static List<String> violations() throws IOException {
        List<String> bad = new ArrayList<>();
        Path root = Path.of("src", "main", "java");
        try (Stream<Path> files = Files.walk(root)) {
            for (Path f : files.filter(p -> p.toString().endsWith(".java")).toList()) {
                if (EXEMPT.containsKey(f.getFileName().toString())) continue;
                List<String> lines = Files.readAllLines(f);
                for (int i = 0; i < lines.size(); i++) {
                    String line = lines.get(i);
                    String t = line.strip();
                    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
                    Matcher m = WORD.matcher(line);
                    while (m.find()) {
                        String left = line.substring(0, m.start());
                        String right = line.substring(m.end());
                        if (left.matches("(?is).*\\bAS\\s+$")) continue;                       // псевдоним — ключ ответа
                        boolean columnCall = left.matches(".*\\b(Field\\.(one|many)|changedAtSql)\\([^)]*$");
                        if (left.endsWith("\"") && right.startsWith("\"") && !columnCall) continue; // "date_created" — ключ строки/JSON
                        if (left.matches(".*\\bString\\s+$")) continue;                       // поле запроса API
                        if (left.endsWith(".") && right.startsWith("()")) continue;           // req.date_created()
                        int c = line.indexOf("//");
                        if (c >= 0 && c < m.start()) continue;                                // хвостовой комментарий
                        bad.add(f.getFileName() + ":" + (i + 1) + ": " + t);
                    }
                }
            }
        }
        return bad;
    }

    @Test
    void noServerPathAddressesLegacyCreationColumn() throws IOException {
        List<String> bad = violations();
        assertEquals(List.of(), bad, "путь записи/чтения обращается к колонке прежнего имени — канон created_at:\n  "
            + String.join("\n  ", bad));
    }

    @Test
    void newsFeedTakesCreationFromCreatedAt() {
        for (String id : List.of("timeline_adrs", "timeline_decisions")) {
            String sql = LoreSlices.get(id).baseSql();
            assertTrue(sql.contains("created_at AS date_created"), id + ": день создания в ленту — из created_at");
            assertFalse(WORD.matcher(sql.replace("AS date_created", "")).find(), id + ": прежнее имя как колонка: " + sql);
        }
    }

    // ── правка «Даты» ADR и решения ────────────────────────────────────────────────────────────────────

    static final Instant NOW = Instant.parse("2026-11-25T10:15:30Z");

    @Test
    void newRecordWithoutDateWritesCreatedAtMoment() {
        CreationMoment.Set s = CreationMoment.creationSet(true, null, NOW);
        assertEquals(", created_at=:created_at", s.sql());
        assertEquals(NOW.toString(), s.value());
    }

    @Test
    void newRecordWithPastDateWritesThatDayIntoCreatedAt() {
        CreationMoment.Set s = CreationMoment.creationSet(true, "2026-04-11", NOW);
        assertEquals(", created_at=:created_at", s.sql());
        assertEquals("2026-04-11", s.value());
    }

    @Test
    void editOfDateGoesToCreatedAt() {
        CreationMoment.Set s = CreationMoment.creationSet(false, "2026-05-01", NOW);
        assertEquals(", created_at=:created_at", s.sql());
        assertEquals("2026-05-01", s.value());
    }

    @Test
    void editWithoutDateLeavesCreatedAtAlone() {
        assertNull(CreationMoment.creationSet(false, null, NOW));
    }

    @Test
    void modelDateFieldOfAdrAndDecisionPointsAtCreatedAt() {
        // поле «Дата» паспорта ADR пишется в created_at; у решения — псевдоним date → created_at
        var adr = LoreRecordRegistry.get("adr").fields().stream().filter(f -> f.key().equals("date")).findFirst().orElseThrow();
        assertEquals("created_at", adr.write().field());
        assertEquals("created_at", LoreModelFile.content().aliases().get("decision").get("date"));
    }
}
