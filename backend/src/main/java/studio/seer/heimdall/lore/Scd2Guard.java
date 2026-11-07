package studio.seer.heimdall.lore;

import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-09 — оптимистическая блокировка SCD2 close-open.
 *
 * <p>Каждый close-open читал rid открытой строки ОТДЕЛЬНЫМ запросом, а закрывал
 * её условием только по {@code @rid}. Две сессии, прочитавшие одну открытую
 * версию, обе её «закрывали» (вторая — уже закрытую) и обе открывали свою:
 * у сущности становилось две открытые строки истории.
 *
 * <p>Правило: закрытие версии в sqlscript условно — строка должна быть ЕЩЁ
 * открыта ({@code valid_to IS NULL}) и, если вызывающий назвал «было»,
 * совпадать с ним. Закрылось 0 строк — скрипт выходит до первой записи
 * ({@code RETURN} маркера), ничего не пишется, вызывающий получает 409
 * {@code {error:"CONFLICT", detail, current:{…}}}. Одновременные скрипты,
 * оба успевшие увидеть строку открытой, режет MVCC ArcadeDB
 * (ConcurrentModificationException) — это тоже 409, а не 502.
 */
final class Scd2Guard {

    private Scd2Guard() {}

    /** Маркер, который guarded-скрипт возвращает вместо записи. */
    static final String CONFLICT_MARK = "SCD2_CONFLICT";

    /**
     * Начало sqlscript: закрыть открытую строку {@code :oldrid} при условии, что она
     * ещё открыта (и, при {@code checkStatus}, её status_raw = {@code :expected_raw});
     * иначе вернуть {@link #CONFLICT_MARK} до любой записи. Параметры: :now, :oldrid
     * (+ :expected_raw). histType — из внутреннего switch, не из запроса.
     */
    static String guardedClose(String histType, boolean checkStatus) {
        return "LET closed = UPDATE " + histType + " SET valid_to = :now RETURN AFTER"
            + " WHERE @rid = :oldrid AND valid_to IS NULL"
            + (checkStatus ? " AND status_raw = :expected_raw" : "") + ";"
            + "IF ($closed.size() = 0) { RETURN \"" + CONFLICT_MARK + "\"; }";
    }

    /** Вернул ли guarded-скрипт маркер конфликта (ничего не записано). */
    static boolean isConflict(Object result) {
        if (!(result instanceof List<?> l) || l.isEmpty()) return false;
        Object first = l.get(0);
        if (first instanceof Map<?, ?> m) return CONFLICT_MARK.equals(m.get("value"));
        return CONFLICT_MARK.equals(first);
    }

    /** Отказ MVCC ArcadeDB на одновременной записи той же строки. */
    static boolean isConcurrentModification(Throwable ex) {
        for (Throwable t = ex; t != null; t = t.getCause()) {
            String d = LoreUpstream.detail(t);
            if (d != null && (d.contains("ConcurrentModification") || d.contains("concurrent modification")))
                return true;
            if (t.getCause() == t) break;
        }
        return false;
    }

    /**
     * Совпадает ли «было» с текущим статусом. expected — токен ("active") или сырой
     * status_raw ("🔄 IN PROGRESS"); null — проверка не запрошена.
     */
    static boolean statusMatches(String expected, String currentRaw) {
        if (expected == null || expected.isBlank()) return true;
        if (currentRaw == null) return false;
        String e = expected.trim();
        if (e.equals(currentRaw.trim())) return true;
        String raw = LoreResourceBase.SCD2_STATUS_RAW.get(e);
        if (raw != null && raw.equals(currentRaw.trim())) return true;
        return e.equals(LoreStatusResource.rawToToken(currentRaw));
    }

    /**
     * Поля «было» против текущей строки: первое расхождение (имя поля) или null.
     * Числа сравниваются по значению (движок отдаёт то Integer, то Double).
     * Ключ "status" сравнивается через {@link #statusMatches} с полем status_raw.
     */
    static String firstMismatch(Map<String, Object> expected, Map<String, Object> current) {
        if (expected == null) return null;
        for (Map.Entry<String, Object> e : expected.entrySet()) {
            String k = e.getKey();
            Object want = e.getValue();
            if ("status".equals(k)) {
                Object raw = current.get("status_raw");
                if (!statusMatches(want == null ? null : String.valueOf(want), raw == null ? null : String.valueOf(raw)))
                    return k;
                continue;
            }
            Object have = current.get(k);
            if (want instanceof Number a && have instanceof Number b) {
                if (Double.compare(a.doubleValue(), b.doubleValue()) != 0) return k;
            } else if (!Objects.equals(want, have)) {
                return k;
            }
        }
        return null;
    }

    /** Тело «текущее состояние» для 409: status_raw + status-токен + прочие поля как есть. */
    static Map<String, Object> current(Map<String, Object> row) {
        Map<String, Object> cur = new LinkedHashMap<>();
        if (row == null) return cur;
        for (Map.Entry<String, Object> e : row.entrySet()) {
            String k = e.getKey();
            if ("rid".equals(k) || k.startsWith("@")) continue;
            cur.put(k, e.getValue());
        }
        Object raw = row.get("status_raw");
        if (raw != null) cur.put("status", LoreStatusResource.rawToToken(String.valueOf(raw)));
        return cur;
    }

    /** 409 CONFLICT — тело аддитивно к LoreError: error + detail, плюс current. */
    static Response conflict(String detail, Map<String, Object> currentRow) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", "CONFLICT");
        body.put("detail", detail);
        body.put("current", current(currentRow));
        return Response.status(Response.Status.CONFLICT).entity(body)
            .type(MediaType.APPLICATION_JSON).header("Cache-Control", "no-store").build();
    }

    /** Для синхронных путей (ADR/спека): бросить, поймать в общем catch и отдать 409. */
    static final class ConflictException extends RuntimeException {
        final transient Map<String, Object> currentRow;
        ConflictException(String detail, Map<String, Object> currentRow) {
            super(detail);
            this.currentRow = currentRow;
        }
        Response response() { return conflict(getMessage(), currentRow); }
    }
}
