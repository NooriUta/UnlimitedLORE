package studio.seer.heimdall.lore;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Страница выдачи слайса: зарезервированные {@code limit}/{@code offset} для
 * ЛЮБОГО слайса (SE-01).
 *
 * <p>05.11.2026 сессия Völva получила от {@code releases} 400 «unknown param:
 * limit» и ~20 тыс. знаков полных description_md — только чтобы узнать текущий
 * релиз. Параметры страницы вынимаются из запроса ДО {@link LoreSlices#compose}
 * (у слайсов их нет в белом списке) и применяются к уже полученным строкам —
 * так не трогаются ни склейка фильтров, ни условие скоупа, которое compose
 * вставляет перед ORDER BY/LIMIT.</p>
 *
 * <p>Урезанная выдача обязана это сообщать: ответ несёт {@code page}
 * с {@code total} и {@code has_more}. Без этого страница неотличима от полного
 * списка — тот же класс «не нашли ≠ не смотрели».</p>
 */
public record SlicePage(Integer limit, int offset, java.util.List<String> fields, Range range) {

    private static final java.util.regex.Pattern FIELD = java.util.regex.Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");

    static final int MAX_LIMIT = 1000;

    /** Колонка времени правки, по которой режется период (S4-04, LoreChangedAt). */
    static final String CHANGED_AT = "changed_at";

    SlicePage(Integer limit, int offset, java.util.List<String> fields) {
        this(limit, offset, fields, null);
    }

    /**
     * MT-MCP-CHANGED-RANGE: период правки и порядок по ней — общие для любого среза.
     * {@code from} — включительно; {@code to} — включительно для момента и «до конца суток»
     * для даты (тогда {@code toExclusive} — начало следующих суток). {@code sortAsc == null} —
     * порядок среза не трогается. {@code fromRaw}/{@code toRaw}/{@code sort} — как просили,
     * для {@code page}.
     */
    record Range(java.time.Instant from, java.time.Instant to, boolean toExclusive, Boolean sortAsc,
                 String fromRaw, String toRaw, String sort) {

        boolean filters() { return from != null || to != null; }

        boolean contains(java.time.Instant t) {
            if (t == null) return false;
            if (from != null && t.isBefore(from)) return false;
            if (to != null) return toExclusive ? t.isBefore(to) : !t.isAfter(to);
            return true;
        }
    }

    /** Граница периода: дата — полночь UTC (у {@code to} — следующих суток), момент без зоны — UTC. */
    private static java.time.Instant bound(String name, String v, boolean isTo) {
        String s = v.trim();
        if (s.matches("\\d{4}-\\d{2}-\\d{2}")) {
            try {
                java.time.LocalDate d = java.time.LocalDate.parse(s);
                return (isTo ? d.plusDays(1) : d).atStartOfDay(java.time.ZoneOffset.UTC).toInstant();
            } catch (RuntimeException e) { /* ниже — общий отказ */ }
        } else if (s.matches("\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}.*")) {
            java.time.Instant t = LoreChangedAt.instant(s);
            if (t != null) return t;
        }
        throw new IllegalArgumentException("bad value for param: " + name + " (" + v
            + ") — ISO date YYYY-MM-DD or date-time YYYY-MM-DDTHH:MM[:SS][Z|±HH:MM], UTC when no zone");
    }

    private static Range range(String from, String to, String sort) {
        if (from == null && to == null && sort == null) return null;
        java.time.Instant f = from == null ? null : bound("changed_from", from, false);
        java.time.Instant t = to == null ? null : bound("changed_to", to, true);
        boolean toExclusive = to != null && to.trim().length() == 10;
        if (f != null && t != null && (toExclusive ? !f.isBefore(t) : f.isAfter(t)))
            throw new IllegalArgumentException("changed_from (" + from + ") is after changed_to (" + to + ")");
        Boolean asc = null;
        if (sort != null) {
            String s = sort.trim();
            if (s.equals(CHANGED_AT + ":desc")) asc = false;
            else if (s.equals(CHANGED_AT + ":asc")) asc = true;
            else throw new IllegalArgumentException("bad value for param: sort (" + sort
                + ") — supported: changed_at:desc | changed_at:asc");
        }
        return new Range(f, t, toExclusive, asc,
            from == null ? null : from.trim(), to == null ? null : to.trim(), sort == null ? null : sort.trim());
    }

    /** Вынимает limit/offset/fields и период из {@code given} (мутирует). {@code null} — ничего не просили. */
    static SlicePage extract(Map<String, String> given) {
        String l = given.remove("limit");
        String o = given.remove("offset");
        String f = given.remove("fields");
        Range range = range(given.remove("changed_from"), given.remove("changed_to"), given.remove("sort"));
        if (l == null && o == null && f == null && range == null) return null;
        java.util.List<String> fields = null;
        if (f != null) {
            // Проекция (SE-01, шаг 2): лишние колонки отбрасываются ПОСЛЕ запроса —
            // SQL слайсов не переписывается. Имя поля — только идентификатор.
            fields = new java.util.ArrayList<>();
            for (String part : f.split(",")) {
                String name = part.trim();
                if (name.isEmpty()) continue;
                if (!FIELD.matcher(name).matches())
                    throw new IllegalArgumentException("bad value for param: fields (" + name + ")");
                fields.add(name);
            }
            if (fields.isEmpty()) throw new IllegalArgumentException("empty list for param: fields");
        }
        Integer limit = null;
        if (l != null) {
            limit = parse("limit", l);
            if (limit < 1 || limit > MAX_LIMIT)
                throw new IllegalArgumentException("limit must be 1.." + MAX_LIMIT + " (got " + l + ")");
        }
        int offset = 0;
        if (o != null) {
            offset = parse("offset", o);
            if (offset < 0) throw new IllegalArgumentException("offset must be >= 0 (got " + o + ")");
        }
        return new SlicePage(limit, offset, fields == null ? null : java.util.List.copyOf(fields), range);
    }

    private static int parse(String name, String v) {
        try {
            return Integer.parseInt(v.trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("bad value for param: " + name + " (integer expected)");
        }
    }

    /**
     * Режет {@code body.rows} и дописывает {@code page}. {@code page == null} — ничего не делает.
     * @throws IllegalArgumentException колонка из {@code fields}, которой нет ни в одной строке
     */
    static void apply(Map<String, Object> body, SlicePage page) {
        if (page == null) return;
        Object raw = body.get("rows");
        List<?> rows = raw instanceof List<?> l ? l : List.of();
        Range range = page.range();
        if (range != null && !rows.isEmpty()) {
            // MT-MCP-CHANGED-RANGE: фильтр и сортировка — ДО страницы, total — после фильтра.
            // Срез без времени правки в строках — ошибка запроса: тихо проигнорированный
            // период выдал бы «всё» за «изменённое за период».
            boolean hasColumn = false;
            for (Object row : rows) if (row instanceof Map<?, ?> m && m.containsKey(CHANGED_AT)) { hasColumn = true; break; }
            if (!hasColumn)
                throw new IllegalArgumentException("this slice has no " + CHANGED_AT
                    + " in its rows — changed_from/changed_to/sort=changed_at cannot apply to it");
            java.util.List<Object> kept = new java.util.ArrayList<>(rows.size());
            for (Object row : rows) {
                if (!range.filters()) { kept.add(row); continue; }
                if (row instanceof Map<?, ?> m && range.contains(LoreChangedAt.instant(m.get(CHANGED_AT)))) kept.add(row);
            }
            if (range.sortAsc() != null) {
                java.util.Comparator<java.time.Instant> order = range.sortAsc()
                    ? java.util.Comparator.<java.time.Instant>naturalOrder() : java.util.Comparator.<java.time.Instant>reverseOrder();
                // Без времени — в хвосте в обе стороны; сортировка стабильна (порядок среза внутри равных).
                kept.sort(java.util.Comparator.comparing(
                    (Object row) -> row instanceof Map<?, ?> m ? LoreChangedAt.instant(m.get(CHANGED_AT)) : null,
                    java.util.Comparator.nullsLast(order)));
            }
            rows = kept;
        }
        int total = rows.size();
        int from = Math.min(page.offset(), total);
        int to = page.limit() == null ? total : (int) Math.min((long) from + page.limit(), total);
        if (page.fields() != null && !rows.isEmpty()) {
            // Völva 05.11: молча отсутствующее поле читается как «значения нет».
            // Слайсы отдают null-поля явно, поэтому колонка, которой нет ни в одной
            // строке, — ошибка запроса; отказ перечисляет, что есть. Пустая выдача
            // судить не позволяет — её не трогаем.
            java.util.Set<String> seen = new java.util.TreeSet<>();
            for (Object row : rows) if (row instanceof Map<?, ?> m) for (Object k : m.keySet()) seen.add(String.valueOf(k));
            java.util.List<String> unknown = page.fields().stream().filter(k -> !seen.contains(k)).toList();
            if (!unknown.isEmpty())
                throw new IllegalArgumentException("unknown field(s) " + unknown + " — this slice returns: " + seen);
        }
        List<?> cut = rows.subList(from, to);
        if (page.fields() != null) {
            java.util.List<Object> projected = new java.util.ArrayList<>(cut.size());
            for (Object row : cut) {
                if (row instanceof Map<?, ?> m) {
                    Map<Object, Object> keep = new LinkedHashMap<>();
                    for (String k : page.fields()) if (m.containsKey(k)) keep.put(k, m.get(k));
                    projected.add(keep);
                } else projected.add(row);
            }
            cut = projected;
        }
        body.put("rows", new java.util.ArrayList<>(cut));
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("limit", page.limit());
        meta.put("offset", page.offset());
        meta.put("total", total);
        meta.put("has_more", to < total);
        if (page.fields() != null) {
            meta.put("fields", page.fields());
            // Пустая выдача — слепая зона проверки колонок: отказывать не на чем, но
            // «0 строк» нельзя отдать так, чтобы оно читалось как «данных нет».
            meta.put("fields_checked", total > 0);
            if (total == 0) meta.put("warning", "0 rows: fields " + page.fields()
                + " could NOT be checked against the slice columns — an empty answer here may be a typo in fields, not absent data");
        }
        if (range != null) {
            meta.put("changed_from", range.fromRaw());
            meta.put("changed_to", range.toRaw());
            meta.put("sort", range.sort());
            meta.put("time_zone", "UTC");
            if (total == 0 && rows.isEmpty() && !(raw instanceof List<?> r0 && !r0.isEmpty())) {
                String w = "0 rows: whether this slice has " + CHANGED_AT
                    + " could NOT be checked — an empty answer is not proof that nothing changed in the period";
                Object prev = meta.get("warning");
                meta.put("warning", prev == null ? w : prev + "; " + w);
            }
        }
        body.put("page", meta);
    }
}
