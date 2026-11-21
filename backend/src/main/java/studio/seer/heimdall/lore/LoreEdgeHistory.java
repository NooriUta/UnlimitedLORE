package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-02 · Историчные связи: история ведётся в самом ребре.
 *
 * <p>Какие связи историчные и какими полями — раздел {@code edge_history} модели, одно описание на все
 * связи (образец — ROLE_HELD_BY, ADR-LORE-042). Правило для каждой такой связи:
 * <ul>
 *   <li>новое ребро получает {@code valid_from = сейчас};</li>
 *   <li>смена или снятие связи не стирает ребро, а закрывает его {@code valid_to = сейчас};</li>
 *   <li>«текущие» связи — только рёбра с {@code valid_to IS NULL}; переход по вершинам {@code out('РЕБРО')}
 *       свойства ребра не видит, поэтому для историчной связи — {@code outE('РЕБРО')[valid_to IS NULL].inV()}.</li>
 * </ul>
 * Пути SQL строятся здесь, чтобы правило жило в одном месте; сторож HistoricEdgeReadGuardTest ловит
 * чтения в обход.
 */
final class LoreEdgeHistory {

    private LoreEdgeHistory() {}

    /** Раздел модели: поля версии у ребра и историчные связи (связь → почему историчная). */
    record EdgeHistory(List<String> fields, Map<String, String> edges) {
        static final EdgeHistory NONE = new EdgeHistory(List.of(), Map.of());
    }

    static final String CURRENT = "valid_to IS NULL";

    /** Историчные связи действующей модели. */
    static final Set<String> EDGES = LoreModelViews.set(() -> LoreModelFile.content().edgeHistory().edges().keySet());

    static boolean historic(String edge) {
        return edge != null && EDGES.contains(edge);
    }

    /** Переход «наружу» к вершинам по текущим связям: {@code outE('РЕБРО')[valid_to IS NULL].inV()}. */
    static String out(String edge) {
        return historic(edge) ? "outE('" + edge + "')[" + CURRENT + "].inV()" : "out('" + edge + "')";
    }

    /** Переход «внутрь» к вершинам по текущим связям: {@code inE('РЕБРО')[valid_to IS NULL].outV()}. */
    static String in(String edge) {
        return historic(edge) ? "inE('" + edge + "')[" + CURRENT + "].outV()" : "in('" + edge + "')";
    }

    /** Условие «только текущие» для выборки по самому типу ребра ({@code FROM X WHERE …}). */
    static String andCurrent(String edge) {
        return historic(edge) ? " AND " + CURRENT : "";
    }

    /** Поля, которые новое ребро получает при создании: {@code , valid_from = '<сейчас>'} (строкой — как у ROLE_HELD_BY). */
    static String setValidFrom(String edge, String now) {
        return historic(edge) ? ", valid_from = '" + now.replace("'", "") + "'" : "";
    }

    // ── Разбор и вывод раздела модели ────────────────────────────────────

    @SuppressWarnings("unchecked")
    static EdgeHistory parse(Object raw) {
        if (raw == null) return EdgeHistory.NONE;
        if (!(raw instanceof Map<?, ?> m)) throw new IllegalStateException("файл модели: edge_history — не объект");
        Object f = m.get("fields");
        Object e = m.get("edges");
        if (!(f instanceof List<?> fl) || !(e instanceof Map<?, ?> em))
            throw new IllegalStateException("файл модели: edge_history — нужны fields (список) и edges (связь → почему)");
        for (Object k : m.keySet())
            if (!"fields".equals(k) && !"edges".equals(k)) throw new IllegalStateException("файл модели: edge_history — неизвестный ключ «" + k + "»");
        List<String> fields = new ArrayList<>();
        for (Object o : fl) fields.add(String.valueOf(o));
        Map<String, String> edges = new LinkedHashMap<>();
        for (Map.Entry<?, ?> x : em.entrySet()) edges.put(String.valueOf(x.getKey()), x.getValue() == null ? null : String.valueOf(x.getValue()));
        return new EdgeHistory(List.copyOf(fields), java.util.Collections.unmodifiableMap(edges));
    }

    /** Согласованность: поля версии — «действует с / по»; каждая связь — связь модели, у каждой — причина. */
    static List<String> problems(EdgeHistory eh, Map<String, LoreRecordRegistry.TypeDef> types) {
        List<String> bad = new ArrayList<>();
        if (eh.edges().isEmpty()) return bad;
        if (!eh.fields().equals(List.of("valid_from", "valid_to")))
            bad.add("edge_history.fields: ждали [valid_from, valid_to], а не " + eh.fields());
        java.util.Set<String> rels = new java.util.HashSet<>();
        for (LoreRecordRegistry.TypeDef t : types.values())
            for (LoreRecordRegistry.Relation r : t.relations()) rels.add(r.rel());
        for (Map.Entry<String, String> e : eh.edges().entrySet()) {
            if (!rels.contains(e.getKey())) bad.add("edge_history: связи " + e.getKey() + " нет среди связей типов модели");
            if (e.getValue() == null || e.getValue().isBlank()) bad.add("edge_history: у связи " + e.getKey() + " не сказано, почему она историчная");
        }
        return bad;
    }

    /** Канонический вывод раздела (файл модели) и его вид в /lore/model. */
    static Map<String, Object> surface(LoreModelFile.Content c) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("fields", c.edgeHistory().fields());
        d.put("edges", new TreeMap<>(c.edgeHistory().edges()));
        return d;
    }
}
