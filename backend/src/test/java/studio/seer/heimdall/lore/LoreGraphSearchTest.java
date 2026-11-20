package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-05 (SPEC-LORE-GRAPH-SEARCH §4, §7) — поиск по графу поверх
 * сборщика GC-04: раздельные фильтры «через что идти» ({@code walk_types}) и «что вернуть»
 * ({@code return_types}), направление обхода ({@code dir}), структурное ребро, названное в
 * {@code rels}, и путь между двумя точками. Без Quarkus и без БД — граф в памяти.
 */
class LoreGraphSearchTest {

    private static LoreGraphBuilderTest.MemSource src() {
        // ADR-1 ← T1 (JUSTIFIED_BY); T1 → T2 (DEPENDS_ON); T2 → ADR-2 (JUSTIFIED_BY);
        // S1 ← T1, T2 (PART_OF, структура); S1 → S2 (DEPENDS_ON).
        return new LoreGraphBuilderTest.MemSource()
            .node("ADR-1", "adr", "p1")
            .node("ADR-2", "adr", "p1")
            .node("S1", "sprint", "p1")
            .node("S2", "sprint", "p1")
            .node("S1/T1", "task", "p1")
            .node("S1/T2", "task", "p1")
            .edge("S1/T1", "JUSTIFIED_BY", "ADR-1")
            .edge("S1/T1", "DEPENDS_ON", "S1/T2")
            .edge("S1/T2", "JUSTIFIED_BY", "ADR-2")
            .edge("S1/T1", "PART_OF", "S1")
            .edge("S1/T2", "PART_OF", "S1")
            .edge("S1", "DEPENDS_ON", "S2");
    }

    private static LoreGraphBuilder.Result walk(LoreGraphBuilderTest.MemSource s, String root, int depth, Set<String> rels,
                                                Set<String> walk, Set<String> ret, String dir) {
        return LoreGraphBuilder.build(
            LoreGraphBuilder.Query.neighborhood(root, depth, rels, walk, ret, dir, false, 500, null), s);
    }

    // ── §4: структурное ребро, названное в rels ──────────────────────────────

    @Test
    void explicitStructuralRelIsWalkedWithoutStructuralFlag() {
        // Проба владелицы 19.11.2026: спринт с types=task,adr дал 1 узел — задачи висят на PART_OF.
        LoreGraphBuilder.Result r = walk(src(), "S1", 1, Set.of("PART_OF"), Set.of("task"), Set.of("task"), "both");
        assertEquals(List.of("S1", "S1/T1", "S1/T2"), LoreGraphBuilderTest.ids(r));
        assertEquals(List.of("S1/T1 PART_OF S1", "S1/T2 PART_OF S1"), LoreGraphBuilderTest.edgeKeys(r));
        assertEquals(Boolean.FALSE, r.meta().get("structural"), "слой структуры не включён — назван только PART_OF");
    }

    @Test
    void structuralRelNotNamedStaysOff() {
        LoreGraphBuilder.Result r = walk(src(), "S1", 1, Set.of(), Set.of(), Set.of(), "both");
        assertEquals(List.of("S1", "S2"), LoreGraphBuilderTest.ids(r));
    }

    // ── §4: walk_types ≠ return_types ────────────────────────────────────────

