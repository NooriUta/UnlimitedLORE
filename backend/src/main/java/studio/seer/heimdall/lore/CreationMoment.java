package studio.seer.heimdall.lore;

import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.Map;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-10 — полный ISO-момент у дат создания ADR и
 * решений и у даты релиза.
 *
 * <p><b>Почему.</b> news-proof (реальные данные 01–07.11.2026): у создания ADR и
 * решений и у релизов была только дата (прежнее имя date_created / {@code release_date}
 * как {@code yyyy-MM-dd}). Время до решения (TTD, §7.3) и порядок событий внутри
 * дня из этого не вычисляются.
 *
 * <p><b>Модель (аддитивно, V69).</b> Дата остаётся, как была, — её читают v1,
 * слайсы {@code timeline_*} и контракты S0. Рядом — отдельное поле момента
 * (реестр {@link #FIELDS}): {@code KnowADR.created_at}, {@code KnowDecision.created_at},
 * {@code KnowRelease.released_at} — ISO-8601 UTC ({@code Instant.toString()}),
 * пишется ОДИН раз, при создании записи.
 *
 * <p><b>Честность.</b> Момент пишется только когда он известен (см. {@link #resolve}):
 * дата не задана → «сейчас»; задан ISO-момент → он; задана сегодняшняя дата →
 * «сейчас». Дата в прошлом без времени (импорт, задним числом) момента НЕ получает.
 * Старые записи остаются с одной датой: читатель ({@link #read}) отдаёт их как
 * «время неизвестно» ({@code timeKnown = false}, {@code moment = null}), а не как
 * полночь. Помечать старые строки UPDATE-ом нельзя — чек-лист v1 (S2-07) пускает
 * после базиса только CREATE TYPE/PROPERTY/INDEX; отсутствие момента при наличии
 * даты и есть пометка.
 */
final class CreationMoment {

    private CreationMoment() {}

    /** Тип вершины → поле момента. У ADR и решений дата и момент — одно свойство created_at (KREG-10); у релиза дата — release_date. */
    static final Map<String, String> FIELDS = Map.of(
        "KnowADR", "created_at",
        "KnowDecision", "created_at",
        "KnowRelease", "released_at");

    /** Что записать: дата (как раньше) и момент; {@code moment == null} — время неизвестно. */
    record Resolved(String date, String moment) {}

    /** Как прочитано: дата, момент (если известен) и признак «время известно». */
    record Read(String date, Instant moment, boolean timeKnown) {}

    /**
     * Дата и момент для НОВОЙ записи по присланному значению даты.
     *
     * @param given то, что прислал клиент в поле даты (может быть null, дата,
     *              ISO-момент или свободный текст — последний сохраняется как есть)
     * @param now   момент записи
     */
    static Resolved resolve(String given, Instant now) {
        String today = now.atZone(ZoneOffset.UTC).toLocalDate().toString();
        if (given == null || given.isBlank()) return new Resolved(today, now.toString());
        String g = given.trim();
        Instant at = parseInstant(g);
        if (at != null) return new Resolved(at.atZone(ZoneOffset.UTC).toLocalDate().toString(), at.toString());
        if (isDate(g) && g.equals(today)) return new Resolved(g, now.toString());
        return new Resolved(g, null);
    }

    /** Присваивание даты создания в UPDATE: фрагмент SQL и значение параметра. */
    record Set(String sql, String value) {}

    /**
     * KREG-10: дата создания ADR и решения пишется в ОДНО свойство — {@code created_at} (канон 1.18: момент
     * {@code _at}, DATETIME). Прежнее {@code date_created} в базе из модели не существует: его на лету переводил
     * ModelSchemaAdapter, и у новой записи выходило два присваивания created_at подряд (дата, затем момент).
     *
     * <ul>
     *   <li>новая запись: момент, если он известен ({@link #resolve}), иначе присланная дата — полночь дня;</li>
     *   <li>правка существующей: присланная дата — как есть; не прислана — свойство не трогается ({@code null}).</li>
     * </ul>
     */
    static Set creationSet(boolean isNew, String given, Instant now) {
        if (isNew) {
            Resolved r = resolve(given, now);
            return new Set(", created_at=:created_at", r.moment() != null ? r.moment() : r.date());
        }
        return given == null ? null : new Set(", created_at=:created_at", given);
    }

    /** Прочитать строку: момент из поля момента, дата — из поля даты. */
    static Read read(Map<String, Object> row, String dateField, String momentField) {
        Object d = row.get(dateField);
        Instant m = StatusHistoryTimeline.instant(row.get(momentField));
        String date = d == null ? (m == null ? null : m.atZone(ZoneOffset.UTC).toLocalDate().toString())
                                : String.valueOf(d);
        return new Read(date, m, m != null);
    }

    private static Instant parseInstant(String s) {
        if (s.length() <= 10) return null; // только дата — это не момент
        try { return Instant.parse(s); } catch (DateTimeParseException ignored) { }
        try { return OffsetDateTime.parse(s).toInstant(); } catch (DateTimeParseException ignored) { }
        return null;
    }

    private static boolean isDate(String s) {
        try { LocalDate.parse(s); return true; } catch (DateTimeParseException e) { return false; }
    }
}
