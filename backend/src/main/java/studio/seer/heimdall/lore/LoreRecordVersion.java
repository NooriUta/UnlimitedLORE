package studio.seer.heimdall.lore;

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
 * <p><b>Что версия ловит и чего нет.</b> Новая строка истории открывается на
 * смене статуса, плана спринта, номера версии спеки и правке с checkpoint.
 * Правки «на месте» ({@code sprint/update} пишет вершину, {@code task/edit}
 * дописывает открытую строку) valid_from не двигают — параллельная правка ТЕКСТА
 * этой проверкой не ловится. Это код как есть, а не замысел; см. описание PR.
 */
final class LoreRecordVersion {

    private LoreRecordVersion() {}

    /** Запрос версии и автора открытой строки истории записи типа. */
    static String sql(String type) {
        String[] t = switch (type == null ? "" : type) {
            case "sprint" -> new String[] {"KnowSprint", "sprint_id"};
            case "task"   -> new String[] {"KnowTask", "task_uid"};
            case "adr"    -> new String[] {"KnowADR", "adr_id"};
            case "spec"   -> new String[] {"KnowSpec", "spec_id"};
            default -> throw new IllegalArgumentException("версия записи не заведена для типа: " + type);
        };
        return "SELECT out('HAS_STATE')[valid_to IS NULL].valid_from[0] AS version, "
            + "out('HAS_STATE')[valid_to IS NULL].changed_by[0] AS updated_by "
            + "FROM " + t[0] + " WHERE " + t[1] + " = :id LIMIT 1";
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
