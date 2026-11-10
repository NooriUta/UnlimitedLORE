package studio.seer.heimdall.lore;

import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Общая часть постановки типизированного ребра между сущностями каталога
 * {@link LoreLinkTypes}: найти вершину по id и проверить, есть ли уже ребро.
 * Один код для «Связать» из упоминания (SPRINT_UXR_S2_GRAPH_MEMORY/S2-06) и
 * стрелок холста (SPRINT_UXR_S7C_WHY_CANVAS/S7C-05).
 */
final class LoreGraphLinks {

    private LoreGraphLinks() {}

    static final Pattern RID = Pattern.compile("#\\d+:\\d+");

    /**
     * @return rid записи; {@code null} — записи нет; пустая строка — id неоднозначен.
     *         Сбой запроса летит наверх: «не смогли проверить» ≠ «нет».
     */
    static String resolveRid(LoreIngestService ingest, LoreLinkTypes.Entity e, String id) {
        List<Map<String, Object>> rows = ingest.queryPublic(
            "SELECT @rid AS rid FROM " + e.vertexClass() + " WHERE " + e.idField() + " = :v LIMIT 2",
            Map.of("v", id));
        if (rows.isEmpty()) return null;
        if (rows.size() > 1) return "";
        String rid = String.valueOf(rows.get(0).get("rid"));
        if (!RID.matcher(rid).matches()) throw new IllegalStateException("неожиданный @rid: " + rid);
        return rid;
    }

    /** Есть ли ребро {@code edge} ровно {@code fromRid → toRid}. Имя ребра — только из каталога. */
    static boolean edgeBetween(LoreIngestService ingest, String edge, String fromRid, String toRid) {
        List<Map<String, Object>> rows = ingest.queryPublic(
            "SELECT count(*) AS n FROM " + edge + " WHERE @out = " + fromRid + " AND @in = " + toRid, Map.of());
        return !rows.isEmpty() && ((Number) rows.get(0).getOrDefault("n", 0)).longValue() > 0;
    }

    /** Значение для SET в CREATE EDGE (туда не передаются именованные параметры). */
    static String sqlSafe(String s) {
        return s == null ? "" : s.replaceAll("[^A-Za-z0-9_:/.@\\-]", "_");
    }
}
