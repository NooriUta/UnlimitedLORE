package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-04 — чистый сборщик графа {@code GET /lore/graph}:
 * обход в ширину в обе стороны, фильтры rels/types, слой структурных рёбер, потолок,
 * висячие концы, проектный скоуп fail-closed, детерминированный порядок.
 * Без Quarkus и без БД: источник — граф в памяти.
 */
class LoreGraphBuilderTest {

    // ── источник в памяти ────────────────────────────────────────────────────

    /** Граф в памяти. {@code reversed} — отдавать строки в обратном порядке (проверка детерминизма). */
    static final class MemSource implements LoreGraphBuilder.Source {
        final Map<String, LoreGraphBuilder.Node> nodes = new LinkedHashMap<>();
        final List<LoreGraphBuilder.Edge> edges = new ArrayList<>();
        boolean reversed;

        MemSource node(String id, String type, String... projects) {
            nodes.put(id, new LoreGraphBuilder.Node(id, id, type, "t:" + id, null, null, Set.of(projects), true));
            return this;
        }

        MemSource shared(String id, String type) {
            nodes.put(id, new LoreGraphBuilder.Node(id, id, type, "t:" + id, null, null, Set.of(), false));
            return this;
        }

        MemSource edge(String from, String rel, String to) { return edge(from, rel, to, null); }

        MemSource edge(String from, String rel, String to, String kind) {
            edges.add(new LoreGraphBuilder.Edge(from, rel, to, kind));
            return this;
        }

        @Override
        public Map<String, LoreGraphBuilder.Node> nodes(Collection<String> keys) {
            Map<String, LoreGraphBuilder.Node> out = new LinkedHashMap<>();
            List<String> ks = new ArrayList<>(keys);
            if (reversed) Collections.reverse(ks);
            for (String k : ks) if (nodes.containsKey(k)) out.put(k, nodes.get(k));
            return out;
        }

        @Override
        public List<LoreGraphBuilder.Edge> edges(Collection<String> keys, Set<String> excludeRels) {
            List<LoreGraphBuilder.Edge> out = new ArrayList<>();
            for (LoreGraphBuilder.Edge e : edges)
                if ((keys.contains(e.from()) || keys.contains(e.to())) && !excludeRels.contains(e.rel())) out.add(e);
            if (reversed) Collections.reverse(out);
            return out;
        }

        List<LoreGraphBuilder.Node> all() { return new ArrayList<>(nodes.values()); }
    }

    /** A1 ← T1 (JUSTIFIED_BY), A1 → S1 (IMPLEMENTED_IN), S1 → S2 (DEPENDS_ON hard), T1 → S1 (PART_OF, структура). */
    static MemSource sample() {
        return new MemSource()
            .node("ADR-1", "adr", "p1")
            .node("S1", "sprint", "p1")
            .node("S2", "sprint", "p1")
            .node("S1/T1", "task", "p1")
            .edge("S1/T1", "JUSTIFIED_BY", "ADR-1")
            .edge("ADR-1", "IMPLEMENTED_IN", "S1")
            .edge("S1", "DEPENDS_ON", "S2", "hard")
            .edge("S1/T1", "PART_OF", "S1");
    }

    static LoreGraphBuilder.Result around(MemSource src, String root, int depth) {
        return LoreGraphBuilder.build(LoreGraphBuilder.Query.neighborhood(root, depth, Set.of(), Set.of(), false, 500, null), src);
    }

    static List<String> ids(LoreGraphBuilder.Result r) {
        return r.nodes().stream().map(n -> String.valueOf(n.get("id"))).toList();
    }

    static List<String> edgeKeys(LoreGraphBuilder.Result r) {
        return r.edges().stream().map(e -> e.get("from") + " " + e.get("rel") + " " + e.get("to")).toList();
    }

    static Map<String, Object> nodeOf(LoreGraphBuilder.Result r, String id) {
        return r.nodes().stream().filter(n -> id.equals(n.get("id"))).findFirst().orElse(null);
    }

    // ── окрестность ──────────────────────────────────────────────────────────

