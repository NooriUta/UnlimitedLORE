package studio.seer.heimdall.lore;

import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Свежесть записи (вопрос №49, SPRINT_UXR_S4_UI_SHELL_LISTS/S4-04): {@code changed_at} —
 * МАКСИМУМ из {@code valid_from} открытой версии SCD2 и отметки правки на месте
 * {@code updated_at} на вершине.
 *
 * <p>Почему максимум считается здесь, а не в SQL: {@code valid_from} — DATETIME, а
 * {@code updated_at} — строка ISO (у решений объявлена STRING, шаг V45). Двухаргументный
 * {@code max()} ArcadeDB сравнивает их как Comparable и падает на смешанных типах
 * (та же ловушка, что min() по строке-дате). Срез отдаёт оба значения —
 * {@code changed_at} и служебное {@link #TOUCHED}, — а свёртка здесь оставляет одно.
 *
 * <p>Чистая функция: служебная колонка из строки убирается всегда; значение, которое не
 * читается как время, максимум не выигрывает (а не роняет выдачу).
 */
final class LoreChangedAt {

    private LoreChangedAt() {}

    /** Служебная колонка среза: отметка правки на месте (updated_at вершины). */
    static final String TOUCHED = "touched_at";

    /** Форма выдачи времени — та же, что у LoreTimeFormat: ISO-8601 UTC, три знака доли. */
    private static final DateTimeFormatter ISO_MS =
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

    static List<Map<String, Object>> fold(List<Map<String, Object>> rows) {
        if (rows == null) return null;
        List<Map<String, Object>> out = new ArrayList<>(rows.size());
        for (Map<String, Object> r : rows) {
            if (r == null || !r.containsKey(TOUCHED)) { out.add(r); continue; }
            Map<String, Object> c = new LinkedHashMap<>(r);
            Object touched = c.remove(TOUCHED);
            Instant t = instant(touched);
            if (t != null) {
                // DATETIME хранит миллисекунды, отметка правки — до наносекунд. Версия, открытая
                // в ту же миллисекунду после отметки (путь решения: поля, затем статус), иначе
                // проиграла бы своей же отметке — сравнение и выдача на точности миллисекунд.
                t = t.truncatedTo(ChronoUnit.MILLIS);
                Instant cur = instant(c.get("changed_at"));
                if (cur == null || t.isAfter(cur)) c.put("changed_at", ISO_MS.format(t));
            }
            out.add(c);
        }
        return out;
    }

    /** Время в любом виде корпуса: ISO-Z, «через пробел» (UTC wall clock), только дата, эпоха. */
    static Instant instant(Object v) {
        if (v == null) return null;
        if (v instanceof Number n) return Instant.ofEpochMilli(n.longValue());
        String s = String.valueOf(LoreTimeFormat.isoUtc(String.valueOf(v))).trim();
        if (s.isEmpty()) return null;
        try {
            if (s.length() == 10) return LocalDate.parse(s).atStartOfDay(ZoneOffset.UTC).toInstant();
            String iso = s.replace(' ', 'T');
            try {
                return OffsetDateTime.parse(iso).toInstant();
            } catch (RuntimeException noOffset) {
                return Instant.parse(iso.endsWith("Z") ? iso : iso + "Z");
            }
        } catch (RuntimeException e) {
            return null;
        }
    }
}
