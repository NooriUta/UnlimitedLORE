package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-04 — сборщик графа для {@code GET /lore/graph}.
 *
 * <p>Чистый класс: без Quarkus и без БД. На входе — абстрактный {@link Source}
 * (узлы по ключу и инцидентные рёбра в обе стороны), на выходе — форма GraphExplorer
 * и таблицы рёбер архива: {@code nodes[{id,type,title,status,status_category,depth}]},
 * {@code edges[{from,rel,to,kind?}]}, {@code meta}.
 *
 * <p><b>Два режима — один обход.</b> Окрестность записи: уровень 0 — корень, обход в
 * ширину до {@code depth} (1..4; 4 — с 11.11.2026). Фильтр {@code rels} действует на КАЖДОМ шаге:
 * путь глубины 2..4 идёт только по рёбрам названных типов, через ребро другого типа не проходит. Срез: уровень 0 — семена среза (все записи проекта,
 * компонента или всего LORE), плюс одно кольцо соседей — рёбра, ведущие из среза наружу,
 * не обрываются молча. Рёбра между двумя узлами последнего уровня не запрашиваются:
 * у последнего уровня рёбра не читаются вовсе (так глубина и ограничивает стоимость).
 *
 * <p><b>Скоуп fail-closed, как у слайсов.</b> {@code allowed == null} — ограничения нет;
 * пустое множество — отказ {@code SCOPE_EMPTY}, а не пустой граф; корень вне скоупа —
 * {@code OUTSIDE_SCOPE}. Узел чужого проекта не отдаётся НИЧЕМ — ни узлом, ни концом
 * ребра, ни строкой {@code dangling}: его число идёт в {@code hidden_by_scope}, а
 * висячий конец называется со стороны ВИДИМОГО узла ({@code id} — наш узел,
 * {@code rel}/{@code dir} — куда ведёт ребро). Узел общего справочника
 * ({@link Node#scoped()} = false: компонент, технология, веха) виден всем.
 *
 * <p><b>Потолок и висячие концы называются явно.</b> Узлов больше {@code limit} —
 * {@code truncated:true}, {@code capped_at:N}; что срезать, решает порядок (type, id)
 * внутри уровня, а не порядок строк БД. Ребро на отсутствующий узел — {@code dangling}
 * с причиной {@code missing} (и ответ {@code complete:false}), на скрытый —
 * {@code hidden_by_scope} (ответ остаётся полным: скрытое посчитано).
 *
 * <p><b>Детерминизм.</b> Узлы — по (depth, type, id), рёбра — по (from, rel, to, kind),
 * dangling — по (id, rel, dir, reason). Порядок строк источника на ответ не влияет.
 */
final class LoreGraphBuilder {

    private LoreGraphBuilder() {}

    /**
     * Структурные рёбра — устройство и принадлежность записи, а не связь по смыслу.
     * Отдельный слой: по умолчанию выключен ({@code structural=true} включает), в ответе
     * помечен {@code kind:"structural"}. Иначе у хаба-проекта или спринта соседями стал
     * бы весь корпус. Список — тот же, что вне каталога «Связать» ({@link LoreLinkTypes}),
     * плюс исключения обратных связей ({@code LoreSearchResource.STRUCTURAL_EDGES}):
     * <ul>
     *   <li>HAS_STATE — строка истории SCD2;</li>
     *   <li>BELONGS_TO_PROJECT — запись → проект; BELONGS_TO — запись → компонент;</li>
     *   <li>PART_OF — задача/фаза → спринт; IN_PHASE — задача → фаза;</li>
     *   <li>TAGGED_WITH — задача → компонент, запись → тег;</li>
     *   <li>DOC_CHILD_OF — иерархия документов.</li>
     * </ul>
     */
    static final Set<String> STRUCTURAL_RELS = Set.of(
        "HAS_STATE", "BELONGS_TO_PROJECT", "BELONGS_TO",
        "PART_OF", "IN_PHASE", "TAGGED_WITH", "DOC_CHILD_OF");

    static final String KIND_STRUCTURAL = "structural";
    static final String MISSING = "missing";
    static final String HIDDEN = "hidden_by_scope";
    /** meta.frontier_edges: рёбра между узлами последнего уровня не читались. */
    static final String FRONTIER_NOT_READ = "not_read";

    /**
     * Узел источника. {@code key} — ключ источника (у БД — @rid), {@code id} — бизнес-ключ
     * записи для ответа. {@code projects} — слаги проектов по всем путям скоупа;
     * {@code scoped == false} — общий справочник, скоупом не режется.
     */
    record Node(String key, String id, String type, String title, String status, String statusCategory,
                Set<String> projects, boolean scoped) {}

    /** Ребро источника: концы — ключи источника; {@code kind} — свойство ребра (DEPENDS_ON: hard/soft/…). */
    record Edge(String from, String rel, String to, String kind) {}

    /** Абстрактный источник графа. */
    interface Source {
        /** Узлы по ключам; отсутствующего ключа в ответе нет. */
        Map<String, Node> nodes(Collection<String> keys);

        /**
         * Открытые рёбра, инцидентные ключам (обе стороны). {@code excludeRels} — подсказка,
         * что можно не читать; сборщик фильтрует сам и на неё не полагается.
         */
        List<Edge> edges(Collection<String> keys, Set<String> excludeRels);
    }

    /** Скоуп среза: {@code all} | {@code project:<slug>} | {@code component:<id>}. */
    record Scope(String kind, String value) {}

    /** Отказ с HTTP-статусом и кодом ошибки API. */
    static final class GraphException extends RuntimeException {
        private final int status;
        private final String code;

        GraphException(int status, String code, String message) {
            super(message);
            this.status = status;
            this.code = code;
        }

        int status() { return status; }

        String code() { return code; }
    }

    /**
     * Запрос. {@code rootKey != null} — окрестность; иначе срез по {@code seeds}.
     * {@code rels}/{@code types} пустые — без фильтра.
     */
    record Query(String rootKey, List<Node> seeds, int depth, Set<String> rels, Set<String> walkTypes,
                 Set<String> returnTypes, String dir, boolean structural, int limit, Set<String> allowed) {

        /** GC-04: {@code types} — прежний смысл, один фильтр на обход и на выдачу. */
        static Query neighborhood(String rootKey, int depth, Set<String> rels, Set<String> types,
                                  boolean structural, int limit, Set<String> allowed) {
            return new Query(rootKey, null, depth, rels, types, types, DIR_BOTH, structural, limit, allowed);
        }

        /** GC-05: раздельные фильтры и направление. */
        static Query neighborhood(String rootKey, int depth, Set<String> rels, Set<String> walkTypes,
                                  Set<String> returnTypes, String dir, boolean structural, int limit,
                                  Set<String> allowed) {
            return new Query(rootKey, null, depth, rels, walkTypes, returnTypes, dir, structural, limit, allowed);
        }

        static Query slice(List<Node> seeds, Set<String> rels, Set<String> types,
                           boolean structural, int limit, Set<String> allowed) {
            return new Query(null, seeds, 1, rels, types, types, DIR_BOTH, structural, limit, allowed);
        }

        static Query slice(List<Node> seeds, Set<String> rels, Set<String> walkTypes, Set<String> returnTypes,
                           String dir, boolean structural, int limit, Set<String> allowed) {
            return new Query(null, seeds, 1, rels, walkTypes, returnTypes, dir, structural, limit, allowed);
        }
    }

    static final String DIR_BOTH = "both";
    static final String DIR_IN = "in";
    static final String DIR_OUT = "out";
    static final Set<String> DIRS = Set.of(DIR_BOTH, DIR_IN, DIR_OUT);

    /**
     * GC-05 (SPEC-LORE-GRAPH-SEARCH §4): фильтры типов. {@code types} — прежний смысл (оба фильтра сразу);
     * вместе с {@code walk_types}/{@code return_types} — 400: два ответа на один вопрос «через что идти».
     */
    record Filters(Set<String> walk, Set<String> ret) {
        static Filters of(Set<String> types, Set<String> walk, Set<String> ret) {
            boolean legacy = types != null && !types.isEmpty();
            boolean split = (walk != null && !walk.isEmpty()) || (ret != null && !ret.isEmpty());
            if (legacy && split) {
                throw new GraphException(400, "BAD_PARAMS",
                    "types задаёт оба фильтра сразу — не передавайте его вместе с walk_types/return_types");
            }
            if (legacy) return new Filters(Set.copyOf(types), Set.copyOf(types));
            return new Filters(walk == null ? Set.of() : Set.copyOf(walk), ret == null ? Set.of() : Set.copyOf(ret));
        }
    }

    /**
     * Действующее исключение структурных рёбер: слой выключен — исключены все структурные, КРОМЕ
     * названных в {@code rels} явно (SPEC §4: проба 19.11.2026 — спринт с types=task дал 1 узел,
     * задачи висят на PART_OF). Назвать ребро и не получить его — молчаливое противоречие запросу.
     */
    static Set<String> excludedRels(boolean structural, Set<String> rels) {
        if (structural) return Set.of();
        if (rels == null || rels.isEmpty()) return STRUCTURAL_RELS;
        Set<String> out = new HashSet<>(STRUCTURAL_RELS);
        out.removeAll(rels);
        return Set.copyOf(out);
    }

    static String checkDir(String dir) {
        String d = dir == null || dir.isBlank() ? DIR_BOTH : dir.strip();
        if (!DIRS.contains(d)) throw new GraphException(400, "BAD_PARAMS", "dir — in, out или both; получено «" + dir + "»");
        return d;
    }

    /** Ответ без {@code took_ms} (его ставит ресурс: время — не функция входа). */
    record Result(List<Map<String, Object>> nodes, List<Map<String, Object>> edges, Map<String, Object> meta) {
        Map<String, Object> toJson() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("nodes", nodes);
            m.put("edges", edges);
            m.put("meta", meta);
            return m;
        }
    }

    static final int MAX_DEPTH = 4;

    // ── скоуп ────────────────────────────────────────────────────────────────

    /** Разбор {@code scope}. Неизвестный вид или пустое значение — 400, а не «всё». */
    static Scope parseScope(String raw) {
        String s = raw == null ? "" : raw.strip();
        if ("all".equals(s)) return new Scope("all", null);
        int colon = s.indexOf(':');
        String kind = colon < 0 ? s : s.substring(0, colon);
        String value = colon < 0 ? "" : s.substring(colon + 1).strip();
        if (("project".equals(kind) || "component".equals(kind)) && !value.isEmpty()
                && LoreResourceBase.SAFE_ID.matcher(value).matches()) {
            return new Scope(kind, value);
        }
        throw new GraphException(400, "BAD_SCOPE",
            "scope «" + s + "» не распознан: допустимо all | project:<slug> | component:<id>");
    }

    /** Срез чужого проекта — 403, как адресный слайс вне скоупа. Пустой скоуп — 403 SCOPE_EMPTY. */
    static void checkSliceScope(Scope scope, Set<String> allowed) {
        requireNonEmpty(allowed);
        if (allowed != null && "project".equals(scope.kind()) && !allowed.contains(scope.value())) {
            throw new GraphException(403, "OUTSIDE_SCOPE",
                "проект «" + scope.value() + "» вне разрешённых вызывающему проектов");
        }
    }

    static void requireNonEmpty(Set<String> allowed) {
        if (allowed != null && allowed.isEmpty()) {
            throw new GraphException(403, "SCOPE_EMPTY",
                "проектный скоуп: у вызывающего нет ни одного разрешённого проекта — граф не отдаётся пустым");
        }
    }

    static boolean visible(Node n, Set<String> allowed) {
        if (allowed == null || !n.scoped()) return true;
        for (String p : n.projects()) if (allowed.contains(p)) return true;
        return false;
    }

    // ── сборка ───────────────────────────────────────────────────────────────

    private static final Comparator<Node> BY_TYPE_ID =
        Comparator.comparing(Node::type).thenComparing(Node::id).thenComparing(Node::key);

    private static final Comparator<Edge> EDGE_ORDER = Comparator
        .comparing(Edge::from).thenComparing(Edge::rel).thenComparing(Edge::to)
        .thenComparing(e -> e.kind() == null ? "" : e.kind());

    /**
     * Сборка ответа. 11.11.2026 (GC-04, «связи определённого типа»): {@code meta.rels_available} —
     * типы рёбер окрестности на запрошенной глубине БЕЗ фильтра {@code rels} (со счётчиком,
     * по убыванию числа, затем по имени), чтобы легенда показывала и снятые типы. С фильтром
     * это второй обход без {@code rels} (те же types/structural/limit/скоуп): обход по
     * отфильтрованным рёбрам другую окрестность и даёт, её счёт был бы не тем.
     */
    static Result build(Query q, Source src) {
        Result r = traverse(q, src);
        boolean filtered = q.rels() != null && !q.rels().isEmpty();
        Result plain = filtered
            ? traverse(new Query(q.rootKey(), q.seeds(), q.depth(), Set.of(), q.walkTypes(), q.returnTypes(), q.dir(),
                q.structural(), q.limit(), q.allowed()), src)
            : r;
        Map<String, Integer> counts = new HashMap<>();
        for (Map<String, Object> e : plain.edges()) counts.merge(String.valueOf(e.get("rel")), 1, Integer::sum);
        List<Map.Entry<String, Integer>> sorted = new ArrayList<>(counts.entrySet());
        sorted.sort(Map.Entry.<String, Integer>comparingByValue().reversed().thenComparing(Map.Entry.comparingByKey()));
        List<Map<String, Object>> available = new ArrayList<>();
        for (Map.Entry<String, Integer> en : sorted) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("rel", en.getKey());
            m.put("count", en.getValue());
            available.add(m);
        }
        r.meta().put("rels_available", available);
        // Неполнота счёта названа: срезанная потолком окрестность считает только то, что вошло.
        r.meta().put("rels_available_truncated", plain.meta().get("truncated"));
        return r;
    }

    private static Result traverse(Query q, Source src) {
        boolean neighborhood = q.rootKey() != null;
        if (neighborhood && (q.depth() < 1 || q.depth() > MAX_DEPTH)) {
            throw new GraphException(400, "BAD_PARAMS", "depth — от 1 до " + MAX_DEPTH + ", получено " + q.depth());
        }
        if (q.limit() < 1) throw new GraphException(400, "BAD_PARAMS", "limit — не меньше 1");
        requireNonEmpty(q.allowed());

        Set<String> rels = q.rels() == null ? Set.of() : q.rels();
        Set<String> walk = q.walkTypes() == null ? Set.of() : q.walkTypes();
        Set<String> ret = q.returnTypes() == null ? Set.of() : q.returnTypes();
        String walkDir = checkDir(q.dir());
        Set<String> exclude = excludedRels(q.structural(), rels);
        // Узел попадает в обход, если его тип проходим (walk) или возвращаем (ret); раскрывается дальше —
        // только проходимый. Пустой фильтр — «все типы».
        java.util.function.Predicate<Node> admitted = n -> walk.isEmpty() || walk.contains(n.type())
            || ret.isEmpty() || ret.contains(n.type());
        java.util.function.Predicate<Node> expandable = n -> walk.isEmpty() || walk.contains(n.type());
        java.util.function.Predicate<Node> returned = n -> ret.isEmpty() || ret.contains(n.type());

        Map<String, Node> known = new HashMap<>();      // всё прочитанное из источника
        Map<String, Integer> depthOf = new LinkedHashMap<>(); // ключ → уровень (узлы ответа)
        Set<String> hidden = new HashSet<>();
        Set<String> missing = new HashSet<>();
        Set<Edge> kept = new HashSet<>();
        // (наш id, rel, dir, причина) → число рёбер
        Map<List<String>, Integer> dangling = new TreeMap<>(LoreGraphBuilder::compareLists);
        boolean truncated = false;

        // ── уровень 0 ──
        List<Node> level0 = new ArrayList<>();
        if (neighborhood) {
            Node root = src.nodes(List.of(q.rootKey())).get(q.rootKey());
            if (root == null) throw new GraphException(404, "NOT_FOUND", "запись «" + q.rootKey() + "» не найдена");
            if (!visible(root, q.allowed())) {
                throw new GraphException(403, "OUTSIDE_SCOPE",
                    root.type() + " «" + root.id() + "» существует, но вне разрешённых вызывающему проектов");
            }
            level0.add(root);
        } else {
            for (Node n : q.seeds() == null ? List.<Node>of() : q.seeds()) {
                known.put(n.key(), n);
                if (!visible(n, q.allowed())) { hidden.add(n.key()); continue; }
                if (!admitted.test(n)) continue;
                level0.add(n);
            }
        }
        level0.sort(BY_TYPE_ID);
        for (Node n : level0) {
            known.put(n.key(), n);
            if (depthOf.containsKey(n.key())) continue;
            if (depthOf.size() >= q.limit()) { truncated = true; break; }
            depthOf.put(n.key(), 0);
        }

        // ── кольца ──
        int maxDepth = neighborhood ? q.depth() : 1;
        for (int d = 0; d < maxDepth; d++) {
            final int level = d;
            // Корень/семена раскрываются всегда; дальше — только узлы проходимого типа (walk_types).
            List<String> frontier = depthOf.entrySet().stream()
                .filter(e -> e.getValue() == level)
                .filter(e -> level == 0 || expandable.test(known.get(e.getKey())))
                .map(Map.Entry::getKey).sorted().toList();
            if (frontier.isEmpty()) break;
            Set<String> frontierSet = new HashSet<>(frontier);

            List<Edge> edges = new ArrayList<>();
            for (Edge e : src.edges(frontier, exclude)) {
                if (exclude.contains(e.rel())) continue;
                if (!rels.isEmpty() && !rels.contains(e.rel())) continue;
                if (!frontierSet.contains(e.from()) && !frontierSet.contains(e.to())) continue;
                // dir=out — только рёбра ИЗ фронта, dir=in — только В фронт (SPEC §4: влияние вверх/вниз).
                if (DIR_OUT.equals(walkDir) && !frontierSet.contains(e.from())) continue;
                if (DIR_IN.equals(walkDir) && !frontierSet.contains(e.to())) continue;
                edges.add(e);
            }
            edges.sort(EDGE_ORDER);

            Set<String> unknown = new TreeSet<>();
            for (Edge e : edges) {
                if (!known.containsKey(e.from())) unknown.add(e.from());
                if (!known.containsKey(e.to())) unknown.add(e.to());
            }
            unknown.removeAll(missing);
            if (!unknown.isEmpty()) {
                for (Map.Entry<String, Node> en : src.nodes(unknown).entrySet()) known.put(en.getKey(), en.getValue());
                for (String k : unknown) if (!known.containsKey(k)) missing.add(k);
            }

            Map<String, Node> candidates = new HashMap<>();
            List<Edge> pending = new ArrayList<>();
            for (Edge e : edges) {
                // Обе стороны из фронта — ребро внутри уровня, конец уже есть.
                String self = DIR_IN.equals(walkDir) ? e.to()
                    : frontierSet.contains(e.from()) ? e.from() : e.to();
                String other = self.equals(e.from()) ? e.to() : e.from();
                String dir = self.equals(e.from()) ? "out" : "in";
                if (depthOf.containsKey(other)) { pending.add(e); continue; }
                Node o = known.get(other);
                String selfId = known.get(self).id();
                if (o == null) {
                    dangling.merge(List.of(selfId, e.rel(), dir, MISSING), 1, Integer::sum);
                    continue;
                }
                if (!visible(o, q.allowed())) {
                    hidden.add(other);
                    dangling.merge(List.of(selfId, e.rel(), dir, HIDDEN), 1, Integer::sum);
                    continue;
                }
                if (!admitted.test(o)) continue; // тип ни проходим, ни возвращаем — через него не идём
                candidates.put(other, o);
                pending.add(e);
            }
            List<Node> next = new ArrayList<>(candidates.values());
            next.sort(BY_TYPE_ID);
            for (Node n : next) {
                if (depthOf.size() >= q.limit()) { truncated = true; break; }
                depthOf.put(n.key(), d + 1);
            }
            for (Edge e : pending) {
                if (depthOf.containsKey(e.from()) && depthOf.containsKey(e.to())) kept.add(e);
            }
        }

        // ── ответ ──
        // return_types: пройденный, но не возвращаемый узел в nodes не идёт — он схлопывается в ребро via.
        Set<String> shown = new HashSet<>();
        for (Map.Entry<String, Integer> en : depthOf.entrySet()) {
            Node n = known.get(en.getKey());
            if ((neighborhood && en.getValue() == 0) || returned.test(n)) shown.add(en.getKey());
        }
        List<Map<String, Object>> viaEdges = viaEdges(depthOf, shown, kept, known);
        kept.removeIf(e -> !shown.contains(e.from()) || !shown.contains(e.to()));
        int walkedNotReturned = depthOf.size() - shown.size();

        List<Node> outNodes = new ArrayList<>();
        for (String k : depthOf.keySet()) if (shown.contains(k)) outNodes.add(known.get(k));
        outNodes.sort(Comparator.comparing((Node n) -> depthOf.get(n.key())).thenComparing(BY_TYPE_ID));
        List<Map<String, Object>> nodes = new ArrayList<>();
        for (Node n : outNodes) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", n.id());
            m.put("type", n.type());
            m.put("title", n.title());
            m.put("status", n.status());
            m.put("status_category", n.statusCategory());
            m.put("depth", depthOf.get(n.key()));
            nodes.add(m);
        }

        List<Edge> outEdges = new ArrayList<>();
        for (Edge e : kept) {
            outEdges.add(new Edge(known.get(e.from()).id(), e.rel(), known.get(e.to()).id(),
                STRUCTURAL_RELS.contains(e.rel()) ? KIND_STRUCTURAL : e.kind()));
        }
        outEdges.sort(EDGE_ORDER);
        List<Map<String, Object>> edgesJson = new ArrayList<>();
        Set<List<String>> seen = new LinkedHashSet<>();
        for (Edge e : outEdges) {
            // Параллельные рёбра одного типа между теми же концами — одно ребро графа.
            if (!seen.add(java.util.Arrays.asList(e.from(), e.rel(), e.to(), e.kind()))) continue;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("from", e.from());
            m.put("rel", e.rel());
            m.put("to", e.to());
            if (e.kind() != null) m.put("kind", e.kind());
            edgesJson.add(m);
        }
        edgesJson.addAll(viaEdges);

        List<Map<String, Object>> danglingJson = new ArrayList<>();
        boolean anyMissing = false;
        for (Map.Entry<List<String>, Integer> en : dangling.entrySet()) {
            List<String> k = en.getKey();
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", k.get(0));
            m.put("rel", k.get(1));
            m.put("dir", k.get(2));
            m.put("reason", k.get(3));
            m.put("count", en.getValue());
            danglingJson.add(m);
            if (MISSING.equals(k.get(3))) anyMissing = true;
        }

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("mode", neighborhood ? "neighborhood" : "slice");
        if (neighborhood) meta.put("depth", q.depth());
        // by_depth: число узлов на каждом уровне 1..depth (корень/семена не входят);
        // пустой уровень — 0, а не отсутствие ключа. Ключи — строки (JSON-объект).
        Map<String, Integer> byDepth = new LinkedHashMap<>();
        for (int d = 1; d <= maxDepth; d++) byDepth.put(String.valueOf(d), 0);
        for (String k : shown) {
            int d = depthOf.get(k);
            if (d >= 1) byDepth.merge(String.valueOf(d), 1, Integer::sum);
        }
        meta.put("complete", !truncated && !anyMissing);
        meta.put("truncated", truncated);
        meta.put("capped_at", truncated ? q.limit() : null);
        // Действующий потолок — всегда, а не только при срабатывании: на depth 3–4 он решает,
        // полна ли картина (замер 11.11.2026: на графе формы LORE depth 4 без фильтра rels
        // упирается в 500 почти всегда).
        meta.put("limit", q.limit());
        meta.put("hidden_by_scope", hidden.size());
        meta.put("dangling", danglingJson);
        // #1228: у последнего уровня рёбра не читаются — ни в окрестности (уровень depth),
        // ни в срезе (кольцо depth 1). Ребро между двумя такими узлами в ответ не попадает,
        // и это названо, а не угадывается по отсутствию.
        meta.put("frontier_edges", FRONTIER_NOT_READ);
        meta.put("structural", q.structural());
        meta.put("structural_rels", new TreeSet<>(STRUCTURAL_RELS));
        meta.put("by_depth", byDepth);
        // rels — эхо фильтра: обход шёл ТОЛЬКО по этим рёбрам на каждом шаге (пусто — по всем).
        meta.put("rels", new TreeSet<>(rels));
        // GC-05: эхо направления и раздельных фильтров; сколько пройдено без возврата — названо числом.
        meta.put("dir", walkDir);
        meta.put("walk_types", new TreeSet<>(walk));
        meta.put("return_types", new TreeSet<>(ret));
        meta.put("walked_not_returned", walkedNotReturned);
        return new Result(nodes, edgesJson, meta);
    }

    /**
     * Рёбра {@code via}: компоненты связности из пройденных, но не возвращаемых узлов; каждая пара
     * возвращаемых узлов, касающихся одной компоненты, получает ребро
     * {@code {from, rel:"via", to, via:[{rel,type,count}]}} — {@code count} = сколько узлов этого типа
     * компоненты касаются ребра этого типа. {@code from} — узел меньшей глубины (затем меньший id).
     */
    private static List<Map<String, Object>> viaEdges(Map<String, Integer> depthOf, Set<String> shown, Set<Edge> kept,
                                                       Map<String, Node> known) {
        if (shown.size() == depthOf.size()) return List.of();
        Map<String, List<Edge>> adj = new HashMap<>();
        for (Edge e : kept) {
            adj.computeIfAbsent(e.from(), k -> new ArrayList<>()).add(e);
            adj.computeIfAbsent(e.to(), k -> new ArrayList<>()).add(e);
        }
        Comparator<String> order = Comparator.comparing((String k) -> depthOf.get(k))
            .thenComparing(k -> known.get(k).id());
        // (from, to) → (rel, type) → множество via-узлов
        Map<List<String>, Map<List<String>, Set<String>>> pairs = new TreeMap<>(LoreGraphBuilder::compareLists);
        Set<String> done = new HashSet<>();
        List<String> viaNodes = depthOf.keySet().stream().filter(k -> !shown.contains(k)).sorted().toList();
        for (String start : viaNodes) {
            if (done.contains(start)) continue;
            Set<String> comp = new TreeSet<>();
            Set<String> ends = new TreeSet<>(order);
            java.util.ArrayDeque<String> queue = new java.util.ArrayDeque<>(List.of(start));
            comp.add(start);
            while (!queue.isEmpty()) {
                String v = queue.poll();
                for (Edge e : adj.getOrDefault(v, List.of())) {
                    String o = e.from().equals(v) ? e.to() : e.from();
                    if (shown.contains(o)) ends.add(o);
                    else if (comp.add(o)) queue.add(o);
                }
            }
            done.addAll(comp);
            if (ends.size() < 2) continue;
            Map<List<String>, Set<String>> parts = new TreeMap<>(LoreGraphBuilder::compareLists);
            for (String v : comp) {
                for (Edge e : adj.getOrDefault(v, List.of())) {
                    parts.computeIfAbsent(List.of(e.rel(), known.get(v).type()), k -> new TreeSet<>()).add(v);
                }
            }
            List<String> endList = new ArrayList<>(ends);
            for (int i = 0; i < endList.size(); i++) {
                for (int j = i + 1; j < endList.size(); j++) {
                    List<String> key = List.of(known.get(endList.get(i)).id(), known.get(endList.get(j)).id());
                    Map<List<String>, Set<String>> agg = pairs.computeIfAbsent(key, k -> new TreeMap<>(LoreGraphBuilder::compareLists));
                    for (Map.Entry<List<String>, Set<String>> p : parts.entrySet())
                        agg.computeIfAbsent(p.getKey(), k -> new TreeSet<>()).addAll(p.getValue());
                }
            }
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map.Entry<List<String>, Map<List<String>, Set<String>>> en : pairs.entrySet()) {
            List<Map<String, Object>> via = new ArrayList<>();
            for (Map.Entry<List<String>, Set<String>> p : en.getValue().entrySet()) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("rel", p.getKey().get(0));
                m.put("type", p.getKey().get(1));
                m.put("count", p.getValue().size());
                via.add(m);
            }
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("from", en.getKey().get(0));
            m.put("rel", "via");
            m.put("to", en.getKey().get(1));
            m.put("via", via);
            out.add(m);
        }
        return out;
    }

    private static int compareLists(List<String> a, List<String> b) {
        for (int i = 0; i < Math.min(a.size(), b.size()); i++) {
            int c = Objects.compare(a.get(i), b.get(i), Comparator.naturalOrder());
            if (c != 0) return c;
        }
        return Integer.compare(a.size(), b.size());
    }
}
