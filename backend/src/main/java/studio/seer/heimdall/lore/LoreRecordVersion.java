package studio.seer.heimdall.lore;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Версия записи паспорта (ADR-LORE-047, допущение A3): {@code valid_from} ОТКРЫТОЙ
 * строки истории (*Hist с {@code valid_to IS NULL}), в ISO-8601 UTC.
 *
 * <p>Наружу время уходит через {@link LoreTimeFormat#isoUtc} (фильтр ответа
 * RM-P13), поэтому и сверка идёт по той же нормализации: клиент возвращает в
 * {@code expected_version} ровно ту строку, что получил в {@code record.version}.
 *
 * <p><b>Правка на месте тоже двигает версию (S5-08).</b> Новая строка истории
 * открывается на смене статуса, плана спринта, номера версии спеки и правке с
 * checkpoint. Правки «на месте» ({@code sprint/update} пишет вершину,
 * {@code task/edit}, {@code spec}, {@code adr} без checkpoint дописывают открытую
 * строку) valid_from НЕ двигают — до S5-08 версия была одним valid_from, и вторая
 * параллельная правка ТЕКСТА ложилась поверх первой молча, с «верной» версией.
 * Все эти пути ставят на вершину {@code updated_at} (S4-04), поэтому версия —
 * МАКСИМУМ из valid_from и updated_at ({@link #of}); отметка правки идёт в полной
 * точности, так что две правки в одну миллисекунду — разные версии.
 */
final class LoreRecordVersion {

    private LoreRecordVersion() {}

    /** Колонка запроса {@link #sql}: отметка правки на месте (updated_at вершины). */
    static final String TOUCHED = "touched_at";

    /** Запрос версии и автора открытой строки истории записи типа. */
    static String sql(String type) {
        String[] t = switch (type == null ? "" : type) {
            case "sprint" -> new String[] {"KnowSprint", "sprint_id"};
            case "task"   -> new String[] {"KnowTask", "task_uid"};
            case "adr"    -> new String[] {"KnowADR", "adr_id"};
            case "spec"   -> new String[] {"KnowSpec", "spec_id"};
            // S5-DOC-PASSPORT: у KnowDoc нет SCD2-версий и updated_at — версия честно null, проверки нет.
            case "doc"    -> new String[] {"KnowDoc", "doc_id"};
            default -> throw new IllegalArgumentException("версия записи не заведена для типа: " + type);
        };
        return "SELECT out('HAS_STATE')[valid_to IS NULL].valid_from[0] AS version, "
            + "out('HAS_STATE')[valid_to IS NULL].changed_by[0] AS updated_by, "
            + "updated_at AS " + TOUCHED + " "
            + "FROM " + t[0] + " WHERE " + t[1] + " = :id LIMIT 1";
    }

    /**
     * Версия записи из строки {@link #sql}: valid_from открытой версии, а если после
     * неё запись правили на месте — отметка этой правки. Без правки на месте форма
     * прежняя (черновики S5-09 с base_version не протухают зря). Отметка в ту же
     * миллисекунду, что valid_from, проигрывает (путь «поля, затем статус» — как в
     * {@link LoreChangedAt}); нечитаемая — не выигрывает. {@code null} — версии нет.
     */
    static String of(Map<String, Object> row) {
        if (row == null) return null;
        String open = normalize(row.get("version"));
        Instant touched = LoreChangedAt.instant(row.get(TOUCHED));
        if (touched == null) return open;
        Instant openAt = open == null ? null : LoreChangedAt.instant(open);
        if (openAt != null && !touched.truncatedTo(ChronoUnit.MILLIS).isAfter(openAt)) return open;
        // Полная точность Instant: две правки в одну миллисекунду — разные версии.
        // DATETIME из ArcadeDB приходит до миллисекунд — та же ISO-форма.
        String s = touched.toString();
        if (touched.getNano() % 1_000_000 == 0) s = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
            .withZone(ZoneOffset.UTC).format(touched);
        return s;
    }

    /** Совпадает ли названная клиентом версия с текущей ({@link #of}). Версии нет — не совпадает. */
    static boolean matchesCurrent(String expected, String current) {
        return current != null && expected != null && current.equals(expected.trim());
    }

    /** Строка версии в той форме, в какой она уходит клиенту; {@code null} — версии нет. */
    static String normalize(Object raw) {
        if (raw == null) return null;
        String s = String.valueOf(LoreTimeFormat.isoUtc(String.valueOf(raw))).trim();
        return s.isEmpty() ? null : s;
    }

    /** Совпадает ли названная клиентом версия с текущей. Версии нет — не совпадает. */
    static boolean matches(String expected, Object currentRaw) {
        String cur = normalize(currentRaw);
        return cur != null && expected != null && cur.equals(expected.trim());
    }

    /** Тело 409 VERSION_CONFLICT: что сейчас, чтобы клиент перечитал и слил. */
    static Map<String, Object> conflictBody(String type, String id, String expected,
                                            String currentVersion, Object updatedBy) {
        Map<String, Object> cur = new LinkedHashMap<>();
        cur.put("version", currentVersion);
        cur.put("updated_by", updatedBy);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", "VERSION_CONFLICT");
        body.put("detail", type + " '" + id + "': expected_version '" + expected
            + "' не совпадает с текущей версией — перечитайте запись и повторите");
        body.put("current", cur);
        return body;
    }
}
