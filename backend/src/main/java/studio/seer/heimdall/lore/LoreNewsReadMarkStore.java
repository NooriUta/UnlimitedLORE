package studio.seer.heimdall.lore;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.function.BiConsumer;
import java.util.function.BiFunction;

/**
 * SPRINT_UXR_S7A_NEWS/S7A-04: черта «прочитано до сюда» — на сервере, одна
 * общая (§8, решение 07.11 п.12). Не тает: сдвигается только действием
 * пользователя (PUT), никаких счётчиков и уведомлений.
 *
 * <p>Тип {@link #TYPE} заводит шаг V70 {@code news_read_mark} реестра
 * {@code LoreSchemaMigrations} — DDL берётся отсюда, {@link #SCHEMA_SQL}.
 * Выпущенный шаг неизменяем: правка этого списка меняет checksum V70 и роняет
 * старт (дрейф-гард) — нужна правка схемы → новый шаг.
 *
 * <p>Пока шаг не накатан (или хранилище недоступно), чтение и запись честно
 * отвечают {@code state=unavailable} с причиной, а не «черты нет» — пустое и
 * недоступное не смешиваются (S7A-07).
 */
final class LoreNewsReadMarkStore {

    static final String TYPE = "LoreNewsReadMark";
    static final String SHARED = "shared";

    static final List<String> SCHEMA_SQL = List.of(
        "CREATE VERTEX TYPE " + TYPE + " IF NOT EXISTS",
        "CREATE PROPERTY " + TYPE + ".mark_id IF NOT EXISTS STRING",
        "CREATE PROPERTY " + TYPE + ".mark_at IF NOT EXISTS STRING",
        "CREATE PROPERTY " + TYPE + ".updated_at IF NOT EXISTS STRING",
        "CREATE PROPERTY " + TYPE + ".updated_by IF NOT EXISTS STRING",
        "CREATE INDEX IF NOT EXISTS ON " + TYPE + " (mark_id) UNIQUE");

    /** ok — черта есть; none — черты ещё не ставили; unavailable — хранилище недоступно. */
    record State(String state, Instant at, String error) {
        Map<String, Object> toMap() {
            Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("state", state);
            m.put("at", at == null ? null : at.toString());
            if (error != null) m.put("error", error);
            return m;
        }
    }

    private final BiFunction<String, Map<String, Object>, List<Map<String, Object>>> query;
    private final BiConsumer<String, Map<String, Object>> command;

    LoreNewsReadMarkStore(BiFunction<String, Map<String, Object>, List<Map<String, Object>>> query,
                          BiConsumer<String, Map<String, Object>> command) {
        this.query = query;
        this.command = command;
    }

    State get() {
        try {
            List<Map<String, Object>> rows = query.apply(
                "SELECT mark_at FROM " + TYPE + " WHERE mark_id = :id", Map.of("id", SHARED));
            if (rows == null || rows.isEmpty() || rows.get(0).get("mark_at") == null) return new State("none", null, null); // ревью 10.11, B3: имя из контракта kit (ok | none | unavailable)
            Instant at = LoreNewsV2Collector.instant(rows.get(0).get("mark_at"));
            return at == null ? new State("unavailable", null, "mark_at не разобран: " + rows.get(0).get("mark_at"))
                : new State("ok", at, null);
        } catch (Exception e) {
            return new State("unavailable", null, String.valueOf(e.getMessage()));
        }
    }

    /** Сдвиг черты действием пользователя. Черту назад не двигаем молча — это тоже действие, но явное. */
    State set(Instant at, String by) {
        try {
            command.accept("UPDATE " + TYPE + " SET mark_id = :id, mark_at = :at, updated_at = :now, updated_by = :by "
                    + "UPSERT WHERE mark_id = :id",
                Map.of("id", SHARED, "at", at.toString(), "now", Instant.now().toString(), "by", by == null ? "unknown" : by));
            return get();
        } catch (Exception e) {
            return new State("unavailable", null, String.valueOf(e.getMessage()));
        }
    }
}
