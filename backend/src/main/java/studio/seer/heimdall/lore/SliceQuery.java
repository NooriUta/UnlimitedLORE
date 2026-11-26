package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-12, шаг 1 (ADR-LORE-061, решение 1а — «отбор в Java» для того, что не
 * проталкивается внутрь среза): язык отбора над строками среза.
 *
 * <p>Запрос: {@code {where: [условие…], limit, page}}; верхний уровень where — И.
 * Условие:
 * <ul>
 *   <li>{@code {field, op, value}} — операторы {@code = != in not_in range empty contains < > <= >=};</li>
 *   <li>{@code {and: […]}} / {@code {or: […]}} / {@code {not: условие}}.</li>
 * </ul>
 * Поле — только из описания среза (колонки ответа, {@link KnowRegistry#selectColumns}); неописанное —
 * {@code UNKNOWN_FIELD} со списком разрешённых, а не молча пустой ответ.
 * Списочное поле совпадает, если совпал любой элемент; пустой список и null — «пусто».
 * Сравнение: числа как числа, даты как моменты, остальное строкой ({@link LoreFind#compare}).
 *
 * <p>Страницы: limit 1..{@value #MAX_LIMIT} (по умолчанию {@value #DEFAULT_LIMIT}), page ≥ 1; total — число
 * совпавших среди просмотренных. Потолок просмотра {@value #SCAN_CAP} строк: выше — complete:false (решение 2а),
 * и тогда total — нижняя граница.
 */
final class SliceQuery {

    static final int DEFAULT_LIMIT = 500;
    static final int MAX_LIMIT = 3_000;
    static final int SCAN_CAP = 20_000;

    static final Set<String> OPS = Set.of("=", "!=", "in", "not_in", "range", "empty", "contains", "<", ">", "<=", ">=");

    private SliceQuery() {}

    /** Отказ разбора запроса: код (UNKNOWN_FIELD | BAD_OP | BAD_VALUE | BAD_PARAMS), текст и что разрешено. */
    static final class Refusal extends RuntimeException {
        private final String code;
        private final List<String> allowed;

        Refusal(String code, String msg, Collection<String> allowed) {
            super(msg, null, false, false);
            this.code = code;
            this.allowed = allowed == null ? List.of() : List.copyOf(new TreeSet<>(allowed));
        }

        String code() { return code; }
        List<String> allowed() { return allowed; }
    }

    record Result(List<Map<String, Object>> rows, int total, int limit, int page, boolean hasMore, boolean complete) {}

    /**
     * @param rows          строки среза в его порядке
     * @param req           запрос (where, limit, page); null — без отбора, первая страница
     * @param fields        описанные поля среза
     * @param sliceComplete срез отдал все строки (не обрезан своим LIMIT)
     */
    static Result apply(List<Map<String, Object>> rows, Map<String, Object> req, Set<String> fields, boolean sliceComplete) {
        Map<String, Object> q = req == null ? Map.of() : req;
        List<Object> where = list(q.get("where"), "where");
        for (Object c : where) validate(c, fields);
        int limit = intParam(q.get("limit"), DEFAULT_LIMIT, "limit");
        int page = intParam(q.get("page"), 1, "page");
        if (limit < 1 || limit > MAX_LIMIT) throw new Refusal("BAD_PARAMS", "limit — от 1 до " + MAX_LIMIT, null);
        if (page < 1) throw new Refusal("BAD_PARAMS", "page — от 1", null);

        int scanned = Math.min(rows.size(), SCAN_CAP);
        boolean complete = sliceComplete && rows.size() <= SCAN_CAP;
        List<Map<String, Object>> matched = new ArrayList<>();
        for (int i = 0; i < scanned; i++) {
            Map<String, Object> r = rows.get(i);
            boolean ok = true;
            for (Object c : where) if (!eval(c, r)) { ok = false; break; }
            if (ok) matched.add(r);
        }
        int from = Math.min((page - 1) * limit, matched.size());
        int to = Math.min(from + limit, matched.size());
        return new Result(List.copyOf(matched.subList(from, to)), matched.size(), limit, page, to < matched.size(), complete);
    }

    // ── проверка ─────────────────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    private static void validate(Object c, Set<String> fields) {
        if (!(c instanceof Map<?, ?> raw)) throw new Refusal("BAD_PARAMS", "условие — объект {field, op, value}", null);
        Map<String, Object> m = (Map<String, Object>) raw;
        for (String k : List.of("and", "or")) if (m.containsKey(k)) {
            List<Object> l = list(m.get(k), k);
            if (l.isEmpty()) throw new Refusal("BAD_PARAMS", k + " — непустой список условий", null);
            for (Object x : l) validate(x, fields);
            return;
        }
        if (m.containsKey("not")) { validate(m.get("not"), fields); return; }
        String field = m.get("field") == null ? "" : String.valueOf(m.get("field"));
        if (!fields.contains(field))
            throw new Refusal("UNKNOWN_FIELD", "поле «" + field + "» у среза не описано", fields);
        String op = m.get("op") == null ? "" : String.valueOf(m.get("op"));
        if (!OPS.contains(op)) throw new Refusal("BAD_OP", "оператор «" + op + "» не поддержан", OPS);
        Object v = m.get("value");
        switch (op) {
            case "in", "not_in" -> {
                if (!(v instanceof Collection<?> col) || col.isEmpty())
                    throw new Refusal("BAD_VALUE", "«" + op + "» — непустой список значений", null);
            }
            case "range" -> {
                if (!(v instanceof Map<?, ?> rm) || (rm.get("from") == null && rm.get("to") == null))
                    throw new Refusal("BAD_VALUE", "«range» — объект {from, to}, хотя бы один край", null);
            }
            case "empty" -> {
                if (v != null && !(v instanceof Boolean))
                    throw new Refusal("BAD_VALUE", "«empty» — true или false", null);
            }
            default -> {
                if (v == null || v instanceof Collection<?> || v instanceof Map<?, ?>)
                    throw new Refusal("BAD_VALUE", "«" + op + "» — одно значение", null);
            }
        }
    }

    // ── вычисление ───────────────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    private static boolean eval(Object c, Map<String, Object> row) {
        Map<String, Object> m = (Map<String, Object>) c;
        if (m.containsKey("and")) {
            for (Object x : (List<Object>) m.get("and")) if (!eval(x, row)) return false;
            return true;
        }
        if (m.containsKey("or")) {
            for (Object x : (List<Object>) m.get("or")) if (eval(x, row)) return true;
            return false;
        }
        if (m.containsKey("not")) return !eval(m.get("not"), row);
        List<Object> actual = values(row.get(String.valueOf(m.get("field"))));
        Object v = m.get("value");
        return switch (String.valueOf(m.get("op"))) {
            case "empty" -> actual.isEmpty() == (v == null || Boolean.TRUE.equals(v));
            case "=" -> anyMatch(actual, List.of(v));
            case "!=" -> !anyMatch(actual, List.of(v));
            case "in" -> anyMatch(actual, (Collection<Object>) v);
            case "not_in" -> !anyMatch(actual, (Collection<Object>) v);
            case "contains" -> {
                String needle = String.valueOf(v).toLowerCase(Locale.ROOT);
                boolean hit = false;
                for (Object a : actual) if (String.valueOf(a).toLowerCase(Locale.ROOT).contains(needle)) { hit = true; break; }
                yield hit;
            }
            case "range" -> {
                Map<String, Object> rm = (Map<String, Object>) v;
                Object lo = rm.get("from");
                Object hi = rm.get("to");
                boolean hit = false;
                for (Object a : actual)
                    if ((lo == null || LoreFind.compare(a, lo) >= 0) && (hi == null || LoreFind.compare(a, hi) <= 0)) { hit = true; break; }
                yield hit;
            }
            default -> {
                String op = String.valueOf(m.get("op"));
                boolean hit = false;
                for (Object a : actual) {
                    int r = LoreFind.compare(a, v);
                    if (switch (op) { case "<" -> r < 0; case ">" -> r > 0; case "<=" -> r <= 0; default -> r >= 0; }) { hit = true; break; }
                }
                yield hit;
            }
        };
    }

    private static List<Object> values(Object actual) {
        List<Object> out = new ArrayList<>();
        if (actual instanceof Collection<?> c) { for (Object x : c) if (x != null && !String.valueOf(x).isEmpty()) out.add(x); }
        else if (actual != null && !String.valueOf(actual).isEmpty()) out.add(actual);
        return out;
    }

    private static boolean anyMatch(List<Object> actual, Collection<Object> wanted) {
        for (Object a : actual) for (Object w : wanted) if (w != null && LoreFind.compare(a, w) == 0) return true;
        return false;
    }

    private static List<Object> list(Object o, String name) {
        if (o == null) return List.of();
        if (o instanceof Collection<?> c) return new ArrayList<>(c);
        throw new Refusal("BAD_PARAMS", name + " — список", null);
    }

    private static int intParam(Object o, int def, String name) {
        if (o == null) return def;
        if (o instanceof Number n && n.doubleValue() == Math.rint(n.doubleValue())) return n.intValue();
        throw new Refusal("BAD_PARAMS", name + " — целое число", null);
    }
}
