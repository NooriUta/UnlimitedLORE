package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * SPRINT_LORE_OWN_HOST/OH-SLOW-QUERY-LOG · сводка вызовов ArcadeDB по шаблону запроса. «Готово, когда на препроде лог
 * даёт топ шаблонов по суммарному времени»: {@link SlowQueryClientFilter} пишет сюда КАЖДЫЙ вызов (не только медленный),
 * а раз в интервал — строку {@code [LORE SLOW-QUERY TOP]} с первыми N шаблонами по суммарному времени.
 *
 * <p>Ключ — шаблон ({@link SqlTemplate}: литералы → ?), ни текст, ни параметры не хранятся. Шаблонов не больше предела:
 * лишний вытесняет самый «лёгкий» по суммарному времени (счётчик вытеснений — в строке сводки).
 */
final class SlowQueryStats {

    record Row(String template, String source, String kind, long count, long totalMs, long maxMs) {}

    private static final class Acc {
        String source;
        String kind;
        long count;
        long totalMs;
        long maxMs;
    }

    private final int cap;
    private final Map<String, Acc> byTemplate = new HashMap<>();
    private long reads;
    private long writes;
    private long evicted;
    private long nextAt = -1;

    SlowQueryStats(int cap) { this.cap = Math.max(1, cap); }

    synchronized void record(String template, String source, String kind, long ms) {
        if ("write".equals(kind)) writes++; else reads++;
        Acc a = byTemplate.get(template);
        if (a == null) {
            if (byTemplate.size() >= cap) evictLightest();
            a = new Acc();
            byTemplate.put(template, a);
        }
        a.count++;
        a.totalMs += ms;
        a.maxMs = Math.max(a.maxMs, ms);
        a.kind = kind;
        a.source = source;   // последний источник шаблона
    }

    private void evictLightest() {
        String light = null;
        long min = Long.MAX_VALUE;
        for (Map.Entry<String, Acc> e : byTemplate.entrySet())
            if (e.getValue().totalMs < min) { min = e.getValue().totalMs; light = e.getKey(); }
        if (light != null) { byTemplate.remove(light); evicted++; }
    }

    synchronized List<Row> top(int n) {
        List<Row> rows = new ArrayList<>();
        for (Map.Entry<String, Acc> e : byTemplate.entrySet()) {
            Acc a = e.getValue();
            rows.add(new Row(e.getKey(), a.source, a.kind, a.count, a.totalMs, a.maxMs));
        }
        rows.sort(Comparator.comparingLong(Row::totalMs).reversed().thenComparing(Row::template));
        return rows.subList(0, Math.min(n, rows.size()));
    }

    synchronized long reads() { return reads; }

    synchronized long writes() { return writes; }

    synchronized long evicted() { return evicted; }

    /** Строка сводки: всего, доля чтений и записей, затем первые {@code n} шаблонов по суммарному времени. */
    synchronized String report(int n) {
        StringBuilder sb = new StringBuilder("[LORE SLOW-QUERY TOP] вызовов ").append(reads + writes)
            .append(" · чтений ").append(reads).append(" · записей ").append(writes);
        if (evicted > 0) sb.append(" · вытеснено шаблонов ").append(evicted);
        int i = 1;
        for (Row r : top(n))
            sb.append("\n  ").append(i++).append(". ").append(r.totalMs()).append(" ms · ").append(r.count())
                .append(" выз · макс ").append(r.maxMs()).append(" ms · ").append(r.kind()).append(" · source=")
                .append(r.source()).append(" · ").append(r.template());
        return sb.toString();
    }

    /** Пора ли писать сводку: первый вызов запускает отсчёт, дальше — раз в {@code intervalMs}. */
    synchronized boolean dueAt(long nowMs, long intervalMs) {
        if (nextAt < 0) { nextAt = nowMs + intervalMs; return false; }
        if (nowMs < nextAt) return false;
        nextAt = nowMs + intervalMs;
        return true;
    }
}