    @Test
    void depthOneGoesBothWays() {
        LoreGraphBuilder.Result r = around(sample(), "ADR-1", 1);
        assertEquals(List.of("ADR-1", "S1", "S1/T1"), ids(r), "входящее (задача) и исходящее (спринт) — оба на глубине 1");
        assertEquals(0, nodeOf(r, "ADR-1").get("depth"));
        assertEquals(1, nodeOf(r, "S1").get("depth"));
        assertEquals(1, nodeOf(r, "S1/T1").get("depth"));
        assertEquals(List.of("ADR-1 IMPLEMENTED_IN S1", "S1/T1 JUSTIFIED_BY ADR-1"), edgeKeys(r));
        assertEquals(Boolean.TRUE, r.meta().get("complete"));
        assertEquals(Boolean.FALSE, r.meta().get("truncated"));
        assertNull(r.meta().get("capped_at"));
    }

    @Test
    void depthTwoReachesTheSecondRingAndCarriesEdgeKind() {
        LoreGraphBuilder.Result r = around(sample(), "ADR-1", 2);
        assertEquals(List.of("ADR-1", "S1", "S1/T1", "S2"), ids(r));
        assertEquals(2, nodeOf(r, "S2").get("depth"));
        Map<String, Object> dep = r.edges().stream().filter(e -> "DEPENDS_ON".equals(e.get("rel"))).findFirst().orElseThrow();
        assertEquals("hard", dep.get("kind"));
        // Ребро без вида — без ключа kind, а не kind:null.
        Map<String, Object> impl = r.edges().stream().filter(e -> "IMPLEMENTED_IN".equals(e.get("rel"))).findFirst().orElseThrow();
        assertFalse(impl.containsKey("kind"));
    }

    @Test
    void incomingEdgeIsWalkedFromTheTarget() {
        // Из S2 есть только входящее DEPENDS_ON — обход в обе стороны его обязан найти.
        LoreGraphBuilder.Result r = around(sample(), "S2", 2);
        assertEquals(List.of("S2", "S1", "ADR-1"), ids(r));
    }

    @Test
    void relsFilterKeepsOnlyNamedEdges() {
        LoreGraphBuilder.Result r = LoreGraphBuilder.build(
            LoreGraphBuilder.Query.neighborhood("ADR-1", 2, Set.of("JUSTIFIED_BY"), Set.of(), false, 500, null), sample());
        assertEquals(List.of("ADR-1", "S1/T1"), ids(r));
        assertEquals(List.of("S1/T1 JUSTIFIED_BY ADR-1"), edgeKeys(r));
    }

    @Test
    void typesFilterKeepsOnlyNamedNodeTypesAndDoesNotWalkThroughOthers() {
        LoreGraphBuilder.Result r = LoreGraphBuilder.build(
            LoreGraphBuilder.Query.neighborhood("ADR-1", 2, Set.of(), Set.of("task"), false, 500, null), sample());
        assertEquals(List.of("ADR-1", "S1/T1"), ids(r), "корень остаётся, спринты отфильтрованы и через них не идём");
    }

    @Test
    void structuralLayerIsOffByDefaultAndMarkedWhenOn() {
        LoreGraphBuilder.Result off = around(sample(), "S1/T1", 1);
        assertEquals(List.of("S1/T1", "ADR-1"), ids(off), "PART_OF — структура, по умолчанию не показывается");

        LoreGraphBuilder.Result on = LoreGraphBuilder.build(
            LoreGraphBuilder.Query.neighborhood("S1/T1", 1, Set.of(), Set.of(), true, 500, null), sample());
        assertEquals(List.of("S1/T1", "ADR-1", "S1"), ids(on));
        Map<String, Object> part = on.edges().stream().filter(e -> "PART_OF".equals(e.get("rel"))).findFirst().orElseThrow();
        assertEquals("structural", part.get("kind"));
        assertTrue(LoreGraphBuilder.STRUCTURAL_RELS.contains("BELONGS_TO_PROJECT"));
        assertTrue(LoreGraphBuilder.STRUCTURAL_RELS.contains("PART_OF"));
    }

