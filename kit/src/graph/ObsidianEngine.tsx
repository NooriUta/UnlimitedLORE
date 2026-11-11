// Вид «как Обсидиан» (GC-03): физика d3-force в воркере, рисует sigma (WebGL) —
// то же устройство, что у Обсидиана (d3-force + отрисовка через WebGL). Силы те
// же, что у вида Force, поэтому граф ведёт себя так же; разница — главный поток
// свободен, и на тысячах узлов окно не стоит.
//
// Камера не перемасштабируется на каждом шаге физики: иначе «дышит» весь граф
// (так было в первом прототипе — владелица: «нет, не такое движение как в force
// graph»). Рамка закрепляется по первым координатам и подгоняется, когда граф улёгся.
import { useEffect, useRef } from 'react';
import { gxForces } from './settings';
import { FALLBACK, neighborsOf, resolveColor, type GxEngineProps } from './engineTypes';
import type { ObsidianIn, ObsidianOut } from './obsidian.worker';

type SigmaT = InstanceType<typeof import('sigma').default>;
type GraphT = InstanceType<typeof import('graphology').default>;

export default function ObsidianEngine(p: GxEngineProps) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef<{ s: SigmaT; G: GraphT; w: Worker; idx: Map<string, number> } | null>(null);
  const latest = useRef(p);
  latest.current = p;

  useEffect(() => {
    let alive = true;
    const el = host.current;
    if (!el) return;
    Promise.all([import('graphology'), import('sigma')]).then(([{ default: Graph }, { default: Sigma }]) => {
      if (!alive) return;
      const G = new Graph({ multi: false, type: 'directed' });
      const idx = new Map<string, number>();
      p.nodes.forEach((n, i) => {
        idx.set(n.id, i);
        // Начальная раскладка — подсолнух, как у d3: узлы не стартуют из одной точки.
        const r = 10 * Math.sqrt(i + 0.5), a = i * 2.399963;
        G.addNode(n.id, { label: n.title ?? n.id, x: r * Math.cos(a), y: r * Math.sin(a), size: 3, color: FALLBACK });
      });
      for (const e of p.edges) {
        if (!G.hasNode(e.from) || !G.hasNode(e.to) || G.hasEdge(e.from, e.to)) continue;
        G.addEdge(e.from, e.to, { rel: e.rel, kind: e.kind, size: 1, color: FALLBACK });
      }
      const s = new Sigma(G, el, {
        renderEdgeLabels: false,
        labelFont: 'Manrope, sans-serif',
        labelColor: { color: resolveColor(el, '--t1') },
        defaultEdgeType: 'line',
      });
      const w = new Worker(new URL('./obsidian.worker.ts', import.meta.url), { type: 'module' });
      w.onerror = ev => latest.current.onError(ev.message || 'worker');
      let boxed = false;
      const fixBox = (k: number) => {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        G.forEachNode((_, a) => { x0 = Math.min(x0, a.x); x1 = Math.max(x1, a.x); y0 = Math.min(y0, a.y); y1 = Math.max(y1, a.y); });
        if (!Number.isFinite(x0)) return;
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, r = (Math.max(x1 - x0, y1 - y0, 1) * k) / 2;
        s.setCustomBBox({ x: [cx - r, cx + r], y: [cy - r, cy + r] });
      };
      w.onmessage = (ev: MessageEvent<ObsidianOut>) => {
        const m = ev.data;
        if (m.type === 'pos') {
          const a = m.a;
          G.updateEachNodeAttributes((k, at) => { const i = idx.get(k)!; at.x = a[2 * i]; at.y = a[2 * i + 1]; return at; }, { attributes: ['x', 'y'] });
          if (!boxed) { boxed = true; fixBox(1.6); }
        } else { fixBox(1.1); void s.getCamera().animatedReset({ duration: 400 }); }
      };
      const post = (msg: ObsidianIn) => w.postMessage(msg);
      post({ type: 'init', n: p.nodes.length, links: p.edges.filter(e => idx.has(e.from) && idx.has(e.to)).map(e => [idx.get(e.from)!, idx.get(e.to)!]), forces: gxForces(latest.current.settings) });

      // Перетаскивание: узел идёт за мышью или пальцем, соседи тянутся пружинками.
      let drag: string | null = null, moved = false;
      const startDrag = (id: string) => { drag = id; moved = false; s.getCamera().disable(); };
      const moveTo = (pt: { x: number; y: number }) => {
        if (!drag) return false;
        moved = true;
        const g = s.viewportToGraph(pt);
        post({ type: 'drag', i: idx.get(drag)!, x: g.x, y: g.y });
        return true;
      };
      const end = () => { if (drag) { post({ type: 'release', i: idx.get(drag)! }); drag = null; s.getCamera().enable(); } };
      s.on('downNode', ({ node }) => startDrag(node));
      s.getMouseCaptor().on('mousemovebody', e => { if (moveTo(e)) { e.preventSigmaDefault(); e.original.preventDefault(); } });
      s.getMouseCaptor().on('mouseup', end);
      s.on('upNode', end);
      s.getTouchCaptor().on('touchdown', e => {
        const t = e.touches[0];
        if (!t || e.touches.length > 1) return;
        let best: string | null = null, bd = 24 * 24;
        G.forEachNode((k, at) => { const q = s.graphToViewport({ x: at.x as number, y: at.y as number }); const d = (q.x - t.x) ** 2 + (q.y - t.y) ** 2; if (d < bd) { bd = d; best = k; } });
        if (best) startDrag(best);
      });
      s.getTouchCaptor().on('touchmove', e => { if (moveTo(e.touches[0])) e.original.preventDefault(); });
      s.getTouchCaptor().on('touchup', end);
      s.on('clickNode', ({ node }) => {
        if (moved) { moved = false; return; }
        latest.current.onSelect(latest.current.selected === node ? null : node);
      });
      s.on('doubleClickNode', ({ node, preventSigmaDefault }) => { preventSigmaDefault(); latest.current.onOpen?.(node); });
      s.on('clickStage', () => latest.current.onSelect(null));
      live.current = { s, G, w, idx };
      paint();
    }).catch(e => alive && latest.current.onError(e));
    return () => {
      alive = false;
      live.current?.w.terminate();
      live.current?.s.kill();
      live.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.nodes, p.edges]);

  function paint() {
    const L = live.current, el = host.current;
    if (!L || !el) return;
    const s = latest.current;
    const nb = s.selected ? neighborsOf(s.selected, s.edges) : null;
    const many = s.nodes.length > 2000;
    const dim = resolveColor(el, '--bg3');
    L.G.updateEachNodeAttributes((k, at) => {
      const n = s.nodes[L.idx.get(k)!];
      at.size = ((many ? 1.5 : 3) + Math.sqrt(L.G.degree(k)) * (many ? 0.9 : 1.4)) * s.settings.nodeSize;
      at.color = n ? resolveColor(el, s.nodeColor(n)) : FALLBACK;
      return at;
    });
    L.G.updateEachEdgeAttributes((_, at, src, dst) => {
      at.size = s.settings.linkWidth;
      at.type = s.settings.arrows ? 'arrow' : 'line';
      at.color = resolveColor(el, s.edgeColor({ from: src, to: dst, rel: at.rel as string, kind: at.kind as string | undefined }));
      return at;
    });
    L.s.setSetting('labelRenderedSizeThreshold', s.settings.labels * 12);
    L.s.setSetting('nodeReducer', (n, a) => (nb && !nb.has(n) ? { ...a, color: dim, label: '' } : { ...a, highlighted: n === s.selected }));
    L.s.setSetting('edgeReducer', (e, a) => {
      if (!nb) return a;
      const [x, y] = L.G.extremities(e);
      return x === s.selected || y === s.selected ? { ...a, size: a.size * 2 } : { ...a, hidden: true };
    });
  }

  const forceKey = `${p.settings.center}|${p.settings.repel}|${p.settings.linkForce}|${p.settings.linkDistance}`;
  useEffect(() => { live.current?.w.postMessage({ type: 'forces', forces: gxForces(p.settings) } satisfies ObsidianIn); }, [forceKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { paint(); }, [p.selected, p.settings, p.nodeColor]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={host} className="sk-gx__canvas" data-testid="sk-gx-obsidian" />;
}
