package studio.seer.heimdall.lore;

import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * SPRINT_LORE_AGENT_OBSERVABILITY/AO-SESSION-LOG — harness, из которого пишет агент.
 *
 * <p>Владелица 16.11.2026: «просить каждый mcp писать harness, а то может быть мискомм в
 * настройках; к CLAUDE указать его константой». MCP шлёт {@code X-Lore-Harness} (константа
 * {@code LORE_HARNESS} в настройках сервера MCP у каждого harness). Сервер записывает присланный
 * код в версию истории ({@code changed_by_harness}) и сверяет его со справочником harness и с
 * harness, закреплённым за клиентом KC. Расхождение — пометкой {@code changed_by_harness_note},
 * а не подменой: кто ошибся, настройки MCP или карточка агента, решает человек.
 *
 * <p>Пометки: {@code not_sent} — заголовка нет; {@code invalid} — значение не по канону (не
 * пишется); {@code not_in_dictionary} — кода нет в справочнике; {@code client:<код>} — у клиента
 * KC закреплён другой harness; {@code unverified} — справочник ещё не прочитан (сверить нечем).
 */
final class HarnessCheck {

    private HarnessCheck() {}

    static final String HEADER = "X-Lore-Harness";

    private static final Pattern CANON = Pattern.compile("[A-Za-z0-9_.-]{1,64}");

    /** Справочник harness и harness клиентов KC на момент последнего чтения. */
    record Snapshot(boolean ready, Set<String> codes, Map<String, String> byClient) {
        static final Snapshot EMPTY = new Snapshot(false, Set.of(), Map.of());
    }

    record Result(String code, String note) {
        static final Result NONE = new Result(null, null);
    }

    static Result judge(String rawHeader, String clientId, Snapshot snap) {
        String v = rawHeader == null ? "" : rawHeader.trim();
        if (v.isEmpty()) return new Result(null, "not_sent");
        if (!CANON.matcher(v).matches()) return new Result(null, "invalid");
        Snapshot s = snap == null ? Snapshot.EMPTY : snap;
        if (!s.ready()) return new Result(v, "unverified");
        if (!s.codes().contains(v)) return new Result(v, "not_in_dictionary");
        String registered = clientId == null ? null : s.byClient().get(clientId);
        if (registered != null && !registered.isBlank() && !registered.equals(v))
            return new Result(v, "client:" + registered);
        return new Result(v, null);
    }
}
