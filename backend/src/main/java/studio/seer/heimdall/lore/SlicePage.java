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
public record SlicePage(Integer limit, int offset, java.util.List<String> fields) {

    private static final java.util.regex.Pattern FIELD = java.util.regex.Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");

    static final int MAX_LIMIT = 1000;

    /** Вынимает limit/offset из {@code given} (мутирует). {@code null} — постраничности не просили. */
    static SlicePage extract(Map<String, String> given) {
        String l = given.remove("limit");
        String o = given.remove("offset");
        String f = given.remove("fields");
        if (l == null && o == null && f == null) return null;
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
        return new SlicePage(limit, offset, fields == null ? null : java.util.List.copyOf(fields));
    }

    private static int parse(String name, String v) {
        try {
            return Integer.parseInt(v.trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("bad value for param: " + name + " (integer expected)");
        }
    }

    /** Режет {@code body.rows} и дописывает {@code page}. {@code page == null} — ничего не делает. */
    static void apply(Map<String, Object> body, SlicePage page) {
        if (page == null) return;
        Object raw = body.get("rows");
        List<?> rows = raw instanceof List<?> l ? l : List.of();
        int total = rows.size();
        int from = Math.min(page.offset(), total);
        int to = page.limit() == null ? total : (int) Math.min((long) from + page.limit(), total);
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
        if (page.fields() != null) meta.put("fields", page.fields());
        body.put("page", meta);
    }
}
