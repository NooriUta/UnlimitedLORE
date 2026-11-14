package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * D-2026-LORE-AGENT-MACHINE-EVERYWHERE, п.4 (вариант А, выбор владелицы 14.11.2026): журнал
 * действий AO-01 — свой временной ряд {@code AgentActionLog} с тегами {@code client} (client_id
 * KC) и {@code machine} (X-Lore-Machine, канон {@link AgentMachine#canon}).
 *
 * <p>Почему не теги в MetricSnapshot: ArcadeDB не даёт добавить теги к TIMESERIES (проба
 * 14.11 на встроенной базе: ALTER TIMESERIES TYPE умеет только DOWNSAMPLING, CREATE PROPERTY —
 * SchemaException, INSERT с необъявленным полем отклоняется).
 *
 * <p>Пишет журнал только сюда; все читатели (срезы agent_actions/admin_actions/mcp_failures/
 * mcp_failure_rows, /lore/admin/actions, история сущности, квоты) читают отсюда. Прежние точки
 * {@code metric='lore.action'} копируются шагом V86 один раз с отметкой «неизвестно» у клиента
 * и машины — без догадки; сами они остаются в MetricSnapshot (ряд запечатан, удалить нельзя).
 *
 * <p>Отметки — те же, что у машины: {@code (unknown)} — агент, но значения нет;
 * {@code (n/a)} — не агент (человек, неопознанный), характеристика не применима. Пустой тег
 * ArcadeDB хранить не умеет — null читается обратно пустой строкой, поэтому «неизвестно»
 * пишется словом, а не null.
 */
final class AgentActionLog {

    private AgentActionLog() {}

    static final String TYPE = "AgentActionLog";

    static final String DDL = "CREATE TIMESERIES TYPE AgentActionLog IF NOT EXISTS TIMESTAMP ts "
        + "TAGS (object_type STRING, object_id STRING, source STRING, segment STRING, client STRING, machine STRING) "
        + "FIELDS (value DOUBLE)";

    /** Колонки чтения у строчных срезов и /lore/admin/actions — одна форма на всех. */
    static final String ROW_COLUMNS = "ts, object_type AS family, object_id AS entity_id, source AS caller, "
        + "segment AS axis, client, machine, value AS status";

    /** Клиент вызова: у агента — client_id токена, у прочих — «не применимо». */
    static String clientMark(boolean agent, String clientId) {
        if (!agent) return AgentMachine.NOT_APPLICABLE;
        String v = clientId == null ? "" : clientId.trim();
        return v.isEmpty() ? AgentMachine.UNKNOWN : v;
    }

    // ── V86: копирование прежних точек ─────────────────────────────────────

    /** Страница копирования. Целыми моментами — см. {@link #nextPage}. */
    static final int PAGE = 500;

    /** {@code ts.asLong()} ArcadeDB 26.10 не разбирает («Unknown function name»), {@code (ts).asLong()} — да. */
    static final String LEGACY_PAGE_SQL = "SELECT (ts).asLong() AS ms, object_type, object_id, source, segment, value "
        + "FROM MetricSnapshot WHERE metric = 'lore.action' AND ts >= :from ORDER BY ts LIMIT " + PAGE;

    static final String LEGACY_MAX_SQL = "SELECT max(ts).asLong() AS ms FROM MetricSnapshot WHERE metric = 'lore.action'";

    /**
     * Откуда продолжать после прерванного копирования: последний скопированный момент. Только в
     * пределах прежнего ряда ({@code ts <= :legacy_max}) — новые точки агента без client_id и
     * машины тоже несут две отметки «неизвестно», но они позже любой прежней.
     */
    static final String RESUME_SQL = "SELECT max(ts).asLong() AS ms FROM AgentActionLog "
        + "WHERE client = '(unknown)' AND machine = '(unknown)' AND ts <= :legacy_max";

    /** Сколько уже скопировано в момент возобновления — их пропустить. */
    static final String COPIED_AT_SQL = "SELECT count(*) AS n FROM AgentActionLog "
        + "WHERE client = '(unknown)' AND machine = '(unknown)' AND ts = :ms";

    record Page(List<Map<String, Object>> rows, long nextFrom, boolean done) {}

    /**
     * Что скопировать из выборки {@code ts >= from ORDER BY ts LIMIT pageSize}.
     * <ul>
     *   <li>первые {@code skip} строк момента {@code from} уже скопированы (возобновление);</li>
     *   <li>неполная страница — последняя, берётся целиком;</li>
     *   <li>полная — без хвостовой связки одного момента: следующая страница начнётся с него
     *       ({@code ts >= момент}) и возьмёт связку целиком, иначе граница страницы рвала бы её;</li>
     *   <li>полная страница одного момента — берётся вся, следующий запрос — со следующей мс.</li>
     * </ul>
     */
    static Page nextPage(List<Map<String, Object>> raw, long from, long skip, int pageSize) {
        List<Map<String, Object>> rows = new ArrayList<>(raw.size());
        long skipped = 0;
        for (Map<String, Object> r : raw) {
            if (skipped < skip && ms(r) == from) { skipped++; continue; }
            rows.add(r);
        }
        if (raw.size() < pageSize) return new Page(rows, from, true);
        long last = ms(raw.get(raw.size() - 1));
        List<Map<String, Object>> whole = new ArrayList<>();
        for (Map<String, Object> r : rows) if (ms(r) != last) whole.add(r);
        if (whole.isEmpty() && ms(raw.get(0)) == last) return new Page(rows, last + 1, false);
        return new Page(whole, last, false);
    }

    record Script(String sql, Map<String, Object> params) {}

    /** Одна sqlscript-пачка вставок. Без BEGIN/COMMIT: TIMESERIES в транзакции скрипта падает (nested transactions). */
    static Script copyScript(List<Map<String, Object>> rows) {
        StringBuilder sql = new StringBuilder();
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("cl", AgentMachine.UNKNOWN);
        p.put("ma", AgentMachine.UNKNOWN);
        for (int i = 0; i < rows.size(); i++) {
            Map<String, Object> r = rows.get(i);
            sql.append("INSERT INTO AgentActionLog SET ts=:t").append(i)
                .append(", object_type=:f").append(i).append(", object_id=:o").append(i)
                .append(", source=:s").append(i).append(", segment=:g").append(i)
                .append(", client=:cl, machine=:ma, value=:v").append(i).append(";");
            p.put("t" + i, ms(r));
            p.put("f" + i, str(r.get("object_type")));
            p.put("o" + i, str(r.get("object_id")));
            p.put("s" + i, str(r.get("source")));
            p.put("g" + i, str(r.get("segment")));
            p.put("v" + i, r.get("value") instanceof Number n ? n.doubleValue() : 0.0);
        }
        return new Script(sql.toString(), p);
    }

    static long ms(Map<String, Object> r) {
        return r.get("ms") instanceof Number n ? n.longValue() : Long.MIN_VALUE;
    }

    private static String str(Object o) {
        return o == null ? "" : String.valueOf(o);
    }
}
