package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * ADR-LORE-023, SV-02/03: инварианты реестра миграций — чистые, без БД.
 * Контракт: версии уникальны и строго возрастают; checksum детерминирован
 * (дрейф выпущенного шага ловится на старте); Java-шаги наравне с SQL.
 */
class LoreSchemaMigrationsTest {

    @Test
    void versionsAreUniqueAndStrictlyIncreasing() {
        Set<Integer> seen = new HashSet<>();
        int prev = 0;
        for (LoreSchemaMigrations.Step s : LoreSchemaMigrations.STEPS) {
            assertTrue(seen.add(s.version()), "дубль версии V" + s.version());
            assertTrue(s.version() > prev, "версии не по порядку: V" + s.version() + " после V" + prev);
            prev = s.version();
        }
    }

    @Test
    void codeVersionIsTheMax() {
        assertEquals(
            LoreSchemaMigrations.STEPS.get(LoreSchemaMigrations.STEPS.size() - 1).version(),
            LoreSchemaMigrations.codeVersion());
    }

    @Test
    void checksumIsDeterministicAndSensitive() {
        LoreSchemaMigrations.Step s = LoreSchemaMigrations.STEPS.get(0);
        assertEquals(s.checksum(), s.checksum(), "checksum обязан быть детерминированным");
        LoreSchemaMigrations.Step tampered =
            new LoreSchemaMigrations.Step(s.version(), s.name(), java.util.List.of("CREATE VERTEX TYPE Evil"));
        assertFalse(s.checksum().equals(tampered.checksum()),
            "изменённый SQL обязан менять checksum — на этом стоит дрейф-гард");
    }

    @Test
    void everySqlStatementIsIdempotent() {
        // ADR-023: аддитивные шаги обязаны быть идемпотентными — повторный прогон
        // (или прогон на живой БД, где DDL уже исполнялся out-of-band) безвреден.
        for (LoreSchemaMigrations.Step s : LoreSchemaMigrations.STEPS) {
            for (String sql : s.sql()) {
                assertTrue(sql.contains("IF NOT EXISTS"),
                    "V" + s.version() + ": не-идемпотентный стейтмент: " + sql);
            }
        }
    }

    @Test
    void contentHashIsStableAndSeparatorSafe() {
        assertEquals(LoreContentHash.of("a", "b"), LoreContentHash.of("a", "b"));
        assertFalse(LoreContentHash.of("a", "").equals(LoreContentHash.of("", "a")),
            "разделитель обязан различать распределение тех же байт по полям");
        assertEquals(LoreContentHash.of((String) null), LoreContentHash.of(""),
            "null-тело эквивалентно пустому — отсутствие тела не ошибка");
        assertEquals(16, LoreContentHash.of("x").length());
    }
}
