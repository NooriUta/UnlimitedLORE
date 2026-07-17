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
                // Две легальные формы идемпотентности: DDL c IF NOT EXISTS и
                // data-seed через UPSERT WHERE (повторный прогон обновляет ту же строку).
                assertTrue(sql.contains("IF NOT EXISTS") || sql.contains("UPSERT WHERE"),
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

    // ── ADR-023 ось совместимости (major.minor): аддитивный шаг не блокирует старый бинарь ──

    @Test
    void compatMajorNeverDecreasesAndNeverExceedsOrdinal() {
        int prevMajor = 0;
        for (LoreSchemaMigrations.Step s : LoreSchemaMigrations.STEPS) {
            assertTrue(s.compatMajor() >= prevMajor, "major не должен убывать: V" + s.version());
            assertTrue(s.compatMajor() <= s.version(), "major не может превышать ordinal: V" + s.version());
            prevMajor = s.compatMajor();
        }
    }

    @Test
    void codeCompatMajorIsTheMaxMajor() {
        int max = LoreSchemaMigrations.STEPS.stream()
            .mapToInt(LoreSchemaMigrations.Step::compatMajor).max().orElse(0);
        assertEquals(max, LoreSchemaMigrations.codeCompatMajor());
    }

    @Test
    void humanVersionIsMajorDotMinor() {
        // Пока все шаги — свои major (3-арг ctor), поэтому minor=0.
        assertTrue(LoreSchemaMigrations.codeHuman().matches("\\d+\\.\\d+"), "формат major.minor");
        assertTrue(LoreSchemaMigrations.codeHuman().endsWith(".0"),
            "все текущие шаги — свои major, последний = major.0");
    }

    @Test
    void decideBlocksOnlyOnMajorRegression() {
        // db == code
        assertEquals(LoreSchemaMigrations.StartupDecision.UP_TO_DATE,
            LoreSchemaMigrations.decide(10, 10, 10, 10));
        // db позади — доиграть недостающее
        assertEquals(LoreSchemaMigrations.StartupDecision.RUN_PENDING,
            LoreSchemaMigrations.decide(8, 8, 10, 10));
        // db 10.1/10.3 впереди кода 10.0, major тот же — РАБОТАЕМ (это и есть фикс простоя)
        assertEquals(LoreSchemaMigrations.StartupDecision.FORWARD_COMPAT,
            LoreSchemaMigrations.decide(11, 10, 10, 10), "db 10.1 vs code 10.0 — не отказ");
        assertEquals(LoreSchemaMigrations.StartupDecision.FORWARD_COMPAT,
            LoreSchemaMigrations.decide(13, 10, 10, 10), "db 10.3 vs code 10.0 — не отказ");
        // db major 11 vs код major 10 — несовместимо, ТОЛЬКО тут отказ
        assertEquals(LoreSchemaMigrations.StartupDecision.INCOMPATIBLE,
            LoreSchemaMigrations.decide(14, 11, 13, 10), "db major 11 vs code major 10 — отказ");
    }
}