    @Test
    void capTruncatesDeterministicallyAndSaysSo() {
        MemSource src = new MemSource().node("ADR-1", "adr", "p1");
        for (String t : List.of("S/T5", "S/T3", "S/T1", "S/T4", "S/T2")) {
            src.node(t, "task", "p1").edge(t, "JUSTIFIED_BY", "ADR-1");
        }
        LoreGraphBuilder.Result r = LoreGraphBuilder.build(
            LoreGraphBuilder.Query.neighborhood("ADR-1", 1, Set.of(), Set.of(), false, 3, null), src);
        assertEquals(List.of("ADR-1", "S/T1", "S/T2"), ids(r), "под потолок попадают первые по (type, id)");
        assertEquals(Boolean.TRUE, r.meta().get("truncated"));
        assertEquals(3, r.meta().get("capped_at"));
        assertEquals(Boolean.FALSE, r.meta().get("complete"));
        assertEquals(2, r.edges().size(), "ребро к срезанному узлу не отдаётся");
    }

    @Test
    void edgeToMissingNodeIsDangling() {
        MemSource src = sample().edge("ADR-1", "DEPENDS_ON", "ADR-GHOST");
        LoreGraphBuilder.Result r = around(src, "ADR-1", 1);
        assertFalse(ids(r).contains("ADR-GHOST"));
        assertFalse(edgeKeys(r).contains("ADR-1 DEPENDS_ON ADR-GHOST"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> dangling = (List<Map<String, Object>>) r.meta().get("dangling");
        assertEquals(1, dangling.size());
        assertEquals("ADR-1", dangling.get(0).get("id"));
        assertEquals("DEPENDS_ON", dangling.get(0).get("rel"));
        assertEquals("out", dangling.get(0).get("dir"));
        assertEquals("missing", dangling.get(0).get("reason"));
        assertEquals(Boolean.FALSE, r.meta().get("complete"), "отсутствующий конец — ответ неполон");
    }

    // ── скоуп ────────────────────────────────────────────────────────────────

    @Test
    void foreignProjectNodeIsHiddenCountedAndNotLeaked() {
        MemSource src = new MemSource()
            .node("S1", "sprint", "p1")
            .node("SPRINT_FOREIGN_SECRET", "sprint", "p2")
            .shared("COMP-1", "component")
            .edge("S1", "DEPENDS_ON", "SPRINT_FOREIGN_SECRET", "hard")
            .edge("S1", "USES", "COMP-1");
        LoreGraphBuilder.Result r = LoreGraphBuilder.build(
            LoreGraphBuilder.Query.neighborhood("S1", 2, Set.of(), Set.of(), false, 500, Set.of("p1")), src);
        assertEquals(List.of("S1", "COMP-1"), ids(r), "общий справочник виден, чужой спринт — нет");
        assertEquals(1, r.meta().get("hidden_by_scope"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> dangling = (List<Map<String, Object>>) r.meta().get("dangling");
        assertEquals(1, dangling.size());
        assertEquals("hidden_by_scope", dangling.get(0).get("reason"));
        assertEquals("S1", dangling.get(0).get("id"), "висячий конец назван со стороны видимого узла");
        String json = new JsonObject(r.toJson()).encode();
        assertFalse(json.contains("SPRINT_FOREIGN_SECRET"), "id чужой записи утёк в ответ: " + json);
        assertEquals(Boolean.TRUE, r.meta().get("complete"), "скрытое скоупом не делает ответ неполным — оно посчитано");
    }

    @Test
    void emptyScopeIsRefusedNotAnEmptyGraph() {
        LoreGraphBuilder.GraphException e = assertThrows(LoreGraphBuilder.GraphException.class, () ->
            LoreGraphBuilder.build(LoreGraphBuilder.Query.neighborhood("S1", 1, Set.of(), Set.of(), false, 500, Set.of()), sample()));
        assertEquals(403, e.status());
        assertEquals("SCOPE_EMPTY", e.code());
    }

    @Test
    void rootOutsideScopeIsRefusedAndMissingRootIsNotFound() {
        LoreGraphBuilder.GraphException out = assertThrows(LoreGraphBuilder.GraphException.class, () ->
            LoreGraphBuilder.build(LoreGraphBuilder.Query.neighborhood("S1", 1, Set.of(), Set.of(), false, 500, Set.of("p9")), sample()));
        assertEquals(403, out.status());
        assertEquals("OUTSIDE_SCOPE", out.code());
        LoreGraphBuilder.GraphException nf = assertThrows(LoreGraphBuilder.GraphException.class, () ->
            around(sample(), "NOPE", 1));
        assertEquals(404, nf.status());
    }

    @Test
    void unknownScopeIsRefused() {
        for (String bad : List.of("galaxy:x", "project:", "component:", "", "all:x", "project")) {
            LoreGraphBuilder.GraphException e = assertThrows(LoreGraphBuilder.GraphException.class,
                () -> LoreGraphBuilder.parseScope(bad), "скоуп «" + bad + "» обязан быть отказом");
            assertEquals(400, e.status());
        }
        assertEquals(new LoreGraphBuilder.Scope("all", null), LoreGraphBuilder.parseScope("all"));
        assertEquals(new LoreGraphBuilder.Scope("project", "AIDA/UnlimitedLORE"), LoreGraphBuilder.parseScope("project:AIDA/UnlimitedLORE"));
        assertEquals(new LoreGraphBuilder.Scope("component", "LORE_GRAPH"), LoreGraphBuilder.parseScope("component:LORE_GRAPH"));
    }

    @Test
    void sliceOfForeignProjectIsRefused() {
        LoreGraphBuilder.GraphException e = assertThrows(LoreGraphBuilder.GraphException.class,
            () -> LoreGraphBuilder.checkSliceScope(LoreGraphBuilder.parseScope("project:p2"), Set.of("p1")));
        assertEquals(403, e.status());
        assertEquals("OUTSIDE_SCOPE", e.code());
        // Без ограничения и в своём проекте — можно.
        LoreGraphBuilder.checkSliceScope(LoreGraphBuilder.parseScope("project:p2"), null);
        LoreGraphBuilder.checkSliceScope(LoreGraphBuilder.parseScope("project:p1"), Set.of("p1"));
        LoreGraphBuilder.checkSliceScope(LoreGraphBuilder.parseScope("all"), Set.of("p1"));
    }

    @Test
    void depthOutsideOneToThreeIsRefused() {
        for (int d : new int[]{0, 4}) {
            LoreGraphBuilder.GraphException e = assertThrows(LoreGraphBuilder.GraphException.class,
                () -> around(sample(), "ADR-1", d));
            assertEquals(400, e.status());
        }
    }

    // ── срез ─────────────────────────────────────────────────────────────────

    @Test
    void sliceReturnsSeedsAndTheirRingWithHiddenCounted() {
        MemSource src = sample()
            .node("S9", "sprint", "p2")
            .edge("S2", "DEPENDS_ON", "S9", "soft");
        List<LoreGraphBuilder.Node> seeds = List.of(src.nodes.get("S1"), src.nodes.get("S2"), src.nodes.get("S9"));
        LoreGraphBuilder.Result r = LoreGraphBuilder.build(
            LoreGraphBuilder.Query.slice(seeds, Set.of(), Set.of(), false, 500, Set.of("p1")), src);
        assertEquals(List.of("S1", "S2", "ADR-1"), ids(r), "семена на глубине 0, их соседи — на 1; чужой S9 скрыт");
        assertEquals(0, nodeOf(r, "S2").get("depth"));
        assertEquals(1, nodeOf(r, "ADR-1").get("depth"));
        assertEquals(1, r.meta().get("hidden_by_scope"), "S9 посчитан один раз — и как семя, и как конец ребра");
        assertEquals(List.of("ADR-1 IMPLEMENTED_IN S1", "S1 DEPENDS_ON S2"), edgeKeys(r));
    }

    // ── #1228: вид ребра как есть, признак непрочитанных рёбер фронта ──────────

    @Test
    void dependsOnKindIsPassedThroughAsIs() {
        MemSource src = new MemSource()
            .node("S1", "sprint", "p1").node("S2", "sprint", "p1").node("S3", "sprint", "p1").node("S4", "sprint", "p1")
            .edge("S1", "DEPENDS_ON", "S2", "gate")
            .edge("S1", "DEPENDS_ON", "S3", "informs")
            .edge("S1", "DEPENDS_ON", "S4", "custom_kind");
        LoreGraphBuilder.Result r = around(src, "S1", 1);
        Map<String, Object> kinds = new LinkedHashMap<>();
        for (Map<String, Object> e : r.edges()) kinds.put(String.valueOf(e.get("to")), e.get("kind"));
        assertEquals(Map.of("S2", "gate", "S3", "informs", "S4", "custom_kind"), kinds);
    }

    @Test
    void neighborhoodSaysFrontierEdgesAreNotRead() {
        // S2 и ADR-1 — оба на последнем уровне; их общее ребро не читается.
        MemSource src = sample().edge("ADR-1", "DEPENDS_ON", "S2");
        LoreGraphBuilder.Result r = around(src, "S1", 1);
        assertTrue(ids(r).containsAll(List.of("ADR-1", "S2")));
        assertFalse(edgeKeys(r).contains("ADR-1 DEPENDS_ON S2"));
        assertEquals("not_read", r.meta().get("frontier_edges"));
    }

    @Test
    void sliceSaysRingEdgesAreNotRead() {
        // Семя S1, кольцо — ADR-1 и S2; ребро ADR-1 → S2 между узлами кольца не читается.
        MemSource src = sample().edge("ADR-1", "DEPENDS_ON", "S2");
        LoreGraphBuilder.Result r = LoreGraphBuilder.build(
            LoreGraphBuilder.Query.slice(List.of(src.nodes.get("S1")), Set.of(), Set.of(), false, 500, null), src);
        assertEquals(List.of("S1", "ADR-1", "S2"), ids(r));
        assertFalse(edgeKeys(r).contains("ADR-1 DEPENDS_ON S2"));
        assertEquals("not_read", r.meta().get("frontier_edges"));
    }

    // ── детерминизм ──────────────────────────────────────────────────────────

    @Test
    void sameInputGivesSameJsonWhateverTheSourceOrder() {
        MemSource a = sample().node("S0", "sprint", "p1").edge("S0", "DEPENDS_ON", "S1", "soft")
            .node("ADR-0", "adr", "p1").edge("ADR-0", "IMPLEMENTED_IN", "S1");
        MemSource b = sample().node("S0", "sprint", "p1").edge("S0", "DEPENDS_ON", "S1", "soft")
            .node("ADR-0", "adr", "p1").edge("ADR-0", "IMPLEMENTED_IN", "S1");
        b.reversed = true;
        LoreGraphBuilder.Query q = LoreGraphBuilder.Query.neighborhood("S1", 2, Set.of(), Set.of(), true, 500, null);
        String ja = new JsonObject(LoreGraphBuilder.build(q, a).toJson()).encode();
        String jb = new JsonObject(LoreGraphBuilder.build(q, b).toJson()).encode();
        String ja2 = new JsonObject(LoreGraphBuilder.build(q, a).toJson()).encode();
        assertEquals(ja, jb, "порядок строк источника не должен менять ответ");
        assertEquals(ja, ja2, "два прогона — одинаковый JSON");

        LoreGraphBuilder.Result r = LoreGraphBuilder.build(q, a);
        // Узлы — (depth, type, id); рёбра — (from, rel, to).
        assertEquals(List.of("S1", "ADR-0", "ADR-1", "S0", "S2", "S1/T1"), ids(r));
        List<String> ek = edgeKeys(r);
        List<String> sorted = new ArrayList<>(ek);
        Collections.sort(sorted);
        assertEquals(sorted, ek);
    }
}
