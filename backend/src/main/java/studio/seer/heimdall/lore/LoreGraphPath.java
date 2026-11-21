package studio.seer.heimdall.lore;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-05 (SPEC-LORE-GRAPH-SEARCH §7) — путь между двумя записями
 * для {@code GET /lore/graph/path}.
 *
 * <p>Чистый класс над тем же {@link LoreGraphBuilder.Source}, что окрестность: обход в ширину от
 * {@code from} по уровням (каждый уровень — один запрос рёбер), с теми же фильтрами {@code rels},
 * {@code walk_types}, {@code dir}, тем же правилом структурных рёбер и тем же скоупом. Найден
 * {@code to} — дальше не идём: пути — кратчайшие. {@code k > 1} — до {@code k} разных кратчайших
 * путей (вершины в пути не повторяются — у кратчайшего это так по построению).
 *
 * <p><b>«Нет пути» говорится честно и с причиной</b> ({@code meta.reason}):
 * <ul>
 *   <li>{@code too_deep} — путь есть, но длиннее {@code max_depth} (найден повтором до {@link #MAX_DEPTH});</li>
 *   <li>{@code through_hidden} — путь есть только через записи вне скоупа вызывающего (повтор без скоупа —
 *       только для счёта, сами скрытые узлы не показываются);</li>
 *   <li>{@code no_path} — пути нет до глубины {@code max_depth} (и до {@link #MAX_DEPTH});</li>
 *   <li>{@code budget} — обход упёрся в потолок узлов: ответ неполный ({@code complete:false}).</li>
 * </ul>
 */
final class LoreGraphPath {

    private LoreGraphPath() {}

    static final int MAX_DEPTH = 6;
    static final int MAX_K = 3;
    /** Потолок прочитанных узлов на один обход: путь — не выгрузка корпуса. */
    static final int NODE_BUDGET = 20_000;

    record Query(String fromKey, String toKey, Set<String> rels, Set<String> walkTypes, String dir,
                 boolean structural, int maxDepth, int k, Set<String> allowed) {}

    record Result(List<Map<String, Object>> paths, Map<String, Object> meta) {
        Map<String, Object> toJson() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("paths", paths);
            m.put("meta", meta);
            return m;
        }
    }

    /** Ребро в обходе: настоящее ребро источника и узел, к которому по нему пришли. */
    private record Step(String parent, LoreGraphBuilder.Edge edge) {}

    /** Итог одного обхода. */
    private record Walk(Map<String, List<Step>> parents, boolean reached, boolean budgetHit, Set<String> hidden,
                        Map<String, LoreGraphBuilder.Node> known) {}

    static Result find(Query q, LoreGraphBuilder.Source src) {
        if (q.maxDepth() < 1 || q.maxDepth() > MAX_DEPTH)
            throw new LoreGraphBuilder.GraphException(400, "BAD_PARAMS", "max_depth — от 1 до " + MAX_DEPTH);
        if (q.k() < 1 || q.k() > MAX_K)
            throw new LoreGraphBuilder.GraphException(400, "BAD_PARAMS", "k — от 1 до " + MAX_K);
        String dir = LoreGraphBuilder.checkDir(q.dir());
        LoreGraphBuilder.requireNonEmpty(q.allowed());

        Map<String, LoreGraphBuilder.Node> ends = src.nodes(List.of(q.fromKey(), q.toKey()));
        for (String[] end : new String[][] {{"from", q.fromKey()}, {"to", q.toKey()}}) {
            LoreGraphBuilder.Node n = ends.get(end[1]);
            if (n == null)
                throw new LoreGraphBuilder.GraphException(404, "NOT_FOUND", end[0] + ": запись «" + end[1] + "» не найдена");
            if (!LoreGraphBuilder.visible(n, q.allowed()))
                throw new LoreGraphBuilder.GraphException(403, "OUTSIDE_SCOPE",
                    end[0] + ": " + n.type() + " «" + n.id() + "» существует, но вне разрешённых вызывающему проектов");
        }

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("from", ends.get(q.fromKey()).id());
        meta.put("to", ends.get(q.toKey()).id());
        meta.put("max_depth", q.maxDepth());
        meta.put("k", q.k());
        meta.put("dir", dir);
        meta.put("rels", new TreeSet<>(q.rels() == null ? Set.of() : q.rels()));
        meta.put("walk_types", new TreeSet<>(q.walkTypes() == null ? Set.of() : q.walkTypes()));

        if (q.fromKey().equals(q.toKey())) {
            LoreGraphBuilder.Node n = ends.get(q.fromKey());
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("length", 0);
            p.put("nodes", List.of(nodeJson(n)));
            p.put("edges", List.of());
            finish(meta, true, null, null, 0, false, false);
            return new Result(List.of(p), meta);
        }

        Walk w = walk(q, dir, q.maxDepth(), q.allowed(), src);
        if (w.reached()) {
            List<List<Step>> raw = enumerate(w, q.fromKey(), q.toKey(), q.k() + 1);
            boolean more = raw.size() > q.k();
            List<Map<String, Object>> paths = new ArrayList<>();
            for (List<Step> p : raw.subList(0, Math.min(q.k(), raw.size()))) paths.add(pathJson(p, q.fromKey(), w.known()));
            finish(meta, true, null, null, w.hidden().size(), w.budgetHit(), more);
            return new Result(paths, meta);
        }

        // Не найден: что именно «нет» — скажем словами.
        String reason;
        String message;
        if (w.budgetHit()) {
            reason = "budget";
            message = "обход упёрся в потолок " + NODE_BUDGET + " узлов до глубины " + q.maxDepth()
                + " — путь не найден, но и отсутствие не доказано; сузьте rels/walk_types";
        } else if (q.maxDepth() < MAX_DEPTH && walk(q, dir, MAX_DEPTH, q.allowed(), src).reached()) {
            reason = "too_deep";
            message = "пути нет до глубины " + q.maxDepth() + ", но он есть глубже (до " + MAX_DEPTH + ") — увеличьте max_depth";
        } else if (q.allowed() != null && walk(q, dir, q.maxDepth(), null, src).reached()) {
            reason = "through_hidden";
            message = "путь до глубины " + q.maxDepth() + " есть только через записи вне разрешённых вызывающему проектов";
        } else {
            reason = "no_path";
            message = "пути нет до глубины " + q.maxDepth() + " (с учётом rels/walk_types/dir)";
        }
        finish(meta, false, reason, message, w.hidden().size(), w.budgetHit(), false);
        return new Result(List.of(), meta);
    }

    private static void finish(Map<String, Object> meta, boolean found, String reason, String message, int hidden,
                               boolean budgetHit, boolean more) {
        meta.put("found", found);
        if (reason != null) meta.put("reason", reason);
        if (message != null) meta.put("message", message);
        meta.put("complete", !budgetHit);
        meta.put("truncated", budgetHit);
        meta.put("capped_at", budgetHit ? NODE_BUDGET : null);
        meta.put("hidden_by_scope", hidden);
        meta.put("more_paths_possible", more);
        meta.put("dangling", List.of());
    }

    /** Обход в ширину до {@code maxDepth}; на уровне, где найден {@code to}, останавливается. */
    private static Walk walk(Query q, String dir, int maxDepth, Set<String> allowed, LoreGraphBuilder.Source src) {
        Set<String> rels = q.rels() == null ? Set.of() : q.rels();
        Set<String> walkTypes = q.walkTypes() == null ? Set.of() : q.walkTypes();
        Set<String> exclude = LoreGraphBuilder.excludedRels(q.structural(), rels);

        Map<String, LoreGraphBuilder.Node> known = new HashMap<>(src.nodes(List.of(q.fromKey(), q.toKey())));
        Map<String, Integer> depthOf = new HashMap<>();
        Map<String, List<Step>> parents = new HashMap<>();
        Set<String> hidden = new HashSet<>();
        depthOf.put(q.fromKey(), 0);
        List<String> frontier = List.of(q.fromKey());
        boolean reached = false;
        boolean budgetHit = false;

        for (int d = 0; d < maxDepth && !frontier.isEmpty() && !reached; d++) {
            Set<String> fs = new HashSet<>(frontier);
            List<LoreGraphBuilder.Edge> edges = new ArrayList<>();
            for (LoreGraphBuilder.Edge e : src.edges(frontier, exclude)) {
                if (exclude.contains(e.rel())) continue;
                if (!rels.isEmpty() && !rels.contains(e.rel())) continue;
                boolean fromIn = fs.contains(e.from());
                boolean toIn = fs.contains(e.to());
                if (!fromIn && !toIn) continue;
                edges.add(e);
            }
            edges.sort(Comparator.comparing(LoreGraphBuilder.Edge::from).thenComparing(LoreGraphBuilder.Edge::rel)
                .thenComparing(LoreGraphBuilder.Edge::to));
            Set<String> unknown = new TreeSet<>();
            for (LoreGraphBuilder.Edge e : edges) {
                if (!known.containsKey(e.from())) unknown.add(e.from());
                if (!known.containsKey(e.to())) unknown.add(e.to());
            }
            if (!unknown.isEmpty()) known.putAll(src.nodes(unknown));

            Set<String> next = new TreeSet<>();
            for (LoreGraphBuilder.Edge e : edges) {
                // Ребро может идти от фронта в обе стороны; каждое направление проверяем по dir.
                for (int side = 0; side < 2; side++) {
                    String self = side == 0 ? e.from() : e.to();
                    String other = side == 0 ? e.to() : e.from();
                    if (!fs.contains(self)) continue;
                    if (side == 0 && LoreGraphBuilder.DIR_IN.equals(dir)) continue;
                    if (side == 1 && LoreGraphBuilder.DIR_OUT.equals(dir)) continue;
                    Integer od = depthOf.get(other);
                    if (od != null && od <= d) continue; // уже ближе
                    LoreGraphBuilder.Node o = known.get(other);
                    if (o == null) continue;
                    if (!LoreGraphBuilder.visible(o, allowed)) { hidden.add(other); continue; }
                    boolean isTarget = other.equals(q.toKey());
                    if (!isTarget && !walkTypes.isEmpty() && !walkTypes.contains(o.type())) continue;
                    if (od == null) {
                        if (depthOf.size() >= NODE_BUDGET) { budgetHit = true; continue; }
                        depthOf.put(other, d + 1);
                        next.add(other);
                    }
                    parents.computeIfAbsent(other, x -> new ArrayList<>()).add(new Step(self, e));
                    if (isTarget) reached = true;
                }
            }
            // Цель не раскрываем: путь заканчивается на ней.
            next.remove(q.toKey());
            frontier = new ArrayList<>(next);
        }
        return new Walk(parents, reached, budgetHit, hidden, known);
    }

    /** До {@code limit} кратчайших путей от {@code to} назад к {@code from}; порядок — по ключам узлов. */
    private static List<List<Step>> enumerate(Walk w, String from, String to, int limit) {
        List<List<Step>> out = new ArrayList<>();
        ArrayDeque<Step> stack = new ArrayDeque<>();
        back(w, from, to, stack, out, limit);
        return out;
    }

    private static void back(Walk w, String from, String at, ArrayDeque<Step> stack, List<List<Step>> out, int limit) {
        if (out.size() >= limit) return;
        if (at.equals(from)) {
            out.add(new ArrayList<>(stack)); // стек — от начала пути к концу (push в голову)
            return;
        }
        List<Step> ps = new ArrayList<>(w.parents().getOrDefault(at, List.of()));
        ps.sort(Comparator.comparing((Step s) -> w.known().get(s.parent()).id()).thenComparing(s -> s.edge().rel()));
        for (Step s : ps) {
            stack.push(s);
            back(w, from, s.parent(), stack, out, limit);
            stack.pop();
            if (out.size() >= limit) return;
        }
    }

    private static Map<String, Object> pathJson(List<Step> steps, String from, Map<String, LoreGraphBuilder.Node> known) {
        List<Map<String, Object>> nodes = new ArrayList<>();
        List<Map<String, Object>> edges = new ArrayList<>();
        nodes.add(nodeJson(known.get(from)));
        String at = from;
        for (Step s : steps) {
            LoreGraphBuilder.Edge e = s.edge();
            String next = e.from().equals(at) ? e.to() : e.from();
            nodes.add(nodeJson(known.get(next)));
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("from", known.get(e.from()).id());
            m.put("rel", e.rel());
            m.put("to", known.get(e.to()).id());
            if (LoreGraphBuilder.STRUCTURAL_RELS.contains(e.rel())) m.put("kind", LoreGraphBuilder.KIND_STRUCTURAL);
            else if (e.kind() != null) m.put("kind", e.kind());
            edges.add(m);
            at = next;
        }
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("length", steps.size());
        p.put("nodes", nodes);
        p.put("edges", edges);
        return p;
    }

    private static Map<String, Object> nodeJson(LoreGraphBuilder.Node n) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", n.id());
        m.put("type", n.type());
        m.put("title", n.title());
        m.put("status", n.status());
        m.put("status_category", n.statusCategory());
        return m;
    }
}
