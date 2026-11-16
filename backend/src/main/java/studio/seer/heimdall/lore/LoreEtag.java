package studio.seer.heimdall.lore;

/**
 * Сверка заголовка {@code If-None-Match} с тегом ответа — одна на все условные GET.
 *
 * <p>Сравнение «слабое» (RFC 9110 §13.1.2): признак {@code W/} и кавычки не учитываются, в
 * заголовке может стоять несколько тегов через запятую или {@code *}. Причина правила — сжимающий
 * прокси: nginx при gzip делает тег слабым ({@code W/"…"}), клиент возвращает его как получил, и
 * сравнение строк целиком давало 200 с полным телом вместо 304 (находка приложения miniLORE
 * 15.11.2026 на /lore/model; то же сравнение стояло у аватара).
 */
final class LoreEtag {

    private LoreEtag() {}

    /** Голое значение тега: без {@code W/} и без кавычек; {@code null} и пустое — «тега нет». */
    static String opaque(String tag) {
        if (tag == null) return null;
        String t = tag.trim();
        if (t.regionMatches(true, 0, "W/", 0, 2)) t = t.substring(2).trim();
        if (t.length() >= 2 && t.startsWith("\"") && t.endsWith("\"")) t = t.substring(1, t.length() - 1);
        return t.isEmpty() ? null : t;
    }

    /** Совпал ли хотя бы один тег из {@code If-None-Match} с тегом ответа. */
    static boolean matches(String ifNoneMatch, String etag) {
        String ours = opaque(etag);
        if (ours == null || ifNoneMatch == null || ifNoneMatch.isBlank()) return false;
        for (String part : ifNoneMatch.split(",")) {
            String p = part.trim();
            if (p.equals("*")) return true;
            if (ours.equals(opaque(p))) return true;
        }
        return false;
    }
}
