// Физика вида «как Обсидиан» (GC-03): d3-force считается здесь, в воркере, —
// главный поток только рисует. Замер 11.11.2026 на всём LORE (7 354 узла): в
// главном потоке окно падало до 18 кадров/с, из воркера держит 120
// (spec:SPEC-LORE-GRAPH-VIEWS §10). Силы — те же, что у вида Force (gxForces).
import { forceCenter, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationNodeDatum } from 'd3-force';
import type { GxForces } from './settings';

type Node = SimulationNodeDatum & { index: number };
interface Link { source: number | Node; target: number | Node }

export type ObsidianIn =
  | { type: 'init'; n: number; links: [number, number][]; forces: GxForces }
  | { type: 'forces'; forces: GxForces }
  | { type: 'drag'; i: number; x: number; y: number }
  | { type: 'release'; i: number };
export type ObsidianOut = { type: 'pos'; a: Float32Array } | { type: 'end' };

let sim: Simulation<Node, Link> | null = null;
let nodes: Node[] = [];
let degree: number[] = [];

function post(): void {
  const a = new Float32Array(nodes.length * 2);
  for (let i = 0; i < nodes.length; i++) { a[2 * i] = nodes[i].x ?? 0; a[2 * i + 1] = nodes[i].y ?? 0; }
  (self as unknown as Worker).postMessage({ type: 'pos', a } satisfies ObsidianOut, [a.buffer]);
}

function apply(f: GxForces): void {
  if (!sim) return;
  const link = sim.force('link') as ReturnType<typeof forceLink<Node, Link>>;
  // Сила связи — штатная d3 (1 / меньшая из степеней концов), умноженная на шкалу панели.
  link.distance(f.distance).strength(l => {
    const s = (l.source as Node).index, t = (l.target as Node).index;
    return f.linkMul / Math.max(1, Math.min(degree[s] ?? 1, degree[t] ?? 1));
  });
  (sim.force('charge') as ReturnType<typeof forceManyBody<Node>>).strength(f.charge);
  (sim.force('x') as ReturnType<typeof forceX<Node>>).strength(f.pull);
  (sim.force('y') as ReturnType<typeof forceY<Node>>).strength(f.pull);
}

self.onmessage = (e: MessageEvent<ObsidianIn>) => {
  const m = e.data;
  if (m.type === 'init') {
    sim?.stop();
    nodes = Array.from({ length: m.n }, (_, i) => ({ index: i }));
    degree = new Array<number>(m.n).fill(0);
    for (const [s, t] of m.links) { degree[s]++; degree[t]++; }
    sim = forceSimulation<Node, Link>(nodes)
      .force('link', forceLink<Node, Link>(m.links.map(([s, t]) => ({ source: s, target: t }))))
      .force('charge', forceManyBody<Node>())
      .force('center', forceCenter())
      .force('x', forceX<Node>())
      .force('y', forceY<Node>())
      .on('tick', post)
      .on('end', () => { post(); (self as unknown as Worker).postMessage({ type: 'end' } satisfies ObsidianOut); });
    apply(m.forces);
    return;
  }
  if (!sim) return;
  if (m.type === 'forces') { apply(m.forces); sim.alpha(0.5).restart(); return; }
  const n = nodes[m.i];
  if (!n) return;
  if (m.type === 'drag') { n.fx = m.x; n.fy = m.y; sim.alphaTarget(0.3).restart(); return; }
  n.fx = null; n.fy = null; sim.alphaTarget(0);
};
