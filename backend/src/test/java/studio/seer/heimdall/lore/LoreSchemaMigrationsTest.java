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
        assertTrue(LoreSchemaMigrations.codeHuman().matches("\\d+\\.\\d+"), "формат major.minor");
    }

    /**
     * V11 (SRCH-03, полнотекстовые индексы) — ПЕРВЫЙ аддитивный шаг: ordinal 11
     * при compatMajor 10, то есть «10.1». До него все шаги были сами себе major
     * и codeHuman() всегда оканчивался на «.0» — прежняя редакция теста
     * фиксировала именно это временное совпадение и потому здесь падала.
     *
     * Существенно тут другое: аддитивный шаг НЕ поднимает ось совместимости.
     * Поднялся бы major — дрейф-гард отказал бы в старте всем бинарям без него,
     * а добавление индексов такого не заслуживает.
     */
    @Test
    void additiveStepRaisesOrdinalButNotCompatMajor() {
        var last = LoreSchemaMigrations.STEPS.get(LoreSchemaMigrations.STEPS.size() - 1);
        assertEquals(11, last.version(), "V11 — последний шаг реестра");
        assertEquals(10, last.compatMajor(), "аддитивный: делит major с V10");
        assertEquals("10.1", LoreSchemaMigrations.codeHuman(), "человеку это 10.1");
        assertEquals(10, LoreSchemaMigrations.codeCompatMajor(),
            "ось совместимости не сдвинулась — старый бинарь переживёт новые индексы");
        assertEquals(LoreSchemaMigrations.StartupDecision.FORWARD_COMPAT,
            LoreSchemaMigrations.decide(11, 10, 10, 10),
            "бинарь без V11 на мигрированной БД обязан работать, а не падать");
    }

    /** Реестр индексов (D10): у типа ровно один индекс, имена уникальны и стабильны. */
    @Test
    void fullTextIndexRegistryIsOnePerTypeWithUniqueNames() {
        var names = LoreSchemaMigrations.FT_INDEXES.stream().map(LoreSchemaMigrations.FtIndex::name).toList();
        assertEquals(names.size(), Set.copyOf(names).size(), "имена индексов уникальны");

        var types = LoreSchemaMigrations.FT_INDEXES.stream().map(LoreSchemaMigrations.FtIndex::type).toList();
        assertEquals(types.size(), Set.copyOf(types).size(),
            "ровно ОДИН индекс на тип: иначе ветка поиска перестаёт быть одним вызовом SEARCH_INDEX (D10)");

        for (var ix : LoreSchemaMigrations.FT_INDEXES) {
            assertFalse(ix.fields().isEmpty(), ix.name() + ": пустой список полей");
            assertTrue(ix.createSql().contains(LoreSchemaMigrations.FT_ANALYZER),
                ix.name() + ": без RussianAnalyzer морфология русского не работает");
            assertFalse(ix.createSql().contains("IF NOT EXISTS"),
                ix.name() + ": именованный индекс НЕ принимает IF NOT EXISTS — "
                + "существование проверяет Java-шаг (замерено на 26.7.2)");
        }
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