    @Test
    void walkThroughTasksReturnOnlyAdrs() {
        LoreGraphBuilder.Result r = walk(src(), "ADR-1", 3, Set.of(), Set.of("task"), Set.of("adr"), "both");
        assertEquals(List.of("ADR-1", "ADR-2"), LoreGraphBuilderTest.ids(r), "задачи пройдены, но не возвращены");
        Map<String, Object> via = r.edges().stream().filter(e -> "via".equals(e.get("rel"))).findFirst().orElse(null);
        assertNotNull(via, "пройденные задачи схлопнуты в ребро via");
        assertEquals("ADR-1", via.get("from"));
        assertEquals("ADR-2", via.get("to"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> parts = (List<Map<String, Object>>) via.get("via");
        assertTrue(parts.stream().anyMatch(p -> "task".equals(p.get("type")) && "DEPENDS_ON".equals(p.get("rel"))
            && Integer.valueOf(2).equals(p.get("count"))), String.valueOf(parts));
        assertEquals(2, r.meta().get("walked_not_returned"), "сколько пройдено без возврата — названо");
    }

    @Test
    void returnTypeNotInWalkTypesIsAReachedLeaf() {
        // walk=task: обход идёт только через задачи; ADR — конечная точка, через неё дальше не идём.
        LoreGraphBuilder.Result r = walk(src(), "S1/T1", 4, Set.of(), Set.of("task"), Set.of("task", "adr"), "both");
        assertEquals(List.of("S1/T1", "ADR-1", "S1/T2", "ADR-2"), LoreGraphBuilderTest.ids(r));
    }

    @Test
    void legacyTypesMeansBothFilters() {
        LoreGraphBuilder.Result legacy = LoreGraphBuilder.build(
            LoreGraphBuilder.Query.neighborhood("ADR-1", 3, Set.of(), Set.of("adr", "task"), false, 500, null), src());
        LoreGraphBuilder.Result split = walk(src(), "ADR-1", 3, Set.of(), Set.of("adr", "task"), Set.of("adr", "task"), "both");
        assertEquals(LoreGraphBuilderTest.ids(legacy), LoreGraphBuilderTest.ids(split));
        assertEquals(LoreGraphBuilderTest.edgeKeys(legacy), LoreGraphBuilderTest.edgeKeys(split));
    }

    @Test
    void typesTogetherWithWalkOrReturnIsRefused() {
        LoreGraphBuilder.GraphException e = assertThrows(LoreGraphBuilder.GraphException.class,
            () -> LoreGraphBuilder.Filters.of(Set.of("task"), Set.of("adr"), Set.of()));
        assertEquals(400, e.status());
        LoreGraphBuilder.Filters f = LoreGraphBuilder.Filters.of(Set.of("task"), Set.of(), Set.of());
        assertEquals(Set.of("task"), f.walk());
        assertEquals(Set.of("task"), f.ret());
    }

    // ── §4: направление ──────────────────────────────────────────────────────

    @Test
    void dirInWalksOnlyIncomingEdges() {
        // Радиус поражения ADR-2: кто на него опирается (вход), и кто опирается на тех (вход дальше).
        LoreGraphBuilder.Result r = walk(src(), "ADR-2", 2, Set.of(), Set.of(), Set.of(), "in");
        assertEquals(List.of("ADR-2", "S1/T2", "S1/T1"), LoreGraphBuilderTest.ids(r));
        assertEquals("in", r.meta().get("dir"));
    }

    @Test
    void dirOutWalksOnlyOutgoingEdges() {
        LoreGraphBuilder.Result r = walk(src(), "S1/T1", 2, Set.of(), Set.of(), Set.of(), "out");
        assertEquals(List.of("S1/T1", "ADR-1", "S1/T2", "ADR-2"), LoreGraphBuilderTest.ids(r));
    }

    @Test
    void badDirIsRefused() {
        assertThrows(LoreGraphBuilder.GraphException.class,
            () -> walk(src(), "S1/T1", 1, Set.of(), Set.of(), Set.of(), "up"));
    }

    // ── §7: путь между двумя точками ─────────────────────────────────────────

    private static LoreGraphPath.Result path(LoreGraphBuilderTest.MemSource s, String from, String to, int maxDepth, int k,
                                             String dir, Set<String> allowed) {
        return LoreGraphPath.find(new LoreGraphPath.Query(from, to, Set.of(), Set.of(), dir, false, maxDepth, k, allowed), s);
    }

    @SuppressWarnings("unchecked")
    private static List<String> pathIds(Map<String, Object> p) {
        return ((List<Map<String, Object>>) p.get("nodes")).stream().map(n -> String.valueOf(n.get("id"))).toList();
    }

    @Test
    void shortestPathIsFoundWithItsEdges() {
        LoreGraphPath.Result r = path(src(), "ADR-1", "ADR-2", 4, 1, "both", null);
        assertEquals(Boolean.TRUE, r.meta().get("found"));
        assertEquals(1, r.paths().size());
        Map<String, Object> p = r.paths().get(0);
        assertEquals(3, p.get("length"));
        assertEquals(List.of("ADR-1", "S1/T1", "S1/T2", "ADR-2"), pathIds(p));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> edges = (List<Map<String, Object>>) p.get("edges");
        assertEquals("S1/T1", edges.get(0).get("from"), "ребро — в своём настоящем направлении");
        assertEquals("JUSTIFIED_BY", edges.get(0).get("rel"));
        assertEquals("ADR-1", edges.get(0).get("to"));
    }

    @Test
    void noPathSaysUpToWhichDepth() {
        LoreGraphBuilderTest.MemSource s = src().node("ADR-9", "adr", "p1");
        LoreGraphPath.Result r = path(s, "ADR-1", "ADR-9", 6, 1, "both", null);
        assertEquals(Boolean.FALSE, r.meta().get("found"));
        assertEquals("no_path", r.meta().get("reason"));
        assertTrue(String.valueOf(r.meta().get("message")).contains("до глубины 6"), String.valueOf(r.meta().get("message")));
        assertTrue(r.paths().isEmpty());
    }

    @Test
    void tooDeepIsNotNoPath() {
        LoreGraphPath.Result r = path(src(), "ADR-1", "ADR-2", 2, 1, "both", null);
        assertEquals(Boolean.FALSE, r.meta().get("found"));
        assertEquals("too_deep", r.meta().get("reason"));
        assertTrue(String.valueOf(r.meta().get("message")).contains("до глубины 2"));
    }

    @Test
    void pathThroughHiddenIsSaidPlainly() {
        // Единственная связь A → B идёт через задачу чужого проекта.
        LoreGraphBuilderTest.MemSource s = new LoreGraphBuilderTest.MemSource()
            .node("A", "adr", "p1").node("B", "adr", "p1").node("X/T", "task", "p2")
            .edge("X/T", "JUSTIFIED_BY", "A").edge("X/T", "JUSTIFIED_BY", "B");
        LoreGraphPath.Result r = path(s, "A", "B", 4, 1, "both", Set.of("p1"));
        assertEquals(Boolean.FALSE, r.meta().get("found"));
        assertEquals("through_hidden", r.meta().get("reason"));
        assertTrue(r.paths().isEmpty(), "скрытый узел не показывается даже в пути");
        assertEquals(1, r.meta().get("hidden_by_scope"));
    }

    @Test
    void kPathsWithoutRepeatedVertices() {
        // A — три параллельные дороги длины 2 — B.
        LoreGraphBuilderTest.MemSource s = new LoreGraphBuilderTest.MemSource()
            .node("A", "adr", "p1").node("B", "adr", "p1")
            .node("S/1", "task", "p1").node("S/2", "task", "p1").node("S/3", "task", "p1").node("S/4", "task", "p1");
        for (String t : List.of("S/1", "S/2", "S/3", "S/4")) s.edge(t, "JUSTIFIED_BY", "A").edge(t, "JUSTIFIED_BY", "B");
        LoreGraphPath.Result r = path(s, "A", "B", 4, 3, "both", null);
        assertEquals(3, r.paths().size());
        assertEquals(List.of("A", "S/1", "B"), pathIds(r.paths().get(0)), "детерминированный порядок — по ключам");
        assertEquals(List.of("A", "S/3", "B"), pathIds(r.paths().get(2)));
        assertEquals(Boolean.TRUE, r.meta().get("more_paths_possible"));
    }

    @Test
    void pathRespectsDirection() {
        // ADR-1 → … → ADR-2 по исходящим нет: T1 → ADR-1, а не наоборот.
        LoreGraphPath.Result out = path(src(), "ADR-1", "ADR-2", 6, 1, "out", null);
        assertEquals(Boolean.FALSE, out.meta().get("found"));
        LoreGraphPath.Result ok = path(src(), "S1/T1", "ADR-2", 6, 1, "out", null);
        assertEquals(Boolean.TRUE, ok.meta().get("found"));
        assertEquals(2, ok.paths().get(0).get("length"));
    }

    @Test
    void missingEndIsNamed() {
        LoreGraphBuilder.GraphException e = assertThrows(LoreGraphBuilder.GraphException.class,
            () -> path(src(), "ADR-1", "NOPE", 4, 1, "both", null));
        assertEquals(404, e.status());
        assertTrue(e.getMessage().contains("to"), e.getMessage());
    }

    @Test
    void endOutsideScopeIs403() {
        LoreGraphBuilderTest.MemSource s = src().node("Z", "adr", "p9");
        LoreGraphBuilder.GraphException e = assertThrows(LoreGraphBuilder.GraphException.class,
            () -> path(s, "ADR-1", "Z", 4, 1, "both", Set.of("p1")));
        assertEquals(403, e.status());
        assertEquals("OUTSIDE_SCOPE", e.code());
    }

    @Test
    void depthAndKCapsAreEnforced() {
        assertThrows(LoreGraphBuilder.GraphException.class, () -> path(src(), "ADR-1", "ADR-2", 7, 1, "both", null));
        assertThrows(LoreGraphBuilder.GraphException.class, () -> path(src(), "ADR-1", "ADR-2", 4, 4, "both", null));
    }

    @Test
    void sameEndsIsAZeroLengthPath() {
        LoreGraphPath.Result r = path(src(), "ADR-1", "ADR-1", 4, 1, "both", null);
        assertEquals(Boolean.TRUE, r.meta().get("found"));
        assertEquals(0, r.paths().get(0).get("length"));
        assertFalse(r.paths().isEmpty());
    }
}
