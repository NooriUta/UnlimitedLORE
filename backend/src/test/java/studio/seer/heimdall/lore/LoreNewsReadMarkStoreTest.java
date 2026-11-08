package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S7A_NEWS/S7A-04 и S7A-07: черта «прочитано до сюда» — без БД.
 *
 * <p>Главное, что тут сторожится: три состояния черты не смешиваются.
 * «Черты ещё не ставили» (unset) и «хранилище недоступно» (unavailable) по
 * значению одинаково пустые, но означают разное: первое — честное «пусто»,
 * второе — «не смогли проверить». Слить их — ровно та ошибка, против которой
 * S7A-07.
 *
 * <p>Плюс шаг миграции: тип черты обязан заводиться реестром схемы, иначе на
 * живой базе черта навсегда остаётся unavailable.
 */
class LoreNewsReadMarkStoreTest {

    @Test
    void noRowMeansUnsetNotUnavailable() {
        LoreNewsReadMarkStore s = new LoreNewsReadMarkStore((sql, p) -> List.of(), (sql, p) -> { });
        LoreNewsReadMarkStore.State st = s.get();
        assertEquals("unset", st.state());
        assertNull(st.at());
        assertNull(st.error());
    }

    @Test
    void storedMarkIsReturnedAsOk() {
        LoreNewsReadMarkStore s = new LoreNewsReadMarkStore(
            (sql, p) -> List.of(Map.of("mark_at", "2026-11-07T17:30:00Z")), (sql, p) -> { });
        LoreNewsReadMarkStore.State st = s.get();
        assertEquals("ok", st.state());
        assertEquals(Instant.parse("2026-11-07T17:30:00Z"), st.at());
    }

    @Test
    void failingStorageIsUnavailableWithReasonNotUnset() {
        // Так выглядит база без шага миграции: тип не найден.
        LoreNewsReadMarkStore s = new LoreNewsReadMarkStore(
            (sql, p) -> { throw new IllegalStateException("Type with name 'LoreNewsReadMark' was not found"); },
            (sql, p) -> { });
        LoreNewsReadMarkStore.State st = s.get();
        assertEquals("unavailable", st.state(), "сбой хранилища не должен выглядеть как «черты нет»");
        assertNotNull(st.error());
        assertTrue(st.toMap().containsKey("error"), "причина недоступности уходит клиенту");
    }

    @Test
    void unparsableStoredValueIsUnavailableNotOk() {
        LoreNewsReadMarkStore s = new LoreNewsReadMarkStore(
            (sql, p) -> List.of(Map.of("mark_at", "вчера")), (sql, p) -> { });
        assertEquals("unavailable", s.get().state());
    }

    @Test
    void setUpsertsTheSingleSharedMarkAndReadsItBack() {
        List<Map<String, Object>> stored = new ArrayList<>();
        List<String> sqls = new ArrayList<>();
        LoreNewsReadMarkStore s = new LoreNewsReadMarkStore(
            (sql, p) -> stored.isEmpty() ? List.of() : List.of(Map.of("mark_at", stored.get(0).get("at"))),
            (sql, p) -> { sqls.add(sql); stored.clear(); stored.add(p); });
        LoreNewsReadMarkStore.State st = s.set(Instant.parse("2026-11-08T09:00:00Z"), "owner-sub");
        assertEquals("ok", st.state());
        assertEquals(Instant.parse("2026-11-08T09:00:00Z"), st.at());
        assertEquals(1, sqls.size());
        assertTrue(sqls.get(0).contains("UPSERT WHERE mark_id = :id"), "одна общая черта — UPSERT по ключу, не вторая строка");
        assertEquals(LoreNewsReadMarkStore.SHARED, stored.get(0).get("id"));
        assertEquals("owner-sub", stored.get(0).get("by"));
    }

    @Test
    void failingWriteIsUnavailable() {
        LoreNewsReadMarkStore s = new LoreNewsReadMarkStore((sql, p) -> List.of(),
            (sql, p) -> { throw new IllegalStateException("write 503"); });
        assertEquals("unavailable", s.set(Instant.parse("2026-11-08T09:00:00Z"), "x").state());
    }

    // ── шаг миграции ──

    @Test
    void readMarkTypeIsProvisionedBySchemaStep() {
        LoreSchemaMigrations.Step step = LoreSchemaMigrations.STEPS.stream()
            .filter(s -> s.sql().containsAll(LoreNewsReadMarkStore.SCHEMA_SQL))
            .findFirst().orElse(null);
        assertNotNull(step, "ни один шаг реестра схемы не заводит " + LoreNewsReadMarkStore.TYPE
            + " — на живой базе черта навсегда unavailable");
        assertEquals(17, step.compatMajor(), "аддитивный шаг: major совместимости не поднимается (ADR-LORE-045)");
        assertTrue(LoreSchemaMigrations.requiredLiveTypes().contains(LoreNewsReadMarkStore.TYPE),
            "тип черты должен попасть в сверку обязательных типов на старте");
    }
}
