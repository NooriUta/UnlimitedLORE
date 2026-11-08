package studio.seer.heimdall.lore.news;

import java.util.List;
import java.util.Map;

/**
 * SPRINT_UXR_S7A_NEWS/S7A-05: Atom-лента (RFC 4287) на любой фильтр.
 *
 * <p>Строится из тех же строк {@code events}, что отдаёт GET /lore/news/v2 с
 * теми же параметрами, — поэтому подписка и экран не могут разойтись: Atom не
 * считает ничего своего. Чистая функция, без БД.
 *
 * <p>Честное состояние (S7A-07) переносится и сюда: если источник недоступен,
 * первой записью идёт «источник недоступен», а не пустая лента.
 */
public final class NewsAtomWriter {

    private NewsAtomWriter() {}

    /**
     * @param response  ответ {@link NewsV2Engine#compute}
     * @param selfUrl   адрес самой ленты (с фильтром) — rel="self" и id
     * @param htmlUrl   адрес экрана новостей с тем же фильтром — rel="alternate"
     */
    @SuppressWarnings("unchecked")
    public static String write(Map<String, Object> response, String selfUrl, String htmlUrl) {
        Map<String, Object> meta = (Map<String, Object>) response.get("meta");
        List<Map<String, Object>> rows = (List<Map<String, Object>>) response.get("events");
        StringBuilder sb = new StringBuilder(4096);
        sb.append("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n");
        sb.append("<feed xmlns=\"http://www.w3.org/2005/Atom\">\n");
        sb.append("  <id>").append(x(selfUrl)).append("</id>\n");
        sb.append("  <title>LORE — новости</title>\n");
        sb.append("  <updated>").append(x(String.valueOf(meta.get("generated_at")))).append("</updated>\n");
        sb.append("  <link rel=\"self\" type=\"application/atom+xml\" href=\"").append(x(selfUrl)).append("\"/>\n");
        if (htmlUrl != null) sb.append("  <link rel=\"alternate\" type=\"text/html\" href=\"").append(x(htmlUrl)).append("\"/>\n");
        sb.append("  <generator>LORE news v2</generator>\n");
        List<Map<String, Object>> errors = (List<Map<String, Object>>) meta.get("errors");
        if (errors != null && !errors.isEmpty()) {
            StringBuilder d = new StringBuilder();
            for (Map<String, Object> e : errors) d.append(e.get("source")).append(": ").append(e.get("error")).append("; ");
            sb.append("  <entry>\n    <id>").append(x(selfUrl + "#errors-" + meta.get("generated_at"))).append("</id>\n")
              .append("    <title>Источник недоступен — лента неполная</title>\n")
              .append("    <updated>").append(x(String.valueOf(meta.get("generated_at")))).append("</updated>\n")
              .append("    <summary>").append(x(d.toString())).append("</summary>\n  </entry>\n");
        }
        for (Map<String, Object> r : rows) {
            String updated = r.get("at_utc") != null ? String.valueOf(r.get("at_utc"))
                : r.get("day_local") + "T00:00:00Z";
            int mult = r.get("mult") instanceof Integer i ? i : 1;
            String title = r.get("type") + " " + r.get("el") + " — " + r.get("kind") + (mult > 1 ? " ×" + mult : "")
                + (r.get("title") != null ? ": " + r.get("title") : "");
            sb.append("  <entry>\n");
            sb.append("    <id>").append(x("urn:lore:news:" + r.get("key"))).append("</id>\n");
            sb.append("    <title>").append(x(title)).append("</title>\n");
            sb.append("    <updated>").append(x(updated)).append("</updated>\n");
            sb.append("    <author><name>").append(x(r.get("who") != null ? String.valueOf(r.get("who")) : "неизвестно"))
              .append("</name></author>\n");
            Object projects = r.get("projects");
            if (projects instanceof List<?> l) for (Object p : l)
                sb.append("    <category term=\"").append(x(String.valueOf(p))).append("\" label=\"project\"/>\n");
            sb.append("    <category term=\"").append(x(String.valueOf(r.get("type")))).append("\" label=\"type\"/>\n");
            sb.append("    <summary>").append(x(r.get("day_local") + (r.get("time_local") != null ? " " + r.get("time_local") : " · время неизвестно")
                + (r.get("to") != null ? " · " + r.get("to") : ""))).append("</summary>\n");
            sb.append("  </entry>\n");
        }
        sb.append("</feed>\n");
        return sb.toString();
    }

    static String x(String s) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder(s.length());
        for (char c : s.toCharArray()) {
            switch (c) {
                case '&' -> b.append("&amp;");
                case '<' -> b.append("&lt;");
                case '>' -> b.append("&gt;");
                case '"' -> b.append("&quot;");
                default -> { if (c >= 0x20 || c == '\n' || c == '\t') b.append(c); }
            }
        }
        return b.toString();
    }
}
