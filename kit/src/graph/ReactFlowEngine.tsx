// «Структура» — третий отрисовщик графа (SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-02): React Flow (DOM) с
// раскладкой ELK в воркере. Для доски, mind map и структуры до ~300 узлов (правило
// chooseGraphRenderer). Владелица 11.11: «React Flow взяла бы под доску и mind map».
//
// Раскладка — layoutWithElk (воркер, настоящая отмена, свой срок). Не уложилась — узлы сеткой,
// «конец раскладки» не сообщается, и GraphExplorer честно ставит плашку «не уложилась в N с».
// Ошибка ELK — onError словами, а не пустой холст. Цвета — токенами (DOM понимает var(--…)).
import '@xyflow/react/dist/style.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, MarkerType, Position, ReactFlow, type Edge, type Node } from '@xyflow/react';
import type { GxEngineProps } from './engineTypes';
import { neighborsOf } from './engineTypes';
import { layoutWithElk } from './elkLayout';
import { LAYOUT_TIMEOUT_MS } from './graphContract';

const NODE_W = 168;
const NODE_H = 40;
/** Свой срок ELK — чуть раньше плашки GraphExplorer: сетка встаёт до того, как о ней скажут. */
const ELK_TIMEOUT_MS = LAYOUT_TIMEOUT_MS - 500;

/** Запасная раскладка, когда ELK не уложился: сетка по порядку, без пересечений узлов. */
function gridPositions(ids: readonly string[]): Record<string, { x: number; y: number }> {
  const cols = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
  return Object.fromEntries(ids.map((id, i) => [id, { x: (i % cols) * (NODE_W + 24), y: Math.floor(i / cols) * (NODE_H + 24) }]));
}

export default function ReactFlowEngine(p: GxEngineProps) {
  const layoutDone = useRef(p.onLayoutDone);
  layoutDone.current = p.onLayoutDone;
  const onError = useRef(p.onError);
  onError.current = p.onError;
  const [pos, setPos] = useState<Record<string, { x: number; y: number }> | null>(null);
  const sig = `${p.nodes.map(n => n.id).join('|')}#${p.edges.map(e => `${e.from}>${e.to}`).join('|')}`;

  useEffect(() => {
    const ac = new AbortController();
    setPos(null);
    void layoutWithElk({
      nodes: p.nodes.map(n => ({ id: n.id, width: NODE_W, height: NODE_H })),
      edges: p.edges.map((e, i) => ({ id: `e${i}`, from: e.from, to: e.to })),
    }, { timeoutMs: ELK_TIMEOUT_MS, signal: ac.signal }).then(r => {
      if (r.state === 'ok') { setPos(r.positions); layoutDone.current?.(); }
      else if (r.state === 'timeout') setPos(gridPositions(p.nodes.map(n => n.id)));
      else if (r.state === 'error') onError.current(new Error(`ELK: ${r.reason}`));
    }, e => onError.current(e));
    return () => ac.abort();
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const lit = useMemo(() => (p.selected ? neighborsOf(p.selected, p.edges) : null), [p.selected, p.edges]);
  const nodes: Node[] = useMemo(() => (pos ? p.nodes.map(n => ({
    id: n.id,
    position: pos[n.id] ?? { x: 0, y: 0 },
    data: { label: n.title ?? n.id },
    className: 'sk-gx__rfnode',
    // ELK кладёт слои слева направо (elk.direction RIGHT) — рёбра входят слева и выходят справа.
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    style: {
      borderColor: p.nodeColor(n),
      opacity: lit && !lit.has(n.id) ? 0.25 : 1,
      width: NODE_W,
    },
  })) : []), [pos, p.nodes, p.nodeColor, lit]); // eslint-disable-line react-hooks/exhaustive-deps
  const edges: Edge[] = useMemo(() => p.edges.map((e, i) => {
    const dash = p.edgeDash(e);
    return {
      id: `e${i}`, source: e.from, target: e.to,
      markerEnd: p.settings.arrows ? { type: MarkerType.ArrowClosed } : undefined,
      style: { stroke: p.edgeColor(e), strokeDasharray: dash ? dash.join(' ') : undefined, opacity: lit && !(lit.has(e.from) && lit.has(e.to)) ? 0.15 : 1 },
    };
  }), [p.edges, p.edgeColor, p.edgeDash, p.settings.arrows, lit]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="sk-gx__rf" data-testid="gx-structure">
      {/* Монтируем после раскладки: fitView срабатывает при первом показе — по пустому холсту он вписал бы пустоту. */}
      {pos && <ReactFlow
        key={sig}
        nodes={nodes}
        edges={edges}
        fitView
        // Нижний предел масштаба 0,1: по умолчанию 0,5, и fitView не мог вписать окрестность выше холста (замер 13.11: 21 узел ≈ 1300 px при холсте 521 px).
        minZoom={0.1}
        fitViewOptions={{ padding: 0.1 }}
        nodesConnectable={false}
        onNodeClick={(_e, n) => p.onSelect(n.id)}
        onNodeDoubleClick={(_e, n) => p.onOpen?.(n.id)}
        onPaneClick={() => p.onSelect(null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>}
    </div>
  );
}
