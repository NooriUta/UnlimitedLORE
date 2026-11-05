package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * RM-P13: выдача времени наружу — ISO-8601 UTC с {@code Z}, в одном месте.
 *
 * <p>Время в корпусе хранится нативным DATETIME ArcadeDB (решение владельца
 * 05.11.2026, шаг V56). Формат выдачи базы по умолчанию —
 * {@code yyyy-MM-dd HH:mm:ss[.SSS]} без обозначения зоны, а браузер читает
 * {@code new Date("2026-04-13 00:00:00")} как МЕСТНОЕ время и молча сдвигает
 * дату на смещение читателя. {@code ALTER DATABASE dateTimeFormat} не выход:
 * на 26.10.2 формат, не кончающийся на {@code S}, искажается ({@code …Z.171}).
 *
 * <p>Поэтому значение-строка, ЦЕЛИКОМ совпадающее с формой рендера DATETIME,
 * переводится в {@code yyyy-MM-ddTHH:mm:ss.SSSZ}: пробел → {@code T}, доля
 * секунды дополняется или обрезается до трёх знаков, дописывается {@code Z}.
 * Цифры не трогаются — DATETIME хранит UTC wall clock (все пишущие пути шлют
 * {@code Instant.now().toString()}), так что приписать {@code Z} значит назвать
 * зону, а не сменить момент. Любая другая форма (ISO-Z, только дата, текст,
 * число) остаётся как есть. Обход рекурсивный — по вложенным спискам и картам.
 *
 * <p>Чистая функция без состояния: те же входы — тот же выход.
 */
final class LoreTimeFormat {

    private LoreTimeFormat() {}

    private static final Pattern RENDERED =
        Pattern.compile("^(\\d{4}-\\d{2}-\\d{2}) (\\d{2}:\\d{2}:\\d{2})(?:\\.(\\d{1,9}))?$");

    /** Одно значение: строка формы рендера DATETIME → ISO-Z; списки и карты — рекурсивно; прочее как есть. */
    static Object isoUtc(Object v) {
        if (v instanceof String s) {
            Matcher m = RENDERED.matcher(s);
            if (!m.matches()) return s;
            String frac = m.group(3) == null ? "" : m.group(3);
            frac = frac.length() >= 3 ? frac.substring(0, 3) : (frac + "000").substring(0, 3);
            return m.group(1) + 'T' + m.group(2) + '.' + frac + 'Z';
        }
        if (v instanceof Map<?, ?> map) {
            Map<Object, Object> out = new LinkedHashMap<>();
            for (Map.Entry<?, ?> e : map.entrySet()) out.put(e.getKey(), isoUtc(e.getValue()));
            return out;
        }
        if (v instanceof Collection<?> c) {
            List<Object> out = new ArrayList<>(c.size());
            for (Object o : c) out.add(isoUtc(o));
            return out;
        }
        return v;
    }

    /**
     * Дерево Jackson: текстовые узлы формы рендера DATETIME заменяются на ISO-Z
     * НА МЕСТЕ; возвращается тот же узел. Для тел ответа, которые не Map/List
     * (record, POJO) — их строки видны только после {@code valueToTree}.
     */
    static com.fasterxml.jackson.databind.JsonNode isoUtcTree(com.fasterxml.jackson.databind.JsonNode n) {
        if (n instanceof com.fasterxml.jackson.databind.node.ObjectNode o) {
            List<String> names = new ArrayList<>();
            o.fieldNames().forEachRemaining(names::add);
            for (String f : names) {
                com.fasterxml.jackson.databind.JsonNode c = o.get(f);
                if (c != null && c.isTextual()) {
                    Object v = isoUtc(c.textValue());
                    if (!v.equals(c.textValue())) o.put(f, (String) v);
                } else {
                    isoUtcTree(c);
                }
            }
        } else if (n instanceof com.fasterxml.jackson.databind.node.ArrayNode a) {
            for (int i = 0; i < a.size(); i++) {
                com.fasterxml.jackson.databind.JsonNode c = a.get(i);
                if (c != null && c.isTextual()) {
                    Object v = isoUtc(c.textValue());
                    if (!v.equals(c.textValue())) a.set(i, a.textNode((String) v));
                } else {
                    isoUtcTree(c);
                }
            }
        }
        return n;
    }

    /** Строки выдачи: каждая — новая карта с приведёнными значениями (вход не меняется). */
    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> isoUtcRows(List<Map<String, Object>> rows) {
        if (rows == null) return null;
        List<Map<String, Object>> out = new ArrayList<>(rows.size());
        for (Map<String, Object> r : rows) out.add(r == null ? null : (Map<String, Object>) isoUtc(r));
        return out;
    }
}
