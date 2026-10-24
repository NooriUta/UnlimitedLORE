package studio.seer.heimdall.lore;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;

/**
 * DS-3: хеш и длина каждого тела KnowDoc — чтобы сверять корпус по списку
 * {@code docs}, не вытягивая тела по одному через {@code doc_by_id}.
 *
 * <p>Не путать с {@link LoreContentHash}: тот — короткий (16 hex) хеш ревизии
 * от КОНКАТЕНАЦИИ тел, для истории. Здесь — полный SHA-256 от UTF-8 байтов
 * ОДНОГО тела: потребитель считает тот же хеш у себя ({@code sha256sum}) и
 * сравнивает без участия LORE. Длина — в байтах UTF-8 по той же причине.
 *
 * <p>Поля хранятся на вершине и пишутся каждым, кто пишет тело
 * ({@code LoreDocResource}, {@code LoreIngestService}); существующие —
 * добраны шагом V49. Хеш, посчитанный одним писателем и забытый другим,
 * хуже его отсутствия: он выглядит правдой и врёт.
 */
final class LoreDocBodyDigest {

    private LoreDocBodyDigest() {}

    /** Поля-тела KnowDoc. Порядок значим только для читаемости SQL. */
    static final String[] BODY_FIELDS = {"content_md_ru", "content_md_en", "content_html"};

    /** null — тела нет, и хеша нет: null не выдаётся за хеш пустой строки. */
    static String sha256(String body) {
        if (body == null) return null;
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(body.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(64);
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    static Integer bytes(String body) {
        return body == null ? null : body.getBytes(StandardCharsets.UTF_8).length;
    }

    /**
     * Дописать к UPDATE-запросу хеш и длину тела {@code field}, если оно передано.
     * Ключи параметров — {@code <field>_sha256}/{@code <field>_bytes}.
     */
    static void appendSet(StringBuilder sql, Map<String, Object> params, String field, String body) {
        if (body == null) return;
        sql.append(", ").append(field).append("_sha256=:").append(field).append("_sha256")
           .append(", ").append(field).append("_bytes=:").append(field).append("_bytes");
        params.put(field + "_sha256", sha256(body));
        params.put(field + "_bytes", bytes(body));
    }

    /** SELECT-фрагмент «хеш и длина всех тел» для слайсов. */
    static String selectColumns() {
        StringBuilder sb = new StringBuilder();
        for (String f : BODY_FIELDS) {
            sb.append(f).append("_sha256, ").append(f).append("_bytes, ");
        }
        return sb.toString();
    }
}
