// Вид «Force» (GC-03): force-graph — d3-force и Canvas 2D в главном потоке.
// Владелице понравилось его поведение («force мне поведением понравился»);
// цена — на тысячах узлов физика занимает главный поток (замер 11.11.2026:
// 18 кадров/с на 7 354 узлах). Библиотека грузится лениво, при первом показе.
import { useEffect, useRef } from 'react';
import { gxForces } from './settings';
import { neighborsOf, resolveColor, type GxEngineProps } from './engineTypes';

type FgNode = { id: string; type: string; title?: string; x?: number; y?: number };
type FgLink = { source: string | FgNode; target: string | FgNode; rel: string; kind?: string };
// Тип экземпляра force-graph — из его объявлений, но через typeof import, чтобы
// не тянуть библиотеку в основной бандл.
type Fg = InstanceType<typeof import('force-graph').default<FgNode, FgLink>>;

const idOf = (v: string | FgNode) => (typeof v === 'string' ? v : v.id);

export default function ForceEngine(p: GxEngineProps) {
  // GC-02: движок создаётся один раз в эффекте — живой обработчик берём из ref.
  const layoutDone = useRef(p.onLayoutDone);
  layoutDone.current = p.onLayoutDone;
  const host = useRef<HTMLDivElement>(null);
  const fg = useRef<Fg | null>(null);
  const latest = useRef(p);
  latest.current = p;

  // Холст и данные: пересоздаём при смене набора узлов/рёбер.
  useEffect(() => {
    let alive = true;
    const el = host.current;
    if (!el) return;
    Promise.all([import('force-graph'), import('d3-force')]).then(([{ default: ForceGraph }, d3]) => {
      if (!alive) return;
      const degree = new Map<string, number>();
      for (const e of p.edges) { degree.set(e.from, (degree.get(e.from) ?? 0) + 1); degree.set(e.to, (degree.get(e.to) ?? 0) + 1); }
      const g = new ForceGraph<FgNode, FgLink>(el)
        .graphData({ nodes: p.nodes.map(n => ({ ...n })), links: p.edges.map(e => ({ source: e.from, target: e.to, rel: e.rel, kind: e.kind })) })
        .width(el.clientWidth).height(el.clientHeight)
        .backgroundColor(resolveColor(el, '--bg1'))
        .nodeId('id')
        .nodeLabel(n => n.title ? `${n.title} · ${n.id}` : n.id)
        .nodeVal(n => 1 + Math.sqrt(degree.get(n.id) ?? 0))
        .onBackgroundClick(() => latest.current.onSelect(null))
        .nodeCanvasObjectMode(() => 'after')
        .nodeCanvasObject((n, ctx, scale) => {
          const s = latest.current;
          const nb = s.selected ? neighborsOf(s.selected, s.edges) : null;
          if (nb && !nb.has(n.id)) return;
          // Порог подписей: 0 — всегда, 1 — только при сильном приближении. Хабы
          // (4+ связей) подписаны вне порога: после авто-подгонки зум ≈ 1 и
          // без хабов весь граф остаётся безымянным.
          if (!nb && scale < s.settings.labels * 4 && (degree.get(n.id) ?? 0) < 4) return;
          // Холст не читает CSS-шрифты: семейство — то же, что у текста kit.
          ctx.font = `${11 / scale}px Manrope, sans-serif`;
          ctx.fillStyle = resolveColor(el, '--t1');
          ctx.textAlign = 'center';
          // MP2-13: подпись стоит ПОД кругом узла при любом зуме. Радиус узла
          // в мировых координатах постоянен, на экране он растёт вместе с
          // зумом; прежний фиксированный отступ 14px при приближении уводил
          // подпись внутрь круга — карточка узла «съезжала» с узла.
          const rWorld = 4 * s.settings.nodeSize * Math.sqrt(1 + Math.sqrt(degree.get(n.id) ?? 0));
          ctx.fillText(n.title ?? n.id, n.x ?? 0, (n.y ?? 0) + rWorld + 4 / scale);
        });
      g.d3Force('x', d3.forceX()).d3Force('y', d3.forceY());
      let clicks = 0;
      g.onNodeClick(n => {
        // Двойной щелчок — открыть запись; одиночный — подсветить соседей.
        clicks++;
        if (clicks === 2 && latest.current.onOpen) { clicks = 0; latest.current.onOpen(n.id); return; }
        setTimeout(() => { if (clicks === 1) latest.current.onSelect(latest.current.selected === n.id ? null : n.id); clicks = 0; }, 250);
      });
      g.onEngineStop(() => { g.zoomToFit(400, 30); layoutDone.current?.(); });
      fg.current = g;
      applySettings();
    }).catch(e => alive && latest.current.onError(e));

    let refitT: ReturnType<typeof setTimeout> | undefined;
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          fg.current?.width(el.clientWidth).height(el.clientHeight);
          // Ресайз и повторный показ (размер 0 → свой) подгоняют рамку; debounce,
          // чтобы подгонка не дёргалась посреди непрерывной тяги за краем окна.
          clearTimeout(refitT);
          refitT = setTimeout(() => fg.current?.zoomToFit(400, 30), 200);
        }) : null;
    ro?.observe(el);
    return () => { alive = false; clearTimeout(refitT); ro?.disconnect(); fg.current?._destructor(); fg.current = null; el.innerHTML = ''; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.nodes, p.edges]);

  function applySettings() {
    const g = fg.current, el = host.current;
    if (!g || !el) return;
    const s = latest.current;
    const f = gxForces(s.settings);
    const nb = s.selected ? neighborsOf(s.selected, s.edges) : null;
    const degree = new Map<string, number>();
    for (const e of s.edges) { degree.set(e.from, (degree.get(e.from) ?? 0) + 1); degree.set(e.to, (degree.get(e.to) ?? 0) + 1); }
    const dim = resolveColor(el, '--bg3');
    g.nodeRelSize(4 * s.settings.nodeSize)
      .nodeColor(n => (nb && !nb.has(n.id) ? dim : resolveColor(el, s.nodeColor(n))))
      .linkColor(l => {
        const a = idOf(l.source), b = idOf(l.target);
        if (nb && !(nb.has(a) && nb.has(b))) return 'transparent';
        return resolveColor(el, s.edgeColor({ from: a, to: b, rel: l.rel, kind: l.kind }));
      })
      .linkLineDash(l => s.edgeDash({ from: idOf(l.source), to: idOf(l.target), rel: l.rel, kind: l.kind }))
      .linkWidth(() => 0.6 * s.settings.linkWidth)
      .linkDirectionalArrowLength(s.settings.arrows ? 4 : 0)
      .linkDirectionalArrowRelPos(1);
    const link = g.d3Force('link') as unknown as { distance: (d: number) => unknown; strength: (fn: (l: FgLink) => number) => unknown } | undefined;
    link?.distance(f.distance);
    link?.strength(l => f.linkMul / Math.max(1, Math.min(degree.get(idOf(l.source)) ?? 1, degree.get(idOf(l.target)) ?? 1)));
    (g.d3Force('charge') as unknown as { strength: (v: number) => unknown } | undefined)?.strength(f.charge);
    (g.d3Force('x') as unknown as { strength: (v: number) => unknown } | undefined)?.strength(f.pull);
    (g.d3Force('y') as unknown as { strength: (v: number) => unknown } | undefined)?.strength(f.pull);
  }

  // Силы — перезапускают физику; отображение и выделение — только перерисовка.
  const forceKey = `${p.settings.center}|${p.settings.repel}|${p.settings.linkForce}|${p.settings.linkDistance}`;
  useEffect(() => { applySettings(); fg.current?.d3ReheatSimulation(); }, [forceKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { applySettings(); }, [p.selected, p.settings, p.nodeColor]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={host} className="sk-gx__canvas" data-testid="gx-force" />;
}
